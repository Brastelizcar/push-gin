import test from 'node:test';
import assert from 'node:assert/strict';
import { findPlantGroups, findFreeMelds, planHooks } from '../src/logic/plan.js';
import { buildSet, buildRun, meldCards } from '../src/logic/melds.js';
import { ROUND_REQUIREMENTS } from '../src/logic/rounds.js';
import { cs, c } from './helpers.js';

const sizes = (g) => g.map((x) => x.cards.length).sort();

test('ronda 1: 9 cartas desordenadas se reparten en 3 tríos', () => {
  const hand = cs('5♥', '9♠', '7♦', '5♠', '9♥', '7♥', '5♦', '9♦', '7♠');
  const g = findPlantGroups(hand, ROUND_REQUIREMENTS[0]);
  assert.deepEqual(sizes(g), [3, 3, 3]);
  g.forEach((x) => assert.ok(buildSet(x.cards)));
});
test('ronda 1: con comodines', () => {
  const g = findPlantGroups(cs('5♥', '5♠', '2♦', '9♥', '9♠', '2♣', 'K♥', 'K♦', 'K♠'), ROUND_REQUIREMENTS[0]);
  assert.ok(g);
});
test('ronda 2: trío + consecutivo de 5 mezclados', () => {
  const hand = cs('4♣', '9♥', '5♣', '9♠', '6♣', '9♦', '7♣', '8♣');
  const g = findPlantGroups(hand, ROUND_REQUIREMENTS[1]);
  assert.deepEqual(sizes(g), [3, 5]);
});
test('ronda 3: dos consecutivos de 6', () => {
  const hand = cs('3♥', '4♥', '5♥', '6♥', '7♥', '8♥', '9♠', '10♠', 'J♠', 'Q♠', 'K♠', 'A♠');
  assert.deepEqual(sizes(findPlantGroups(hand, ROUND_REQUIREMENTS[2])), [6, 6]);
});
test('ronda 4: cuatro tríos (12 cartas)', () => {
  const hand = cs('3♥', '3♠', '3♦', '4♥', '4♠', '4♦', '5♥', '5♠', '5♦', '6♥', '6♠', '6♦');
  assert.deepEqual(sizes(findPlantGroups(hand, ROUND_REQUIREMENTS[3])), [3, 3, 3, 3]);
});
test('ronda 5: cuarteto + consecutivo de 8', () => {
  const hand = cs('4♥', '4♠', '4♦', '4♣', 'Q♠', '5♠', '6♠', '7♠', '8♠', '9♠', '10♠', 'J♠');
  assert.deepEqual(sizes(findPlantGroups(hand, ROUND_REQUIREMENTS[4])), [4, 8]);
});
test('plantarse: devuelve null si no cumple o la cantidad no es exacta', () => {
  assert.equal(findPlantGroups(cs('5♥', '5♠', '5♦', '7♥', '7♠', '7♦', '9♥', '9♠', '9♥'), ROUND_REQUIREMENTS[0]), null); // 9♥ repetido
  assert.equal(findPlantGroups(cs('5♥', '5♠', '5♦'), ROUND_REQUIREMENTS[0]), null);
});
test('bajar: reparte en tríos y consecutivos libres', () => {
  const g = findFreeMelds(cs('4♣', '9♥', '5♣', '9♠', '6♣', '9♦'));
  assert.deepEqual(sizes(g), [3, 3]);
  assert.equal(findFreeMelds(cs('4♣', '9♥', '5♣')), null);
  assert.equal(findFreeMelds(cs('4♣', '5♣')), null);
});
test('enganchar varias cartas a un consecutivo, en el orden correcto', () => {
  const run = buildRun(cs('5♥', '6♥', '7♥'));
  const plan = planHooks(run, [c('9♥'), c('8♥'), c('4♥')]); // 9 solo cabe después del 8
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((p) => p.card.rank), ['8', '9', '4']);
});
test('enganchar a un trío: solo hasta cuarteto y con palo nuevo', () => {
  const set = buildSet(cs('5♥', '5♠', '5♦'));
  assert.ok(planHooks(set, [c('5♣')]));
  assert.equal(planHooks(set, [c('5♥')]), null);
  assert.equal(planHooks(set, [c('5♣'), c('2♣')]), null); // ya sería de 5
});
