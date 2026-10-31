import test from 'node:test';
import assert from 'node:assert/strict';
import { findPlantInHand, findFreeMeldsInHand, chooseDiscard, planTurn, findSteal, botMove, wantsDiscard } from '../src/logic/bot.js';
import { matchPlant, ROUND_REQUIREMENTS } from '../src/logic/rounds.js';
import { Match } from '../src/logic/match.js';
import { seededRng } from '../src/logic/cards.js';
import { buildRun } from '../src/logic/melds.js';
import { c, cs, ids } from './helpers.js';

const asGroups = (gs) => gs.map((cards) => ({ cards, ordered: true }));

test('encuentra los 3 tríos de la ronda 1 entre cartas desordenadas', () => {
  const hand = cs('9♦', '5♥', 'K♣', '7♠', '5♠', '9♥', '7♦', '5♦', '7♥', '9♠', 'Q♣');
  const g = findPlantInHand(hand, ROUND_REQUIREMENTS[0]);
  assert.equal(g.length, 3);
  assert.ok(matchPlant(asGroups(g), 0));
});

test('usa el 2 como comodín en el lugar que falta (ronda 2: trío + consecutivo de 5)', () => {
  const hand = cs('8♣', '8♥', '8♦', '4♠', '5♠', '2♥', '7♠', '8♠', 'K♦');
  const g = findPlantInHand(hand, ROUND_REQUIREMENTS[1]);
  assert.ok(g);
  const run = g.find((x) => x.length === 5);
  assert.deepEqual(buildRun(run, { ordered: true }).slots.map((s) => s.value), [4, 5, 6, 7, 8]);
  assert.ok(matchPlant(asGroups(g), 1));
});

test('no se planta si no tiene la combinación o si se quedaría sin carta para descartar', () => {
  assert.equal(findPlantInHand(cs('5♥', '5♠', '7♦', '7♥', '9♠', '9♦', 'K♣', 'Q♣', 'J♥', '3♣'), ROUND_REQUIREMENTS[0]), null);
  assert.equal(findPlantInHand(cs('5♥', '5♠', '5♦', '7♥', '7♠', '7♦', '9♥', '9♠', '9♦'), ROUND_REQUIREMENTS[0]), null);
});

test('las copias idénticas (3 barajas) nunca van juntas en un trío', () => {
  const g = findPlantInHand(cs('5♥', '5♥', '5♠', '5♦', '6♣', '6♥', '6♦', '7♣', '7♥', '7♦', 'K♠'), ROUND_REQUIREMENTS[0]);
  assert.ok(g.every((t) => new Set(t.map((x) => x.suit)).size === 3));
});

test('ya plantado: baja combinaciones libres y conserva una carta', () => {
  const free = findFreeMeldsInHand(cs('3♣', '4♣', '5♣', '6♣', 'Q♦', 'Q♥', 'Q♠', 'K♥'), 1);
  assert.deepEqual(free.map((g) => g.length).sort(), [3, 4]);
  assert.equal(findFreeMeldsInHand(cs('3♣', '4♣', '5♣'), 1).length, 0);   // usaría todas: no
});

test('descarte: nunca un 2 si hay otra; prefiere la carta suelta y de más puntos', () => {
  assert.equal(chooseDiscard(cs('2♣', 'K♦', '5♥', '5♠'), false).rank, 'K');
  assert.equal(chooseDiscard(cs('2♣', '2♥'), false).rank, '2');
  assert.equal(chooseDiscard(cs('3♣', 'A♦', '9♥'), true).rank, 'A');        // plantado: la que más pesa
  const h = cs('3♣', 'A♦', 'K♥');
  assert.equal(chooseDiscard(h, true, h[1].id).rank, 'K');                  // no devuelve la que acaba de tomar
});

test('toma el descarte solo si completa ya un trío o consecutivo, o es un 2; si no, push', () => {
  const v = (top, hand, planted = false, melds = []) => ({ you: 'A', discardTop: c(top), hand: cs(...hand), melds, players: [{ id: 'A', planted }] });
  assert.equal(wantsDiscard(v('5♦', ['5♥', '5♠', 'K♣'])), true);          // completa un trío
  assert.equal(wantsDiscard(v('6♥', ['5♥', '7♥', 'K♣'])), true);          // completa 5-6-7♥
  assert.equal(wantsDiscard(v('5♦', ['5♥', 'K♣'])), false);               // solo pareja: push
  assert.equal(wantsDiscard(v('2♦', ['K♣'])), true);
  assert.equal(wantsDiscard(v('8♣', ['K♦'], true, [{ id: 1, owner: 'B', meld: buildRun(cs('5♣', '6♣', '7♣')) }])), true); // engancha
});

