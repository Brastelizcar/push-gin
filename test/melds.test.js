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
test('trío: el palo no importa y puede tener más de 4 cartas', () => {
  assert.ok(buildSet(cs('5♥', '5♥', '5♦')));                          // palo repetido (3 barajas)
  assert.ok(buildSet(cs('5♥', '5♥', '5♥')));
  assert.equal(buildSet(cs('5♥', '5♠', '5♦', '5♣', '2♣')).cards.length, 5);
  assert.equal(buildSet(cs('5♥', '5♠', '5♦', '5♣', '5♥', '5♠')).cards.length, 6);
});
test('trío inválido: rangos distintos o menos de 3 cartas', () => {
  assert.equal(buildSet(cs('5♥', '6♠', '5♦')), null);
  assert.equal(buildSet(cs('5♥', '5♠')), null);
});
test('el 2 es solo comodín: no hay tríos de 2s ni grupos sin una carta natural', () => {
  assert.equal(buildSet(cs('2♥', '2♠', '2♦')), null);
  assert.equal(buildRun(cs('2♥', '2♠', '2♦')), null);
  assert.equal(buildRun(cs('A♥', '2♥', '3♥')), null);                 // el 2 no va "en su lugar": no hay A-2-3
  assert.equal(buildSet(cs('5♥', '2♠', '2♦')).rank, '5');             // con un natural, los 2 valen ese número
});
test('consecutivo simple, con hueco y comodín', () => {
  assert.ok(buildRun(cs('5♥', '6♥', '7♥', '8♥', '9♥')));
  const r = buildRun(cs('5♥', '2♠', '7♥'));
  assert.deepEqual(r.slots.map((s) => s.value), [5, 6, 7]);
});
test('el orden es 3…K,A: el As solo va después de la K (no hay A-3-4 ni K-A-3)', () => {
  assert.deepEqual(buildRun(cs('Q♥', 'K♥', 'A♥')).slots.map((s) => s.value), [12, 13, 14]);
  assert.equal(buildRun(cs('A♥', '3♥', '4♥')), null);
  assert.equal(buildRun(cs('K♥', 'A♥', '3♥')), null);
  assert.ok(extendMeld(buildRun(cs('J♥', 'Q♥', 'K♥')), c('A♥')));      // el As se engancha después de la K
  assert.equal(extendMeld(buildRun(cs('3♥', '4♥', '5♥')), c('A♥')), null); // no antes del 3
  assert.equal(extendMeld(buildRun(cs('Q♥', 'K♥', 'A♥')), c('2♠')).slots[0].value, 11); // tras el As no hay nada
  assert.equal(extendMeld(buildRun(cs('3♥', '4♥', '5♥')), c('2♠'), 'low'), null);   // ni antes del 3
});
test('el 2 vale por la posición donde se ubica (consecutivo en orden)', () => {
  const val = (r) => r.slots.map((s) => s.value);
  assert.deepEqual(val(buildRun(cs('5♥', '6♥', '2♠'), { ordered: true })), [5, 6, 7]);   // el 2 hace de 7
  assert.deepEqual(val(buildRun(cs('2♠', '5♥', '6♥'), { ordered: true })), [4, 5, 6]);   // el 2 hace de 4
  assert.deepEqual(val(buildRun(cs('5♥', '2♦', '7♥'), { ordered: true })), [5, 6, 7]);   // en medio
  assert.deepEqual(val(buildRun(cs('6♥', '5♥', '2♠'), { ordered: true })), [4, 5, 6]);   // descendente: el 2 es 4
  assert.equal(buildRun(cs('6♥', '2♠', '5♥'), { ordered: true }), null);                  // fuera de orden
  assert.ok(buildRun(cs('6♥', '5♥', '2♠')));                                              // sin ordered se acomoda solo
  assert.deepEqual(val(buildRun(cs('A♥', 'K♥', '2♠'), { ordered: true })), [12, 13, 14]); // descendente: el 2 es Q
  assert.deepEqual(val(buildRun(cs('8♥', '7♥', '2♠'), { ordered: true })), [6, 7, 8]);
  assert.equal(buildRun(cs('2♠', '3♥', '4♥'), { ordered: true }), null);                  // antes del 3 no hay nada
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
test('enganche: extiende por ambos extremos; el trío crece sin límite y con cualquier palo', () => {
  const run = buildRun(cs('5♥', '6♥', '7♥'));
  assert.equal(meldCards(extendMeld(run, c('8♥'))).length, 4);
  assert.equal(meldCards(extendMeld(run, c('4♥'))).length, 4);
  assert.equal(extendMeld(run, c('9♥')), null);
  assert.equal(extendMeld(run, c('8♠')), null);
  const set = buildSet(cs('5♥', '5♠', '5♦'));
  const four = extendMeld(set, c('5♣'));
  assert.equal(four.cards.length, 4);
  assert.equal(extendMeld(four, c('5♥')).cards.length, 5);   // palo repetido y más de 4
  assert.equal(extendMeld(four, c('2♥')).cards.length, 5);
  assert.equal(extendMeld(four, c('6♥')), null);
  const full = buildRun(cs('3♠', '4♠', '5♠', '6♠', '7♠', '8♠', '9♠', '10♠', 'J♠', 'Q♠', 'K♠', 'A♠'));
  assert.equal(full.slots.length, 12);                         // 3 a A: el consecutivo más largo
  assert.equal(extendMeld(full, c('2♥')), null);
});
test('robo de 2: solo con carta que encaja exacto', () => {
  const run = buildRun(cs('5♥', '2♠', '7♥'));
  assert.equal(stealTwo(run, 1, c('6♠')), null);
  const res = stealTwo(run, 1, c('6♥'));
  assert.equal(res.stolen.rank, '2');
  assert.equal(res.meld.slots[1].card.rank, '6');
  const set = buildSet(cs('5♥', '5♠', '2♦'));
  assert.equal(stealTwo(set, 2, c('6♦')), null);
  assert.ok(stealTwo(set, 2, c('5♥')));                        // en un trío sirve cualquier palo
  assert.equal(stealTwo(set, 0, c('5♦')), null);               // solo se roba un 2
});
test('requisito por ronda: es el mínimo (grupos más grandes valen)', () => {
  const g = (...a) => ({ cards: cs(...a) });
  const r1 = [g('5♥', '5♠', '5♦'), g('7♥', '7♠', '7♦'), g('K♥', 'K♠', '2♦')];
  assert.ok(matchPlant(r1, 0));
  assert.equal(matchPlant(r1.slice(0, 2), 0), null);
  const r2 = [g('9♣', '9♥', '9♦'), g('3♥', '4♥', '5♥', '6♥', '7♥')];
  assert.ok(matchPlant(r2, 1));
  assert.equal(matchPlant(r2, 0), null);
  const r5 = [g('4♥', '4♠', '4♦', '4♣'), g('3♠', '4♠', '5♠', '6♠', '7♠', '8♠', '9♠', '10♠')];
  assert.ok(matchPlant(r5, 4));
  // Ronda 1 con dos tríos y un cuarteto; ronda 2 con un consecutivo de 7; ronda 5 con 5 iguales.
  assert.ok(matchPlant([g('5♥', '5♠', '5♦'), g('7♥', '7♠', '7♦'), g('K♥', 'K♠', 'K♦', 'K♣')], 0));
  assert.ok(matchPlant([g('9♣', '9♥', '9♦'), g('3♥', '4♥', '5♥', '6♥', '7♥', '8♥', '9♥')], 1));
  assert.ok(matchPlant([g('4♥', '4♠', '4♦', '4♣', '4♥'), r5[1]], 4));
  // Pero nunca más chicos: un trío no cumple un cuarteto ni un consecutivo de 4 uno de 5.
  assert.equal(matchPlant([g('4♥', '4♠', '4♦'), r5[1]], 4), null);
  assert.equal(matchPlant([g('9♣', '9♥', '9♦'), g('3♥', '4♥', '5♥', '6♥')], 1), null);
});
