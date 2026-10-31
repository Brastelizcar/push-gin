// Estado y turnos de UNA ronda. Pensado para vivir en el servidor (Colyseus) más adelante:
// cada método valida y devuelve { ok:true, ... } o { ok:false, error }.
import { makeDeck, shuffle, cardPoints } from './cards.js';
import { stealTwo } from './melds.js';
import { resolveTurn } from './turn.js';

export const HAND_SIZE = 10;
const fail = (error) => ({ ok: false, error });
const ok = (extra = {}) => ({ ok: true, ...extra });

export class Round {
  constructor(playerIds, roundIndex, { rng = Math.random } = {}) {
    if (playerIds.length < 2 || playerIds.length > 4) throw new Error('Se juega de 2 a 4 jugadores');
    this.roundIndex = roundIndex;
    this.players = [...playerIds];
    this.deck = shuffle(makeDeck(3), rng);
    this.hands = Object.fromEntries(this.players.map((id) => [id, []]));
    for (let i = 0; i < HAND_SIZE; i++) for (const p of this.players) this.hands[p].push(this.deck.pop());
    this.discardTop = this.deck.pop();
    this.turnIndex = roundIndex % this.players.length;
    this.phase = 'start'; // 'start' (antes de tomar carta) | 'main' (ya tomó, falta descartar) | 'ended'
    this.planted = Object.fromEntries(this.players.map((id) => [id, false]));
    this.melds = []; // { id, owner, meld }
    this.nextMeldId = 1;
    this.stoleThisTurn = false;
    this.recentCardIds = []; // cartas bajadas por el último jugador que jugó (para resaltarlas)
    this._freshTurn = true;
    this.winner = null;
    this.finalTurnsLeft = null; // mazo agotado: turnos que quedan de la última vuelta (null = todavía hay mazo)
  }

  get currentPlayer() { return this.players[this.turnIndex]; }
  get nextPlayer() { return this.players[(this.turnIndex + 1) % this.players.length]; }

  // ---------- helpers ----------
  _guard(pid, phase) {
    if (this.phase === 'ended') return fail('La ronda terminó');
    if (pid !== this.currentPlayer) return fail('No es tu turno');
    if (this.phase !== phase)
      return fail(phase === 'start' ? 'Eso solo se puede hacer antes de tomar carta' : 'Primero toma el descarte o haz push');
    return null;
  }
  _draw() {
    if (!this.deck.length) throw new Error('Mazo vacío (no debería pasar con 3 barajas)');
    return this.deck.pop();
  }
  _removeFromHand(pid, cards) {
    const ids = new Set(cards.map((c) => c.id));
    this.hands[pid] = this.hands[pid].filter((c) => !ids.has(c.id));
  }
  _markRecent(cards) {
    if (this._freshTurn) { this.recentCardIds = []; this._freshTurn = false; }
    this.recentCardIds.push(...cards.map((c) => c.id));
  }

  // ---------- Fase 'start' ----------
  // Robo de 2: solo si aún no te plantaste y solo de plantes de jugadores ya plantados.
  steal2(pid, meldId, index, cardId) {
    const g = this._guard(pid, 'start'); if (g) return g;
    if (this.planted[pid]) return fail('Ya te plantaste: no puedes robar 2s');
    const entry = this.melds.find((m) => m.id === meldId);
    if (!entry) return fail('Plante inexistente');
    if (!this.planted[entry.owner]) return fail('Ese jugador aún no se ha plantado');
    const card = this.hands[pid].find((c) => c.id === cardId);
    if (!card) return fail('Carta no está en tu mano');
    const res = stealTwo(entry.meld, index, card);
    if (!res) return fail('Esa carta no encaja en esa posición');
    entry.meld = res.meld;
    this._removeFromHand(pid, [card]);
    this.hands[pid].push(res.stolen);
    this.stoleThisTurn = true;
    return ok({ stolen: res.stolen });
  }

  takeDiscard(pid) {
    const g = this._guard(pid, 'start'); if (g) return g;
    this.hands[pid].push(this.discardTop);
    const taken = this.discardTop;
    this.discardTop = null;
    this.phase = 'main';
    return ok({ taken });
  }

