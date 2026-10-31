import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTurn } from '../src/logic/turn.js';
import { Round } from '../src/logic/game.js';
import { c, cs, ids } from './helpers.js';

const grp = (cards, extra = {}) => ({ cardIds: ids(cards), ...extra });
const run = (suit, ...values) => ({ kind: 'run', suit, slots: values.map((v) => ({ card: c(`${v}${suit}`), value: v })) });

// Ronda 1 (3 tríos) con una mano lista para plantarse.
function plantHand() {
  const t = cs('5♥', '5♠', '5♦', '7♥', '7♠', '7♦', '9♥', '9♠', '9♦', 'K♣', '8♥');
  return { t, plant: [grp(t.slice(0, 3)), grp(t.slice(3, 6)), grp(t.slice(6, 9))] };
}
const base = (hand, extra = {}) => ({ hand, melds: [], planted: false, stoleThisTurn: false, roundIndex: 0, nextMeldId: 1, ...extra });

test('resolveTurn: plantarse completo deja la mano sin las cartas jugadas', () => {
  const { t, plant } = plantHand();
  const res = resolveTurn(base(t), 'A', { plant, discard: t[9].id });
  assert.equal(res.ok, true);
  assert.equal(res.planted, true);
  assert.equal(res.plantedNow, true);
  assert.equal(res.melds.length, 3);
  assert.deepEqual(ids(res.hand), ids(t.slice(9)));   // el descarte sigue en la mano (lo saca discard)
  assert.equal(res.nextMeldId, 4);
});

test('resolveTurn: no modifica el estado recibido', () => {
  const { t, plant } = plantHand();
  const meld = { id: 1, owner: 'B', meld: run('♥', 5, 6, 7) };
  const st = base(t, { melds: [meld], planted: false });
  const before = JSON.stringify(st);
  const res = resolveTurn(st, 'A', { plant, hooks: [{ meldId: 1, cardId: t[10].id }], discard: t[9].id });
  assert.equal(res.ok, true);
  assert.equal(JSON.stringify(st), before);
  assert.equal(res.melds[0].meld.slots.length, 4); // la copia cambia...
  assert.equal(st.melds[0].meld.slots.length, 3);  // ...el original no
});

test('resolveTurn: plantarse y enganchar en el mismo turno (8♥ en el 5-6-7♥ ajeno)', () => {
  const { t, plant } = plantHand();
  const st = base(t, { melds: [{ id: 1, owner: 'B', meld: run('♥', 5, 6, 7) }], nextMeldId: 2 });
  const res = resolveTurn(st, 'A', { plant, hooks: [{ meldId: 1, cardId: t[10].id, end: 'high' }], discard: t[9].id });
  assert.equal(res.ok, true);
  assert.equal(res.hooked, 1);
  assert.equal(res.melds[0].meld.slots.at(-1).value, 8);
  assert.deepEqual(ids(res.hand), [t[9].id]);
});

test('resolveTurn: requisito incompleto o incorrecto se rechaza', () => {
  const { t, plant } = plantHand();
  assert.match(resolveTurn(base(t), 'A', { plant: plant.slice(0, 2), discard: t[9].id }).error, /requisito/);
  assert.match(resolveTurn(base(t, { roundIndex: 2 }), 'A', { plant: plant.slice(0, 2), discard: t[9].id }).error, /requisito/);
});

test('resolveTurn: bajar o enganchar sin estar plantado se rechaza', () => {
  const { t } = plantHand();
  assert.match(resolveTurn(base(t), 'A', { melds: [grp(t.slice(0, 3))], discard: t[9].id }).error, /plantarte/);
  const st = base(t, { melds: [{ id: 1, owner: 'B', meld: run('♥', 5, 6, 7) }] });
  assert.match(resolveTurn(st, 'A', { hooks: [{ meldId: 1, cardId: t[10].id }], discard: t[9].id }).error, /plantarte/);
});

test('resolveTurn: ya plantado baja combinaciones y engancha en el plante recién bajado', () => {
  const t = cs('3♣', '4♣', '5♣', '6♣', 'K♦', 'Q♠');
  const res = resolveTurn(base(t, { planted: true, nextMeldId: 7 }), 'A', {
    melds: [grp(t.slice(0, 3))],
    hooks: [{ meldId: 7, cardId: t[3].id }],
    discard: t[5].id,
  });
  assert.equal(res.ok, true);
  assert.equal(res.laid, 1);
  assert.equal(res.melds[0].meld.slots.length, 4);
  assert.deepEqual(ids(res.hand), ids([t[4], t[5]]));
});

test('resolveTurn: cartas repetidas, ajenas o usadas también como descarte', () => {
  const t = cs('3♣', '4♣', '5♣', 'K♦');
  const st = base(t, { planted: true });
  assert.match(resolveTurn(st, 'A', { melds: [grp(t.slice(0, 3))], discard: t[0].id }).error, /repetidas/);
  assert.match(resolveTurn(st, 'A', { melds: [grp([...t.slice(0, 2), c('5♣')])], discard: t[3].id }).error, /inválidas/);
  assert.match(resolveTurn(st, 'A', { melds: [{ cardIds: [t[0].id, t[0].id, t[1].id] }] }).error, /repetidas/);
});