test('roba un 2 de un jugador plantado con la carta exacta', () => {
  const view = {
    you: 'A', hand: cs('5♦', 'K♣'),
    players: [{ id: 'A', planted: false }, { id: 'B', planted: true }],
    melds: [{ id: 1, owner: 'B', meld: { kind: 'set', rank: '5', cards: cs('5♥', '5♠', '2♣') } }],
  };
  const s = findSteal(view);
  assert.deepEqual({ meldId: s.meldId, index: s.index }, { meldId: 1, index: 2 });
  assert.equal(view.hand.find((x) => x.id === s.cardId).rank, '5');
  view.players[1].planted = false;
  assert.equal(findSteal(view), null);                                       // de no plantados no se roba
});

test('planTurn: se planta y descarta, pero NO engancha en el turno en que se planta', () => {
  const hand = cs('5♥', '5♠', '5♦', '7♥', '7♠', '7♦', '9♥', '9♠', '9♦', '8♣', 'K♦');
  const view = {
    you: 'A', round: 1, requirement: ROUND_REQUIREMENTS[0], hand, stoleThisTurn: false,
    players: [{ id: 'A', planted: false }, { id: 'B', planted: true }],
    melds: [{ id: 3, owner: 'B', meld: buildRun(cs('5♣', '6♣', '7♣')) }],
  };
  const t = planTurn(view);
  assert.equal(t.plant.length, 3);
  assert.deepEqual(t.hooks, []);
  assert.equal(t.discard, hand[10].id);                                      // la K♦ (más puntos)
  assert.equal(botMove({ ...view, turnPhase: 'main' }).type, 'playTurn');
});

test('planTurn: ya plantado de antes, sí engancha en la mesa', () => {
  const hand = cs('8♣', 'K♦');
  const view = {
    you: 'A', round: 1, requirement: ROUND_REQUIREMENTS[0], hand, stoleThisTurn: false,
    players: [{ id: 'A', planted: true }, { id: 'B', planted: true }],
    melds: [{ id: 3, owner: 'B', meld: buildRun(cs('5♣', '6♣', '7♣')) }],
  };
  const t = planTurn(view);
  assert.deepEqual(t.hooks.map((h) => h.cardId), [hand[0].id]);             // el 8♣ va al 5-6-7♣
  assert.equal(t.discard, hand[1].id);
});

test('botMove: con el mazo agotado toma el descarte (no hay push)', () => {
  const view = {
    you: 'A', round: 1, requirement: ROUND_REQUIREMENTS[0], turnPhase: 'start', deckCount: 1,
    hand: cs('3♣', '8♦', 'K♠'), discardTop: c('5♥'), stoleThisTurn: false,
    players: [{ id: 'A', planted: false }, { id: 'B', planted: false }], melds: [],
  };
  assert.equal(botMove(view).type, 'takeDiscard');
  assert.equal(botMove({ ...view, deckCount: 40 }).type, 'push');
});

// Partidas completas solo con bots: deben terminar las 5 rondas sin una sola jugada rechazada.
for (const seed of [1, 2, 3, 4, 5, 6]) {
  test(`partida completa entre 3 bots (semilla ${seed})`, () => {
    const m = new Match({ rng: seededRng(seed) });
    ['A', 'B', 'C'].forEach((p) => m.addPlayer(p, p));
    m.handle('A', 'start');
    let moves = 0;
    while (m.phase !== 'finished') {
      if (m.phase === 'roundOver') { m.handle('A', 'nextRound'); continue; }
      const pid = m.game.currentPlayer;
      const mv = botMove(m.viewFor(pid));
      const res = m.handle(pid, mv.type, mv.msg);
      assert.equal(res.ok, true, `jugada rechazada (${mv.type}): ${res.error}`);
      assert.ok(++moves < 5000, 'la partida no termina');
    }
    assert.equal(Object.keys(m.totals).length, 3);
  });
}
