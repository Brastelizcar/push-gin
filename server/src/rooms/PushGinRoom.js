import { Room, matchMaker } from "colyseus";
import { Round, TOTAL_ROUNDS, ROUND_REQUIREMENTS, cardPoints, seededRng, ENTRY_FEES, gameRewards, levelInfo } from "../../../src/logic/index.js";
import { initStore, isSyncCode, publicAccount } from "../accounts/store.js";
import { PushGinState } from "./schema/PushGinState.js";

const MIN_PLAYERS = 2;

const isIdList = (a) => Array.isArray(a) && a.every((x) => typeof x === "string");
// Valida y limpia [{ cardIds:[...], start? }] que llega del cliente (nunca se confía en él).
function cleanGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return null;
  const ok = groups.every(
    (g) => g && isIdList(g.cardIds) && (g.start === undefined || Number.isInteger(g.start))
  );
  return ok ? groups.map((g) => ({ cardIds: g.cardIds, start: g.start, ordered: g.ordered === true })) : null;
}

// Valida y limpia la jugada { plant?, melds?, hooks?, discard } (ver src/logic/turn.js).
function cleanTurn(m) {
  if (!m || typeof m.discard !== "string") return null;
  const groups = (x) => (x == null || (Array.isArray(x) && !x.length) ? [] : cleanGroups(x));
  const plant = groups(m.plant), melds = groups(m.melds);
  if (!plant || !melds) return null;
  const hooks = m.hooks ?? [];
  if (!Array.isArray(hooks) || hooks.length > 20) return null;
  const okHook = (h) => h && typeof h.meldId === "number" && typeof h.cardId === "string" &&
    (h.end === undefined || h.end === null || h.end === "low" || h.end === "high");
  if (!hooks.every(okHook)) return null;
  return {
    plant, melds, discard: m.discard,
    hooks: hooks.map((h) => ({ meldId: h.meldId, cardId: h.cardId, end: h.end ?? undefined })),
  };
}

// Código de sala de 4 dígitos (1000–9999), fácil de dictar. Se reintenta si ya existe.
async function generateRoomCode() {
  for (let i = 0; i < 50; i++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    if (!(await matchMaker.getRoomById(code))) return code;
  }
  throw new Error("No hay códigos de sala disponibles, intenta de nuevo");
}

export class PushGinRoom extends Room {
  maxClients = 4;
  state = new PushGinState();

  // --- Estado del juego (vive en memoria del servidor; NO se sincroniza automáticamente) ---
  order = [];          // sessionIds en orden de llegada (el primero es el anfitrión)
  names = new Map();   // sessionId -> nombre
  connected = new Set();
  game = null;         // instancia de Round
  roundIndex = 0;
  totals = {};         // puntaje acumulado por jugador
  roundScores = null;  // puntaje de la última ronda terminada
  rng = null;          // generador con semilla (solo pruebas); null = Math.random
  entryFee = 0;        // cuota de entrada en fichas (la paga cada jugador al empezar; el ganador se lleva el pozo)
  accounts = new Map(); // sessionId -> id de cuenta (los invitados sin cuenta no aparecen)
  levels = new Map();   // sessionId -> nivel (público)
  rewards = null;       // premios al terminar la partida: { sessionId: { place, xp, chips } }
  starting = false;

