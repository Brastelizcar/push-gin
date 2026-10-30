import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSet, buildRun, extendMeld, stealTwo, meldCards } from '../src/logic/melds.js';
import { matchPlant } from '../src/logic/rounds.js';
import { c, cs } from './helpers.js';

test('trío válido, con comodín y cuarteto', () => {
  assert.ok(buildSet(cs('5♥', '5♠', '5♦')));
  assert.ok(buildSet(cs('5♥', '5♠', '2♦')));
  assert.ok(buildSet(cs('5♥', '5♠', '5♦', '5♣')));
});
test('trío inválido: palo repetido, rangos distintos, 5 cartas', () => {
  assert.equal(buildSet(cs('5♥', '5♥', '5♦')), null);
  assert.equal(buildSet(cs('5♥', '6♠', '5♦')), null);
  assert.equal(buildSet(cs('5♥', '5♠', '5♦', '5♣', '2♣')), null);
});
test('el 2 también es un número: trío de 2s (palos distintos)', () => {
  assert.ok(buildSet(cs('2♥', '2♠', '2♦')));
  assert.equal(buildSet(cs('2♥', '2♥', '2♦')), null);
  const four = extendMeld(buildSet(cs('2♥', '2♠', '2♦')), c('2♣'));
  assert.equal(four.cards.length, 4);
  assert.equal(extendMeld(buildSet(cs('2♥', '2♠', '2♦')), c('2♥')), null);   // palo repetido
  assert.equal(extendMeld(buildSet(cs('2♥', '2♠', '2♦')), c('5♣')), null);   // solo 2s
});
test('consecutivo simple, con hueco y comodín', () => {
  assert.ok(buildRun(cs('5♥', '6♥', '7♥', '8♥', '9♥')));
  const r = buildRun(cs('5♥', '2♠', '7♥'));
  assert.deepEqual(r.slots.map((s) => s.value), [5, 6, 7]);
});
test('el orden es A,2,3…K: el As solo va al principio (no existe Q-K-A ni K-A-2)', () => {
  assert.ok(buildRun(cs('A♥', '2♥', '3♥')));
  assert.equal(buildRun(cs('Q♥', 'K♥', 'A♥')), null);
  assert.equal(buildRun(cs('K♥', 'A♥', '2♥')), null);
  const kRun = buildRun(cs('J♥', 'Q♥', 'K♥'));
  assert.equal(extendMeld(kRun, c('A♥')), null);          // no se engancha un As después de la K
  assert.ok(extendMeld(buildRun(cs('2♥', '3♥', '4♥')), c('A♥'))); // sí antes del 2
});
test('el 2 vale por la posición donde se ubica (consecutivo en orden)', () => {
  const val = (r) => r.slots.map((s) => s.value);
  assert.deepEqual(val(buildRun(cs('5♥', '6♥', '2♠'), { ordered: true })), [5, 6, 7]);   // el 2 hace de 7
  assert.deepEqual(val(buildRun(cs('2♠', '5♥', '6♥'), { ordered: true })), [4, 5, 6]);   // el 2 hace de 4
  assert.deepEqual(val(buildRun(cs('5♥', '2♦', '7♥'), { ordered: true })), [5, 6, 7]);   // en medio
  assert.equal(buildRun(cs('6♥', '5♥', '2♠'), { ordered: true }), null);                  // fuera de orden
  assert.ok(buildRun(cs('6♥', '5♥', '2♠')));                                              // sin ordered se acomoda solo
  assert.equal(buildRun(cs('2♠', '3♥', '4♥'), { ordered: true }).slots[0].value, 2);     // el 2 natural en su sitio
});
test('consecutivo inválido: palos mezclados o repetidos', () => {
  assert.equal(buildRun(cs('5♥', '6♠', '7♥')), null);
  assert.equal(buildRun(cs('5♥', '5♥', '6♥')), null);
});
test('start desambigua la posición del comodín', () => {
  const cards = cs('5♥', '6♥', '2♠');
  assert.deepEqual(buildRun(cards).slots.map((s) => s.value), [4, 5, 6]);
  assert.deepEqual(buildRun(cards, { start: 5 }).slots.map((s) => s.value), [5, 6, 7]);
});
test('enganche: extiende por ambos extremos y no pasa de cuarteto', () => {
  const run = buildRun(cs('5♥', '6♥', '7♥'));
  assert.equal(meldCards(extendMeld(run, c('8♥'))).length, 4);
  assert.equal(meldCards(extendMeld(run, c('4♥'))).length, 4);
  assert.equal(extendMeld(run, c('9♥')), null);
  assert.equal(extendMeld(run, c('8♠')), null);
  const set = buildSet(cs('5♥', '5♠', '5♦'));
  const four = extendMeld(set, c('5♣'));
  assert.equal(four.cards.length, 4);
  assert.equal(extendMeld(four, c('5♥')), null);
  assert.equal(extendMeld(set, c('5♥')), null); // palo repetido
});
test('un 2 que está en su propio lugar (o en un trío de 2s) es un número y no se puede robar', () => {
  assert.equal(stealTwo(buildRun(cs('A♠', '2♠', '3♠')), 1, c('3♠')), null);
  assert.equal(stealTwo(buildSet(cs('2♥', '2♠', '2♦')), 0, c('5♥')), null);
});
test('robo de 2: solo con carta que encaja exacto', () => {
  const run = buildRun(cs('5♥', '2♠', '7♥'));
  assert.equal(stealTwo(run, 1, c('6♠')), null);
  const res = stealTwo(run, 1, c('6♥'));
  assert.equal(res.stolen.rank, '2');
  assert.equal(res.meld.slots[1].card.rank, '6');
  const set = buildSet(cs('5♥', '5♠', '2♦'));
  assert.equal(stealTwo(set, 2, c('5♥')), null);
  assert.ok(stealTwo(set, 2, c('5♦')));
});
test('requisito por ronda: exacto', () => {
  const g = (...a) => ({ cards: cs(...a) });
  const r1 = [g('5♥', '5♠', '5♦'), g('7♥', '7♠', '7♦'), g('K♥', 'K♠', '2♦')];
  assert.ok(matchPlant(r1, 0));
  assert.equal(matchPlant(r1.slice(0, 2), 0), null);
  const r2 = [g('9♣', '9♥', '9♦'), g('3♥', '4♥', '5♥', '6♥', '7♥')];
  assert.ok(matchPlant(r2, 1));
  assert.equal(matchPlant(r2, 0), null);
  const r5 = [g('4♥', '4♠', '4♦', '4♣'), g('3♠', '4♠', '5♠', '6♠', '7♠', '8♠', '9♠', '10♠')];
  assert.ok(matchPlant(r5, 4));
});
