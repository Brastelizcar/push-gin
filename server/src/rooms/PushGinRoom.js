import { Room, matchMaker } from "colyseus";
import { Round, TOTAL_ROUNDS, ROUND_REQUIREMENTS, cardPoints } from "../../../src/logic/index.js";
import { PushGinState } from "./schema/PushGinState.js";

const MIN_PLAYERS = 2;

const isIdList = (a) => Array.isArray(a) && a.every((x) => typeof x === "string");
// Valida y limpia [{ cardIds:[...], start? }] que llega del cliente (nunca se confía en él).
function cleanGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return null;
  const ok = groups.every(
    (g) => g && isIdList(g.cardIds) && (g.start === undefined || Number.isInteger(g.start))
  );
  return ok ? groups.map((g) => ({ cardIds: g.cardIds, start: g.start })) : null;
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

  messages = {
    start: (client) => {
      if (this.state.phase !== "lobby") return this.#reject(client, "La partida ya empezó");
      if (client.sessionId !== this.order[0]) return this.#reject(client, "Solo el anfitrión puede empezar");
      if (this.order.length < MIN_PLAYERS) return this.#reject(client, "Se necesitan al menos 2 jugadores");
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
    plant: (client, m) => {
      const groups = cleanGroups(m?.groups);
      if (!groups) return this.#reject(client, "Mensaje inválido");
      this.#act(client, (g) => g.plant(client.sessionId, groups), () => ({ type: "plant", by: client.sessionId }));
    },
    layMelds: (client, m) => {
      const groups = cleanGroups(m?.groups);
      if (!groups) return this.#reject(client, "Mensaje inválido");
      this.#act(client, (g) => g.layMelds(client.sessionId, groups), () => ({ type: "lay", by: client.sessionId }));
    },
    hook: (client, m) => {
      if (typeof m?.meldId !== "number" || typeof m?.cardId !== "string" ||
          (m.end !== undefined && m.end !== "low" && m.end !== "high"))
        return this.#reject(client, "Mensaje inválido");
      this.#act(client, (g) => g.hook(client.sessionId, m.meldId, m.cardId, m.end));
    },
    discard: (client, m) => {
      if (typeof m?.cardId !== "string") return this.#reject(client, "Mensaje inválido");
      this.#act(client, (g) => g.discard(client.sessionId, m.cardId));
    },

    // El cliente puede pedir su vista (útil al recargar o reconectar).
    requestState: (client) => client.send("state", this.#viewFor(client.sessionId)),
  };

  async onCreate() {
    // El código corto ES el roomId: los demás se unen con client.joinById(codigo, { name }).
    this.roomId = await generateRoomCode();
  }

  onJoin(client, options) {
    const name = String(options?.name ?? "").trim().slice(0, 16) || "Jugador";
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
    }
    // En partida el asiento se conserva (reconexión: pendiente para más adelante).
    this.#broadcastViews();
  }

  // ---------- internos ----------
  #startRound() {
    this.game = new Round(this.order, this.roundIndex);
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
      total: this.totals[id] ?? 0,
      ...(this.game && {
        cards: this.game.hands[id].length,
        planted: this.game.planted[id],
      }),
    }));
    const base = { phase, you: me, host: this.order[0], players };
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
      }
    }
    return view;
  }
}