  messages = {
    start: async (client) => {
      if (this.state.phase !== "lobby" || this.starting) return this.#reject(client, "La partida ya empezó");
      if (client.sessionId !== this.order[0]) return this.#reject(client, "Solo el anfitrión puede empezar");
      if (this.order.length < MIN_PLAYERS) return this.#reject(client, "Se necesitan al menos 2 jugadores");
      if (this.entryFee > 0) {
        // Se cobra la cuota a todos o a nadie (y se verifica en la base de datos, no aquí).
        this.starting = true;
        const store = await initStore();
        const ids = this.order.map((sid) => this.accounts.get(sid));
        const ok = ids.every(Boolean) && (await store.chargeFee(ids, this.entryFee));
        this.starting = false;
        if (!ok) {
          const poor = [];
          for (const sid of this.order) {
            const acc = this.accounts.get(sid) && (await store.byId(this.accounts.get(sid)));
            if (!acc || acc.chips < this.entryFee) poor.push(this.names.get(sid));
          }
          return this.#reject(client, `No tienen fichas suficientes para la cuota: ${poor.join(", ")}`);
        }
        if (this.state.phase !== "lobby") return;
      }
      this.lock(); // nadie más puede entrar
      this.totals = Object.fromEntries(this.order.map((id) => [id, 0]));
      this.roundIndex = 0;
      this.#startRound();
      this.#broadcastViews();
    },

    nextRound: (client) => {
      if (this.state.phase !== "roundOver") return this.#reject(client, "No hay ronda por iniciar");
      if (client.sessionId !== this.order[0]) return this.#reject(client, "Solo el anfitrión continúa");
      this.roundIndex++;
      this.#startRound();
      this.#broadcastViews();
    },

    steal2: (client, m) => {
      if (typeof m?.meldId !== "number" || !Number.isInteger(m?.index) || typeof m?.cardId !== "string")
        return this.#reject(client, "Mensaje inválido");
      this.#act(client, (g) => g.steal2(client.sessionId, m.meldId, m.index, m.cardId), () => ({
        type: "steal", by: client.sessionId, victim: this.game.melds.find((x) => x.id === m.meldId)?.owner,
      }));
    },
    takeDiscard: (client) => this.#act(client, (g) => g.takeDiscard(client.sessionId)),
    push: (client) =>
      this.#act(client, (g) => g.push(client.sessionId), () => ({
        type: "push", by: client.sessionId, to: this.game.nextPlayer, // el turno no cambia durante el push
      })),
    // Jugada COMPLETA del turno (plantarse/bajar/enganchar + descarte). Todo o nada: si es inválida, el turno no pasa.
    playTurn: (client, m) => {
      const turn = cleanTurn(m);
      if (!turn) return this.#reject(client, "Mensaje inválido");
      this.#act(client, (g) => g.playTurn(client.sessionId, turn), (res) => ({
        type: "turn", by: client.sessionId, planted: res.plantedNow, laid: res.laid, hooked: res.hooked,
      }));
    },
    // Descartar sin jugar nada: es una jugada completa con solo el descarte.
    discard: (client, m) => {
      if (typeof m?.cardId !== "string") return this.#reject(client, "Mensaje inválido");
      this.#act(client, (g) => g.playTurn(client.sessionId, { discard: m.cardId }));
    },

    // El cliente puede pedir su vista (útil al recargar o reconectar).
    requestState: (client) => client.send("state", this.#viewFor(client.sessionId)),
  };

  async onCreate(options) {
    this.entryFee = ENTRY_FEES.includes(options?.entryFee) ? options.entryFee : 0;
    // El código corto ES el roomId: los demás se unen con client.joinById(codigo, { name }).
    this.roomId = await generateRoomCode();
    // Reparto reproducible para pruebas (nunca en producción).
    if (process.env.NODE_ENV !== "production" && Number.isInteger(options?.seed)) this.rng = seededRng(options.seed);
  }

  // Si traes el código de tu cuenta, se verifica aquí (si no existe, no entras). Sin código entras como invitado,
  // solo en salas sin cuota y sin ganar XP.
  async onAuth(client, options) {
    if (options?.code === undefined) {
      if (this.entryFee > 0) throw new Error("Necesitas una cuenta para entrar a una sala con cuota");
      return { account: null };
    }
    if (!isSyncCode(options.code)) throw new Error("Cuenta no válida");
    const account = await (await initStore()).byCode(options.code);
    if (!account) throw new Error("Cuenta no válida");
    if ([...this.accounts.values()].includes(account.id)) throw new Error("Ya estás en esta sala");
    return { account };
  }

  onJoin(client, options, auth) {
    const account = auth?.account ?? null;
    if (account) {
      this.accounts.set(client.sessionId, account.id);
      this.levels.set(client.sessionId, levelInfo(account.xp).level);
    }
    const name = account?.name ?? (String(options?.name ?? "").trim().slice(0, 16) || "Jugador");
    this.names.set(client.sessionId, name);
    this.order.push(client.sessionId);
    this.connected.add(client.sessionId);
    this.#broadcastViews();
  }

  onLeave(client) {
    this.connected.delete(client.sessionId);
    if (this.state.phase === "lobby") {
      // En la sala de espera, se libera el cupo y el anfitrión pasa al siguiente.
      this.order = this.order.filter((id) => id !== client.sessionId);
      this.names.delete(client.sessionId);
      this.accounts.delete(client.sessionId);
      this.levels.delete(client.sessionId);
    }
    // En partida el asiento se conserva (reconexión: pendiente para más adelante).
    this.#broadcastViews();
  }

  // ---------- internos ----------
  #startRound() {
    this.game = new Round(this.order, this.roundIndex, this.rng ? { rng: this.rng } : {});
    this.roundScores = null;
    this.state.phase = "playing";
  }

  // `event` (opcional): crea un aviso para TODOS (el cliente lo usa para animar). Se envía antes del estado.
  #act(client, fn, event) {
    if (this.state.phase !== "playing" || !this.game) return this.#reject(client, "No hay ronda activa");
    const res = fn(this.game);
    if (!res.ok) return this.#reject(client, res.error);
    if (event) this.broadcast("event", event(res));
    if (res.roundOver) this.#finishRound(res.scores);
    this.#broadcastViews();
  }

  #finishRound(scores) {
    this.roundScores = scores;
    for (const id of this.order) this.totals[id] += scores[id];
    this.state.phase = this.roundIndex + 1 >= TOTAL_ROUNDS ? "finished" : "roundOver";
    if (this.state.phase === "finished") this.#giveRewards();
  }

  // Fin de la partida: XP según el puesto y el pozo de cuotas al ganador. Se guarda en la base de datos y a cada
  // jugador con cuenta le llega su cuenta actualizada (mensaje "account").
  #giveRewards() {
    this.rewards = gameRewards(this.order, this.totals, this.entryFee);
    const list = this.order.filter((sid) => this.accounts.has(sid))
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

  // Vista PERSONALIZADA: solo tu mano completa; de los demás, solo cuántas cartas tienen.
  #viewFor(me) {
    const phase = this.state.phase;
    const players = this.order.map((id) => ({
      id,
      name: this.names.get(id),
      connected: this.connected.has(id),
      level: this.levels.get(id) ?? null,
      total: this.totals[id] ?? 0,
      ...(this.game && {
        cards: this.game.hands[id].length,
        planted: this.game.planted[id],
      }),
    }));
    const base = { phase, you: me, host: this.order[0], players, entryFee: this.entryFee, code: this.roomId };
    if (phase === "lobby" || !this.game) return base;

    const g = this.game;
    const view = {
      ...base,
      round: this.roundIndex + 1,
      requirement: ROUND_REQUIREMENTS[this.roundIndex], // qué hay que bajar para plantarse
      totalRounds: TOTAL_ROUNDS,
      current: g.currentPlayer,
      turnPhase: g.phase, // 'start' | 'main' | 'ended'
      stoleThisTurn: g.stoleThisTurn,
      discardTop: g.discardTop,
      deckCount: g.deck.length, // cartas que quedan en el mazo (debajo del descarte)
      melds: g.melds,
      recentCardIds: g.recentCardIds,
      hand: g.hands[me] ?? [],
      handPoints: (g.hands[me] ?? []).reduce((s, c) => s + cardPoints(c), 0),
    };
    if (phase === "roundOver" || phase === "finished") {
      view.winner = g.winner;
      view.roundScores = this.roundScores;
      view.hands = g.hands; // al terminar la ronda se revelan las cartas restantes
      if (phase === "finished") {
        const best = Math.min(...this.order.map((id) => this.totals[id]));
        view.gameWinners = this.order.filter((id) => this.totals[id] === best);
        view.rewards = this.rewards;
      }
    }
    return view;
  }
}
