import { Room, matchMaker } from "colyseus";
import { Match, seededRng, ENTRY_FEES, gameRewards, levelInfo } from "../../../src/logic/index.js";
import { initStore, publicAccount } from "../accounts/store.js";
import { PushGinState } from "./schema/PushGinState.js";

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
    this.#broadcastViews();
  }

  // A media partida, salir es abandonar: pierdes la cuota y el XP (Match.leave).
  onLeave(client) {
    const ev = this.match.leave(client.sessionId);
    if (this.match.phase === "lobby") this.accounts.delete(client.sessionId);
    this.#afterChange(ev);
  }

  onDispose() { this.turnTimer?.clear(); }

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
    this.rewards = gameRewards(order, this.match.totals, this.entryFee, [...this.match.left]);
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
      entryFee: this.entryFee, code: this.roomId,
      ...(this.match.phase === "finished" && { rewards: this.rewards }),
    });
  }
}