test('resolveTurn: debes conservar una carta para descartar', () => {
  const t = cs('3♣', '4♣', '5♣');
  assert.match(resolveTurn(base(t, { planted: true }), 'A', { melds: [grp(t)] }).error, /conservar/);
});

test('resolveTurn: el robo de 2 impide plantarse ese turno', () => {
  const { t, plant } = plantHand();
  assert.match(resolveTurn(base(t, { stoleThisTurn: true }), 'A', { plant, discard: t[9].id }).error, /Robaste/);
});

test('resolveTurn: el 2 vale por su posición también dentro de la jugada', () => {
  const t = cs('5♥', '6♥', '2♣', 'K♦');
  const res = resolveTurn(base(t, { planted: true }), 'A', { melds: [grp(t.slice(0, 3), { ordered: true })], discard: t[3].id });
  assert.equal(res.ok, true);
  assert.equal(res.melds[0].meld.slots[2].value, 7);
});

test('resolveTurn: enganche inválido o en plante inexistente', () => {
  const t = cs('9♠', 'K♦');
  const st = base(t, { planted: true, melds: [{ id: 1, owner: 'B', meld: run('♥', 5, 6, 7) }] });
  assert.match(resolveTurn(st, 'A', { hooks: [{ meldId: 1, cardId: t[0].id }], discard: t[1].id }).error, /extiende/);
  assert.match(resolveTurn(st, 'A', { hooks: [{ meldId: 9, cardId: t[0].id }], discard: t[1].id }).error, /inexistente/);
  assert.match(resolveTurn(st, 'A', { hooks: [{ meldId: 1, cardId: t[0].id, end: 'x' }] }).error, /inválido/);
});

// ---------- Round.playTurn: atómico ----------
function roundWith(hand, roundIndex = 0) {
  const r = new Round(['A', 'B', 'C'], roundIndex);
  r.turnIndex = 0; r.phase = 'main'; r.hands.A = hand;
  return r;
}

test('playTurn: plantarse + descartar pasa el turno', () => {
  const { t, plant } = plantHand();
  const r = roundWith(t);
  const res = r.playTurn('A', { plant, discard: t[9].id });
  assert.equal(res.ok, true);
  assert.equal(res.plantedNow, true);
  assert.equal(r.planted.A, true);
  assert.equal(r.melds.length, 3);
  assert.deepEqual(ids(r.hands.A), [t[10].id]);
  assert.equal(r.discardTop.id, t[9].id);
  assert.equal(r.currentPlayer, 'B');
  assert.deepEqual(new Set(r.recentCardIds), new Set(ids(t.slice(0, 9))));
});

test('playTurn: jugada inválida NO cambia nada y el turno no pasa', () => {
  const { t, plant } = plantHand();
  const r = roundWith(t);
  r.melds.push({ id: 1, owner: 'B', meld: run('♠', 5, 6, 7) });
  r.nextMeldId = 2;
  const snap = JSON.stringify({ h: r.hands, m: r.melds, p: r.planted, d: r.discardTop, n: r.nextMeldId });
  // plante válido, pero el enganche falla (8♥ no extiende un consecutivo de ♠): todo se rechaza
  const res = r.playTurn('A', { plant, hooks: [{ meldId: 1, cardId: t[10].id }], discard: t[9].id });
  assert.equal(res.ok, false);
  assert.equal(JSON.stringify({ h: r.hands, m: r.melds, p: r.planted, d: r.discardTop, n: r.nextMeldId }), snap);
  assert.equal(r.currentPlayer, 'A');
  assert.equal(r.phase, 'main');
});

test('playTurn: exige descarte, turno y fase', () => {
  const { t, plant } = plantHand();
  const r = roundWith(t);
  assert.match(r.playTurn('A', { plant }).error, /descartar/);
  assert.match(r.playTurn('B', { discard: t[0].id }).error, /turno/);
  r.phase = 'start';
  assert.match(r.playTurn('A', { discard: t[0].id }).error, /toma/);
});

test('playTurn: solo descartar sigue siendo una jugada válida', () => {
  const r = roundWith(cs('3♣', 'K♦'));
  const res = r.playTurn('A', { discard: r.hands.A[1].id });
  assert.equal(res.ok, true);
  assert.equal(res.roundOver, false);
  assert.equal(r.currentPlayer, 'B');
});

test('playTurn: bajar todo menos una y descartarla gana la ronda', () => {
  const t = cs('3♣', '4♣', '5♣', 'K♦');
  const r = roundWith(t);
  r.planted.A = true;
  const res = r.playTurn('A', { melds: [grp(t.slice(0, 3))], discard: t[3].id });
  assert.equal(res.ok, true);
  assert.equal(res.roundOver, true);
  assert.equal(r.winner, 'A');
});
