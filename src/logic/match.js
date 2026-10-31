// Una PARTIDA completa (5 rondas): jugadores, turnos, puntajes, temporizador y la vista privada de cada uno.
// No sabe nada de red: la usan la sala del servidor (PushGinRoom) y el modo práctica del navegador.
//   handle(pid, type, msg) → { ok:false, error } | { ok:true, event? }
import { Round } from './game.js';
import { TOTAL_ROUNDS, ROUND_REQUIREMENTS } from './rounds.js';
import { cardPoints } from './cards.js';

export const MIN_PLAYERS = 2;
export const TURN_TIMES = [0, 30, 45, 60, 90, 120]; // segundos por turno (0 = sin límite)

const fail = (error) => ({ ok: false, error });
const isIdList = (a) => Array.isArray(a) && a.every((x) => typeof x === 'string');

// Valida y limpia [{ cardIds:[...], start?, ordered? }] que llega del cliente (nunca se confía en él).
export function cleanGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return null;
  const ok = groups.every((g) => g && isIdList(g.cardIds) && (g.start === undefined || Number.isInteger(g.start)));
  return ok ? groups.map((g) => ({ cardIds: g.cardIds, start: g.start, ordered: g.ordered === true })) : null;
}

// Valida y limpia la jugada { plant?, melds?, hooks?, discard } (ver turn.js).
export function cleanTurn(m) {
  if (!m || typeof m.discard !== 'string') return null;
  const groups = (x) => (x == null || (Array.isArray(x) && !x.length) ? [] : cleanGroups(x));
  const plant = groups(m.plant), melds = groups(m.melds);
  if (!plant || !melds) return null;
  const hooks = m.hooks ?? [];
  if (!Array.isArray(hooks) || hooks.length > 20) return null;
  const okHook = (h) => h && typeof h.meldId === 'number' && typeof h.cardId === 'string' &&
    (h.end === undefined || h.end === null || h.end === 'low' || h.end === 'high');
  if (!hooks.every(okHook)) return null;
  return { plant, melds, discard: m.discard, hooks: hooks.map((h) => ({ meldId: h.meldId, cardId: h.cardId, end: h.end ?? undefined })) };
}

export class Match {
  // turnTime: segundos por turno (0 = sin límite). now: reloj (se inyecta en pruebas).
  constructor({ rng = null, turnTime = 0, now = () => Date.now() } = {}) {
    this.rng = rng;
    this.turnTime = TURN_TIMES.includes(turnTime) ? turnTime : 0;
    this.now = now;
    this.phase = 'lobby';     // lobby | playing | roundOver | finished
    this.order = [];          // ids en orden de llegada (el primero es el anfitrión)
    this.names = new Map();
    this.levels = new Map();
    this.connected = new Set();
    this.game = null;         // Round actual
    this.roundIndex = 0;
    this.totals = {};
    this.roundScores = null;
    this.turnStartedAt = null;
    this.lastDrawn = null;    // carta que tomó el jugador en turno (la descarta si se le acaba el tiempo)
  }

  get host() { return this.order[0]; }

  // ---------- jugadores ----------
  addPlayer(id, name, level = null) {
    this.order.push(id);
    this.names.set(id, name);
    if (level) this.levels.set(id, level);
    this.connected.add(id);
  }
  // En la sala de espera se libera el cupo (y el anfitrión pasa al siguiente); en partida se conserva el asiento.
  leave(id) {
    this.connected.delete(id);
    if (this.phase !== 'lobby') return;
    this.order = this.order.filter((x) => x !== id);
    this.names.delete(id);
    this.levels.delete(id);
  }

  // ¿Puede `pid` empezar ahora? (la sala del servidor lo pregunta antes de cobrar la cuota)
  canStart(pid) {
    if (this.phase !== 'lobby') return fail('La partida ya empezó');
    if (pid !== this.host) return fail('Solo el anfitrión puede empezar');
    if (this.order.length < MIN_PLAYERS) return fail('Se necesitan al menos 2 jugadores');
    return { ok: true };
  }