  // Push: carta ciega del mazo + descarte actual pasan a la MANO del siguiente jugador;
  // el que hace push roba una carta propia. (Interpretación a confirmar, ver notas.)
  push(pid) {
    const g = this._guard(pid, 'start'); if (g) return g;
    if (this.deck.length < 2) return fail('El mazo se acabó: solo puedes tomar el descarte');
    const blind = this._draw();
    this.hands[this.nextPlayer].push(blind, this.discardTop);
    this.discardTop = null;
    const own = this._draw();
    this.hands[pid].push(own);
    this.phase = 'main';
    return ok({ pushed: [blind], drew: own });
  }

  // ---------- Fase 'main' ----------
  // Aplica (si es válida) una jugada de resolveTurn, sin descartar. Atómico: si falla, nada cambia.
  _commit(pid, turn) {
    const g = this._guard(pid, 'main'); if (g) return g;
    const res = resolveTurn({
      hand: this.hands[pid], melds: this.melds, planted: this.planted[pid],
      stoleThisTurn: this.stoleThisTurn, roundIndex: this.roundIndex, nextMeldId: this.nextMeldId,
    }, pid, turn);
    if (!res.ok) return res;
    this.hands[pid] = res.hand;
    this.melds = res.melds;
    this.nextMeldId = res.nextMeldId;
    this.planted[pid] = res.planted;
    if (res.playedCards.length) this._markRecent(res.playedCards);
    return res;
  }

  // Jugada COMPLETA del turno: plantarse/bajar/enganchar y descartar, todo o nada.
  // turn: { plant?, melds?, hooks?, discard } (ver turn.js). Si es inválida, el turno no pasa.
  playTurn(pid, turn) {
    if (typeof turn?.discard !== 'string') return fail('Elige una carta para descartar');
    const res = this._commit(pid, turn);
    if (!res.ok) return res;
    const d = this.discard(pid, turn.discard);
    return ok({ ...d, plantedNow: res.plantedNow, laid: res.laid, hooked: res.hooked });
  }

  // Acciones sueltas (las usa la lógica y las pruebas; el servidor solo expone playTurn).
  // groups: [{ cardIds:[...], start?, ordered? }]
  plant(pid, groups) {
    if (!groups?.length) return fail('Mensaje inválido');
    return this._commit(pid, { plant: groups });
  }

  // Ya plantado: bajar nuevos tríos/cuartetos/consecutivos.
  layMelds(pid, groups) {
    if (!groups?.length) return fail('Mensaje inválido');
    return this._commit(pid, { melds: groups });
  }

  // Enganche en plante propio o ajeno. end: 'low' | 'high' (solo consecutivos ambiguos).
  hook(pid, meldId, cardId, end) {
    return this._commit(pid, { hooks: [{ meldId, cardId, end }] });
  }

  discard(pid, cardId) {
    const g = this._guard(pid, 'main'); if (g) return g;
    const card = this.hands[pid].find((c) => c.id === cardId);
    if (!card) return fail('Carta no está en tu mano');
    this._removeFromHand(pid, [card]);
    this.discardTop = card;
    if (this.hands[pid].length === 0) {
      this.phase = 'ended';
      this.winner = pid;
      return ok({ roundOver: true, scores: this.scores() });
    }
    // Mazo agotado (no alcanza para otro push): se juega UNA vuelta más (cada jugador un turno, solo tomando el
    // descarte) y, si nadie se queda sin cartas, la ronda termina sin ganador y todos cuentan su mano.
    if (this.finalTurnsLeft !== null) {
      if (--this.finalTurnsLeft <= 0) {
        this.phase = 'ended';
        this.winner = null;
        return ok({ roundOver: true, exhausted: true, scores: this.scores() });
      }
    } else if (this.deck.length < 2) {
      this.finalTurnsLeft = this.players.length;
    }
    this.turnIndex = (this.turnIndex + 1) % this.players.length;
    this.phase = 'start';
    this.stoleThisTurn = false;
    this._freshTurn = true;
    return ok({ roundOver: false });
  }

  // Puntos de esta ronda: el ganador 0; el resto suma lo que le quedó en mano.
  scores() {
    return Object.fromEntries(
      this.players.map((id) => [id, id === this.winner ? 0 : this.hands[id].reduce((s, c) => s + cardPoints(c), 0)])
    );
  }
}
