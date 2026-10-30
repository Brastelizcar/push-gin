// Estado y turnos de UNA ronda. Pensado para vivir en el servidor (Colyseus) más adelante:
// cada método valida y devuelve { ok:true, ... } o { ok:false, error }.
import { makeDeck, shuffle, cardPoints } from './cards.js';
import { matchPlant } from './rounds.js';
import { buildSet, buildRun, extendMeld, stealTwo, meldCards } from './melds.js';

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
  _cardsFromHand(pid, ids) {
    if (new Set(ids).size !== ids.length) return null;
    const cards = ids.map((id) => this.hands[pid].find((c) => c.id === id));
    return cards.every(Boolean) ? cards : null;
  }
  _removeFromHand(pid, cards) {
    const ids = new Set(cards.map((c) => c.id));
    this.hands[pid] = this.hands[pid].filter((c) => !ids.has(c.id));
  }
  _parseGroups(pid, groups) {
    const all = groups.flatMap((g) => g.cardIds);
    const flat = this._cardsFromHand(pid, all);
    if (!flat) return { error: 'Cartas inválidas o repetidas' };
    let i = 0;
    const parsed = groups.map((g) => ({ cards: flat.slice(i, (i += g.cardIds.length)), start: g.start, ordered: g.ordered === true }));
    return { groups: parsed, count: flat.length };
  }
  _markRecent(cards) {
    if (this._freshTurn) { this.recentCardIds = []; this._freshTurn = false; }
    this.recentCardIds.push(...cards.map((c) => c.id));
  }
  _addMelds(pid, melds) {
    for (const meld of melds) this.melds.push({ id: this.nextMeldId++, owner: pid, meld });
    this._markRecent(melds.flatMap(meldCards));
  }
  _mustKeepOne(pid, removing) {
    return this.hands[pid].length - removing < 1;
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
    const blind = this._draw();
    this.hands[this.nextPlayer].push(blind, this.discardTop);
    this.discardTop = null;
    const own = this._draw();
    this.hands[pid].push(own);
    this.phase = 'main';
    return ok({ pushed: [blind], drew: own });
  }

  // ---------- Fase 'main' ----------
  // groups: [{ cardIds:[...], start? }]
  plant(pid, groups) {
    const g = this._guard(pid, 'main'); if (g) return g;
    if (this.planted[pid]) return fail('Ya te plantaste');
    if (this.stoleThisTurn) return fail('Robaste un 2: no puedes plantarte este turno');
    const p = this._parseGroups(pid, groups);
    if (p.error) return fail(p.error);
    const melds = matchPlant(p.groups, this.roundIndex);
    if (!melds) return fail('Las cartas no cumplen exactamente el requisito de la ronda');
    if (this._mustKeepOne(pid, p.count)) return fail('Debes conservar al menos una carta para descartar');
    this._removeFromHand(pid, p.groups.flatMap((x) => x.cards));
    this._addMelds(pid, melds);
    this.planted[pid] = true;
    return ok({ melds });
  }

  // Ya plantado: bajar nuevos tríos/cuartetos/consecutivos.
  layMelds(pid, groups) {
    const g = this._guard(pid, 'main'); if (g) return g;
    if (!this.planted[pid]) return fail('Primero debes plantarte');
    const p = this._parseGroups(pid, groups);
    if (p.error) return fail(p.error);
    const melds = p.groups.map((x) => buildSet(x.cards) ?? buildRun(x.cards, { start: x.start, ordered: x.ordered }));
    if (melds.some((m) => !m)) return fail('Alguna combinación no es válida');
    if (this._mustKeepOne(pid, p.count)) return fail('Debes conservar al menos una carta para descartar');
    this._removeFromHand(pid, p.groups.flatMap((x) => x.cards));
    this._addMelds(pid, melds);
    return ok({ melds });
  }

  // Enganche en plante propio o ajeno. end: 'low' | 'high' (solo consecutivos ambiguos).
  hook(pid, meldId, cardId, end) {
    const g = this._guard(pid, 'main'); if (g) return g;
    if (!this.planted[pid]) return fail('Primero debes plantarte');
    const entry = this.melds.find((m) => m.id === meldId);
    if (!entry) return fail('Plante inexistente');
    const card = this.hands[pid].find((c) => c.id === cardId);
    if (!card) return fail('Carta no está en tu mano');
    if (this._mustKeepOne(pid, 1)) return fail('Debes conservar al menos una carta para descartar');
    const next = extendMeld(entry.meld, card, end);
    if (!next) return fail('La carta no extiende ese plante');
    entry.meld = next;
    this._removeFromHand(pid, [card]);
    this._markRecent([card]);
    return ok();
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