  // ---------- mensajes ----------
  handle(pid, type, m) {
    switch (type) {
      case 'start': {
        const c = this.canStart(pid); if (!c.ok) return c;
        this.totals = Object.fromEntries(this.order.map((id) => [id, 0]));
        this.roundIndex = 0;
        this.#startRound();
        return { ok: true };
      }
      case 'nextRound':
        if (this.phase !== 'roundOver') return fail('No hay ronda por iniciar');
        if (pid !== this.host) return fail('Solo el anfitrión continúa');
        this.roundIndex++;
        this.#startRound();
        return { ok: true };
      case 'steal2':
        if (typeof m?.meldId !== 'number' || !Number.isInteger(m?.index) || typeof m?.cardId !== 'string') return fail('Mensaje inválido');
        return this.#act((g) => g.steal2(pid, m.meldId, m.index, m.cardId),
          () => ({ type: 'steal', by: pid, victim: this.game.melds.find((x) => x.id === m.meldId)?.owner }));
      case 'takeDiscard':
        return this.#act((g) => g.takeDiscard(pid), null, (res) => (this.lastDrawn = res.taken.id));
      case 'push':
        return this.#act((g) => g.push(pid), () => ({ type: 'push', by: pid, to: this.game.nextPlayer }), (res) => (this.lastDrawn = res.drew.id));
      case 'playTurn': {
        const turn = cleanTurn(m);
        if (!turn) return fail('Mensaje inválido');
        return this.#act((g) => g.playTurn(pid, turn),
          (res) => ({ type: 'turn', by: pid, planted: res.plantedNow, laid: res.laid, hooked: res.hooked }));
      }
      case 'discard':
        if (typeof m?.cardId !== 'string') return fail('Mensaje inválido');
        return this.#act((g) => g.playTurn(pid, { discard: m.cardId }));
      default:
        return fail('Mensaje inválido');
    }
  }

  // ---------- temporizador de turno ----------
  // Momento (ms) en que se acaba el turno actual, o null si no hay límite / no se está jugando.
  get deadline() {
    if (!this.turnTime || this.phase !== 'playing' || this.turnStartedAt == null) return null;
    return this.turnStartedAt + this.turnTime * 1000;
  }
  // Se acabó el tiempo: el turno se juega solo de la forma más neutra posible.
  //  · antes de tomar carta → toma el descarte y lo vuelve a descartar (nada cambia, el turno pasa)
  //  · después → descarta la carta que acababa de tomar (o la que más puntos vale)
  timeoutTurn() {
    if (this.deadline == null || this.now() < this.deadline) return null;
    const g = this.game, pid = g.currentPlayer;
    if (g.phase === 'start') {
      const r = g.takeDiscard(pid);
      this.lastDrawn = r.ok ? r.taken.id : null;
      if (!r.ok) { const p = g.push(pid); this.lastDrawn = p.drew?.id ?? null; }
    }
    const hand = g.hands[pid];
    const card = hand.find((c) => c.id === this.lastDrawn) ?? [...hand].sort((a, b) => cardPoints(b) - cardPoints(a))[0];
    const res = g.playTurn(pid, { discard: card.id });
    this.#after(res);
    return { type: 'timeout', by: pid };
  }

  // ---------- internos ----------
  #startRound() {
    this.game = new Round(this.order, this.roundIndex, this.rng ? { rng: this.rng } : {});
    this.roundScores = null;
    this.phase = 'playing';
    this.turnStartedAt = this.now();
    this.lastDrawn = null;
  }
  #act(fn, event, onOk) {
    if (this.phase !== 'playing' || !this.game) return fail('No hay ronda activa');
    const res = fn(this.game);
    if (!res.ok) return res;
    onOk?.(res);
    const ev = event?.(res);
    this.#after(res);
    return { ok: true, event: ev };
  }
  // Solo el descarte trae roundOver (true/false): si la ronda sigue, empieza el turno del siguiente.
  #after(res) {
    if (res.roundOver) this.#finishRound(res.scores);
    else if (res.roundOver === false) { this.turnStartedAt = this.now(); this.lastDrawn = null; }
  }
  #finishRound(scores) {
    this.roundScores = scores;
    for (const id of this.order) this.totals[id] += scores[id];
    this.phase = this.roundIndex + 1 >= TOTAL_ROUNDS ? 'finished' : 'roundOver';
  }

  // Vista PERSONALIZADA: solo tu mano completa; de los demás, solo cuántas cartas tienen.
  // extra: datos de la sala (cuota, código, premios…).
  viewFor(me, extra = {}) {
    const phase = this.phase;
    const players = this.order.map((id) => ({
      id,
      name: this.names.get(id),
      connected: this.connected.has(id),
      level: this.levels.get(id) ?? null,
      total: this.totals[id] ?? 0,
      ...(this.game && { cards: this.game.hands[id].length, planted: this.game.planted[id] }),
    }));
    const base = { phase, you: me, host: this.host, players, turnTime: this.turnTime, ...extra };
    if (phase === 'lobby' || !this.game) return base;

    const g = this.game;
    const view = {
      ...base,
      round: this.roundIndex + 1,
      requirement: ROUND_REQUIREMENTS[this.roundIndex],
      totalRounds: TOTAL_ROUNDS,
      current: g.currentPlayer,
      turnPhase: g.phase, // 'start' | 'main' | 'ended'
      turnMsLeft: this.deadline == null ? null : Math.max(0, this.deadline - this.now()),
      drawn: me === g.currentPlayer ? this.lastDrawn : null, // la carta que acabas de tomar (solo la ves tú)
      stoleThisTurn: g.stoleThisTurn,
      discardTop: g.discardTop,
      deckCount: g.deck.length,
      melds: g.melds,
      recentCardIds: g.recentCardIds,
      hand: g.hands[me] ?? [],
      handPoints: (g.hands[me] ?? []).reduce((s, c) => s + cardPoints(c), 0),
    };
    if (phase === 'roundOver' || phase === 'finished') {
      view.winner = g.winner;
      view.roundScores = this.roundScores;
      view.hands = g.hands; // al terminar la ronda se revelan las cartas restantes
      if (phase === 'finished') {
        const best = Math.min(...this.order.map((id) => this.totals[id]));
        view.gameWinners = this.order.filter((id) => this.totals[id] === best);
      }
    }
    return view;
  }
}
