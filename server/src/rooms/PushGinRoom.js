import { Room, matchMaker } from "colyseus";
import {
  Match, seededRng, ENTRY_FEES, gameRewards, levelInfo, botMove, BOT_NAMES, isBot, PRACTICE_XP_FACTOR,
} from "../../../src/logic/index.js";
import { initStore, publicAccount } from "../accounts/store.js";
import { PushGinState } from "./schema/PushGinState.js";

// Segundos que se guarda el asiento a quien se le cae la conexión a media partida.
export const RECONNECT_SECONDS = 60;

// Código de sala de 4 dígitos (1000–9999), fácil de dictar. Se reintenta si ya existe.
async function generateRoomCode() {
  for (let i = 0; i < 50; i++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    if (!(await matchMaker.getRoomById(code))) return code;
  }
  throw new Error("No hay códigos de sala disponibles, intenta de nuevo");
}

// La sala es una capa delgada sobre Match (src/logic/match.js): red, cuentas, cuotas, premios y temporizador.
export class PushGinRoom extends Room {
  maxClients = 4;
  state = new PushGinState();

  match = new Match();
  entryFee = 0;         // cuota de entrada en fichas (la paga cada jugador al empezar; el ganador se lleva el pozo)
  accounts = new Map(); // sessionId -> id de cuenta (los invitados sin cuenta no aparecen)
  rewards = null;       // premios al terminar la partida: { sessionId: { place, xp, chips } }
  rewardsSaved = null;  // promesa del guardado de premios (pruebas)
  starting = false;
  turnTimer = null;
  reconnectSeconds = RECONNECT_SECONDS; // (las pruebas lo acortan)
  practice = 0;         // práctica contra bots: cuántos bots (0 = partida normal). Da la mitad del XP.
  botDelay = [700, 1300]; // ms que "piensa" cada bot (las pruebas lo acortan)
  botTimer = null;

  get game() { return this.match.game; } // la ronda actual (las pruebas la usan)

  messages = {
    start: async (client) => {
      if (this.starting) return this.#reject(client, "La partida ya empezó");
      const can = this.match.canStart(client.sessionId);
      if (!can.ok) return this.#reject(client, can.error);
      if (this.entryFee > 0 && !(await this.#chargeFees(client))) return;
      if (this.match.phase !== "lobby") return;
      this.lock(); // nadie más puede entrar
      this.#handle(client, "start");
    },
    nextRound: (client) => this.#handle(client, "nextRound"),
    steal2: (client, m) => this.#handle(client, "steal2", m),
    takeDiscard: (client) => this.#handle(client, "takeDiscard"),
    push: (client) => this.#handle(client, "push"),
    // Jugada COMPLETA del turno (plantarse/bajar/enganchar + descarte). Todo o nada: si es inválida, el turno no pasa.
    playTurn: (client, m) => this.#handle(client, "playTurn", m),
    // Descartar sin jugar nada: es una jugada completa con solo el descarte.
    discard: (client, m) => this.#handle(client, "discard", m),
    // El cliente puede pedir su vista (útil al recargar o reconectar).
    requestState: (client) => client.send("state", this.#viewFor(client.sessionId)),
  };

  async onCreate(options) {
    this.entryFee = ENTRY_FEES.includes(options?.entryFee) ? options.entryFee : 0;
    // Reparto reproducible para pruebas (nunca en producción).
    const rng = process.env.NODE_ENV !== "production" && Number.isInteger(options?.seed) ? seededRng(options.seed) : null;
    this.match = new Match({ rng, turnTime: options?.turnTime });
    // Práctica: tú solo contra 1–3 bots que juegan en el servidor (así el XP también lo decide el servidor).
    if (options?.practice !== undefined) {
      this.practice = Math.max(1, Math.min(3, Number.parseInt(options.practice, 10) || 2));
      this.entryFee = 0;
      this.maxClients = 1;
    }
    // El código corto ES el roomId: los demás se unen con client.joinById(codigo, { name, token }).
    this.roomId = await generateRoomCode();
  }

  // Si traes el token de tu cuenta, se verifica aquí (si no es válido, no entras). Sin token entras como invitado,
  // solo en salas sin cuota y sin ganar XP. El nombre y el nivel salen de la base de datos, no del cliente.
  async onAuth(client, options) {
    if (options?.token === undefined) {
      if (this.entryFee > 0) throw new Error("Necesitas una cuenta para entrar a una sala con cuota");
      return { account: null };
    }
    const account = await (await initStore()).byToken(options.token);
    if (!account) throw new Error("Cuenta no válida");
    if ([...this.accounts.values()].includes(account.id)) throw new Error("Ya estás en esta sala");
    return { account };
  }

  onJoin(client, options, auth) {
    const account = auth?.account ?? null;
    if (account) this.accounts.set(client.sessionId, account.id);
    const name = account?.name ?? (String(options?.name ?? "").trim().slice(0, 16) || "Jugador");
    this.match.addPlayer(client.sessionId, name, account ? levelInfo(account.xp).level : null);
    if (this.practice) {                   // la práctica empieza apenas entras
      BOT_NAMES.slice(0, this.practice).forEach((n, i) => this.match.addPlayer(`bot${i + 1}`, n));
      this.lock();
      this.#handle(client, "start");
      return;
    }
    this.#broadcastViews();
  }

  // Se cayó la conexión (sin salir a propósito): en partida se guarda el asiento RECONNECT_SECONDS.
  // Si vuelve, onReconnect; si no, Colyseus llama a onLeave y cuenta como abandonar. En la sala de espera no se guarda.
  onDrop(client) {
    if (this.match.phase === "lobby" || this.match.phase === "finished" || this.match.left.has(client.sessionId)) return;
    this.match.drop(client.sessionId, Date.now() + this.reconnectSeconds * 1000);
    this.allowReconnection(client, this.reconnectSeconds);
    this.#broadcastViews();
  }

  onReconnect(client) {
    this.match.rejoin(client.sessionId);
    this.#broadcastViews();
  }

  // Salir a propósito, o no volver a tiempo. A media partida es abandonar: pierdes la cuota y el XP (Match.leave).
  onLeave(client) {
    const ev = this.match.leave(client.sessionId);
    if (this.match.phase === "lobby") this.accounts.delete(client.sessionId);
    this.#afterChange(ev);
  }

  onDispose() { this.turnTimer?.clear(); this.botTimer?.clear(); }

  // ---------- internos ----------
  // `event` (opcional): un aviso para TODOS (el cliente lo usa para animar). Se envía antes del estado.
  #handle(client, type, m) {
    const res = this.match.handle(client.sessionId, type, m);
    if (!res.ok) return this.#reject(client, res.error);
    this.#afterChange(res.event);
  }

  #afterChange(event) {
    this.state.phase = this.match.phase;
    if (event) this.broadcast("event", event);
    if (this.match.phase === "finished" && !this.rewards) this.#giveRewards();
    this.#broadcastViews();
    this.#scheduleTimeout();
    this.#scheduleBot();
  }

  // Práctica: si le toca a un bot, juega tras una pausa. Un bot nunca debería equivocarse; si pasa, solo descarta.
  #scheduleBot() {
    this.botTimer?.clear();
    this.botTimer = null;
    if (!this.practice || this.match.phase !== "playing" || !isBot(this.match.game.currentPlayer)) return;
    const [a, b] = this.botDelay;
    this.botTimer = this.clock.setTimeout(() => {
      if (this.match.phase !== "playing") return;
      const pid = this.match.game.currentPlayer;
      if (!isBot(pid)) return;
      const mv = botMove(this.match.viewFor(pid));
      let res = this.match.handle(pid, mv.type, mv.msg);
      if (!res.ok) {
        console.warn("Bot rechazado:", res.error);
        if (this.match.game.phase === "start") this.match.handle(pid, "takeDiscard");
        res = this.match.handle(pid, "discard", { cardId: this.match.lastDrawn ?? this.match.game.hands[pid][0].id });
      }
      this.#afterChange(res.event);
    }, a + Math.random() * (b - a));
  }

