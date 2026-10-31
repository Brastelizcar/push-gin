import test from 'node:test';
import assert from 'node:assert/strict';
import { Round } from '../src/logic/game.js';
import { c, cs, ids } from './helpers.js';

const mk = (roundIndex = 0) => new Round(['A', 'B', 'C', 'D'], roundIndex);

test('reparto: 10 cartas c/u, 1 en descarte, 3 barajas', () => {
  const r = mk();
  for (const p of r.players) assert.equal(r.hands[p].length, 10);
  assert.ok(r.discardTop);
  assert.equal(r.deck.length, 156 - 40 - 1);
});
test('funciona con 2 y 3 jugadores', () => {
  for (const n of [2, 3]) {
    const r = new Round(['A', 'B', 'C'].slice(0, n), 0);
    assert.equal(r.players.length, n);
  }
  assert.throws(() => new Round(['A'], 0));
});
test('turno: solo el jugador en turno actúa', () => {
  const r = mk();
  assert.equal(r.takeDiscard('B').ok, false);
  assert.equal(r.takeDiscard('A').ok, true);
});
test('tomar descarte → descartar pasa el turno', () => {
  const r = mk();
  r.takeDiscard('A');
  assert.equal(r.hands.A.length, 11);
  const res = r.discard('A', r.hands.A[0].id);
  assert.equal(res.ok, true);
  assert.equal(r.currentPlayer, 'B');
  assert.equal(r.hands.A.length, 10);
});
test('push: 2 cartas a la mano del siguiente, roba una propia', () => {
  const r = mk();
  const top = r.discardTop;
  r.push('A');
  assert.equal(r.hands.B.length, 12);
  assert.ok(r.hands.B.some((x) => x.id === top.id));
  assert.equal(r.hands.A.length, 11);
  assert.equal(r.discardTop, null);
  assert.equal(r.takeDiscard('A').ok, false); // ya tomó carta
});
test('plantarse en ronda 1 y conservar carta para descartar', () => {
  const r = mk(0);
  const t = cs('5♥', '5♠', '5♦', '7♥', '7♠', '7♦', '9♥', '9♠', '9♦', 'K♣');
  r.hands.A = t; r.phase = 'main';
  const groups = [t.slice(0, 3), t.slice(3, 6), t.slice(6, 9)].map((g) => ({ cardIds: ids(g) }));
  const res = r.plant('A', groups);
  assert.equal(res.ok, true);
  assert.equal(r.planted.A, true);
  assert.equal(r.hands.A.length, 1);
  assert.equal(r.melds.length, 3);
});
test('no se puede plantar si te quedas sin cartas (hay que descartar)', () => {
  const r = mk(0);
  const t = cs('5♥', '5♠', '5♦', '7♥', '7♠', '7♦', '9♥', '9♠', '9♦');
  r.hands.A = t; r.phase = 'main';
  const groups = [t.slice(0, 3), t.slice(3, 6), t.slice(6, 9)].map((g) => ({ cardIds: ids(g) }));
  assert.equal(r.plant('A', groups).ok, false);
});
test('plantarse con combinación incorrecta falla', () => {
  const r = mk(2); // ronda 3: 2 consecutivos de 6
  const t = cs('5♥', '5♠', '5♦', '7♥', '7♠', '7♦', 'K♣');
  r.hands.A = t; r.phase = 'main';
  assert.equal(r.plant('A', [{ cardIds: ids(t.slice(0, 3)) }, { cardIds: ids(t.slice(3, 6)) }]).ok, false);
});

function plantedScenario() {
  // B ya se plantó con un trío con 2: 5♥ 5♠ 2♦. A todavía no se ha plantado.
  const r = mk(0);
  const tb = cs('5♥', '5♠', '2♦', '9♣');
  r.melds.push({ id: 1, owner: 'B', meld: { kind: 'set', rank: '5', cards: tb.slice(0, 3) } });
  r.planted.B = true;
  return r;
}
test('robo de 2: válido antes de plantarse, bloquea plantarse ese turno', () => {
  const r = plantedScenario();
  const five = c('5♦');
  r.hands.A = [five, ...cs('K♣', '3♣')];
  assert.equal(r.steal2('A', 1, 2, five.id).ok, true);
  assert.ok(r.hands.A.some((x) => x.rank === '2'));
  r.takeDiscard('A');
  assert.equal(r.stoleThisTurn, true);
  const res = r.plant('A', [{ cardIds: [] }, { cardIds: [] }, { cardIds: [] }]);
  assert.equal(res.ok, false);
});
test('robo de 2: no de plantes de jugadores sin plantar ni si ya te plantaste', () => {
  const r = plantedScenario();
  r.planted.B = false;
  const five = c('5♦');
  r.hands.A = [five];
  assert.equal(r.steal2('A', 1, 2, five.id).ok, false);
  r.planted.B = true; r.planted.A = true;
  assert.equal(r.steal2('A', 1, 2, five.id).ok, false);
});
test('enganche requiere estar plantado y extender', () => {
  const r = plantedScenario();
  const five = c('5♣');
  r.hands.A = [five, c('K♣')];
  r.phase = 'main';
  assert.equal(r.hook('A', 1, five.id).ok, false); // no plantado
  r.planted.A = true;
  assert.equal(r.hook('A', 1, five.id).ok, true);  // trío → cuarteto
  assert.equal(r.melds[0].meld.cards.length, 4);
});
test('ganar descartando la última carta; puntaje del resto', () => {
  const r = mk();
  const last = c('K♣');
  r.hands.A = [last]; r.phase = 'main';
  r.hands.B = cs('A♠', '2♠', '10♥', '7♦'); // 15+20+10+5 = 50
  r.hands.C = []; r.hands.D = cs('3♣');
  const res = r.discard('A', last.id);
  assert.equal(res.roundOver, true);
  assert.equal(r.winner, 'A');
  assert.deepEqual(r.scores(), { A: 0, B: 50, C: 0, D: 5 });
});
test('reparto con semilla: misma semilla, mismas manos', async () => {
  const { seededRng } = await import('../src/logic/cards.js');
  const a = new Round(['A', 'B'], 0, { rng: seededRng(42) });
  const b = new Round(['A', 'B'], 0, { rng: seededRng(42) });
  const c2 = new Round(['A', 'B'], 0, { rng: seededRng(43) });
  assert.deepEqual(a.hands, b.hands);
  assert.notDeepEqual(a.hands, c2.hands);
});