  // Temporizador de turno: si el jugador no termina a tiempo, el turno se juega solo (Match.timeoutTurn).
  #scheduleTimeout() {
    this.turnTimer?.clear();
    this.turnTimer = null;
    const deadline = this.match.deadline;
    if (deadline == null) return;
    this.turnTimer = this.clock.setTimeout(() => {
      const ev = this.match.timeoutTurn();
      if (ev) this.#afterChange(ev);
      else this.#scheduleTimeout();
    }, Math.max(0, deadline - Date.now()) + 50);
  }

  // Se cobra la cuota a todos o a nadie (y se verifica en la base de datos, no aquí).
  async #chargeFees(client) {
    this.starting = true;
    try {
      const store = await initStore();
      const ids = this.match.order.map((sid) => this.accounts.get(sid));
      if (ids.every(Boolean) && (await store.chargeFee(ids, this.entryFee))) return true;
      const poor = [];
      for (const sid of this.match.order) {
        const acc = this.accounts.get(sid) && (await store.byId(this.accounts.get(sid)));
        if (!acc || acc.chips < this.entryFee) poor.push(this.match.names.get(sid));
      }
      this.#reject(client, `No tienen fichas suficientes para la cuota: ${poor.join(", ")}`);
      return false;
    } finally {
      this.starting = false;
    }
  }

  // Fin de la partida: XP según el puesto y el pozo de cuotas al ganador. Se guarda en la base de datos y a cada
  // jugador con cuenta le llega su cuenta actualizada (mensaje "account").
  #giveRewards() {
    const order = this.match.order;
    this.rewards = gameRewards(order, this.match.totals, this.entryFee, [...this.match.left],
      { xpFactor: this.practice ? PRACTICE_XP_FACTOR : 1 });
    const list = order.filter((sid) => this.accounts.has(sid))
      .map((sid) => ({ sid, id: this.accounts.get(sid), xp: this.rewards[sid].xp, chips: this.rewards[sid].chips + this.entryFee }));
    this.rewardsSaved = (async () => {
      const store = await initStore();
      await store.reward(list);
      for (const { sid, id } of list) {
        const acc = await store.byId(id);
        this.clients.find((c) => c.sessionId === sid)?.send("account", publicAccount(acc));
      }
    })().catch((e) => console.error("No se pudieron guardar los premios:", e));
  }

  // El cliente usa "rejected" para revertir su UI optimista (spec 3.4).
  #reject(client, error) {
    client.send("rejected", { error });
  }

  #broadcastViews() {
    for (const client of this.clients) client.send("state", this.#viewFor(client.sessionId));
  }

  #viewFor(me) {
    return this.match.viewFor(me, {
      entryFee: this.entryFee, code: this.roomId, practice: this.practice > 0,
      ...(this.match.phase === "finished" && { rewards: this.rewards }),
    });
  }
}
