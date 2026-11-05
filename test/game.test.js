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
test('robo de 2: varios en el mismo turno y otra vez en un turno posterior (sin plantarte), pero nunca después de tomar carta', () => {
  const r = plantedScenario();
  const tb = cs('7♥', '7♠', '2♣');
  r.melds.push({ id: 2, owner: 'B', meld: { kind: 'set', rank: '7', cards: tb } });
  r.melds.push({ id: 3, owner: 'B', meld: { kind: 'set', rank: '5', cards: [...cs('5♥', '5♠'), c('2♥')] } });
  const [five, seven, five2] = [c('5♦'), c('7♦'), c('5♣')];
  r.hands.A = [five, seven, five2, ...cs('K♣', '3♣')];
  assert.equal(r.steal2('A', 1, 2, five.id).ok, true);          // turno 1: dos robos seguidos
  assert.equal(r.steal2('A', 2, 2, seven.id).ok, true);
  r.takeDiscard('A');
  assert.equal(r.steal2('A', 3, 2, five2.id).ok, false);        // ya tomó carta: no
  r.discard('A', r.hands.A.find((x) => x.rank === 'K').id);
  for (const p of ['B', 'C', 'D']) { r.takeDiscard(p); r.discard(p, r.hands[p][0].id); }
  assert.equal(r.currentPlayer, 'A');
  assert.equal(r.stoleThisTurn, false);
  assert.equal(r.steal2('A', 3, 2, five2.id).ok, true);         // turno siguiente: puede robar otra vez
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
  const res = r.hook('A', 1, five.id);
  assert.equal(res.ok, true);                       // trío → cuarteto…
  assert.equal(res.cleared.length, 0);              // …y se queda en la mesa (los grupos iguales no se completan)
  assert.equal(r.melds.find((m) => m.id === 1).meld.cards.length, 4);
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
// Toma el descarte y lo vuelve a descartar (un turno que no cambia nada).
const passTurn = (r) => { const p = r.currentPlayer; const t = r.takeDiscard(p).taken; return r.discard(p, t.id); };

test('mazo agotado: se juega UNA vuelta más (sin push) y luego se cuentan las manos', () => {
  const r = mk();                                               // 4 jugadores, empieza A
  r.deck = r.deck.slice(0, 1);
  assert.match(r.push('A').error, /mazo se acabó/);
  assert.equal(r.finalTurnsLeft, null);
  assert.equal(passTurn(r).roundOver, false);                   // el descarte de A abre la última vuelta
  assert.equal(r.finalTurnsLeft, 4);
  for (const p of ['B', 'C', 'D']) {
    assert.equal(r.currentPlayer, p);
    assert.match(r.push(p).error, /mazo se acabó/);
    assert.equal(passTurn(r).roundOver, false);
  }
  assert.equal(r.currentPlayer, 'A');                           // A también juega su último turno
  r.hands.B = cs('K♣', '3♦');                                   // 10 + 5
  const res = passTurn(r);
  assert.equal(res.roundOver, true);
  assert.equal(res.exhausted, true);
  assert.equal(r.winner, null);
  assert.equal(r.scores().B, 15);
  assert.ok(r.scores().A > 0);                                  // nadie queda en 0
});

test('mazo agotado: en la última vuelta todavía se puede ganar la ronda', () => {
  const r = mk();
  r.deck = r.deck.slice(0, 1);
  passTurn(r);                                                  // A abre la última vuelta
  r.hands.B = [];                                               // B toma el descarte y se queda sin cartas al tirarlo
  r.takeDiscard('B');
  const win = r.discard('B', r.hands.B[0].id);
  assert.equal(win.roundOver, true);
  assert.equal(r.winner, 'B');
  assert.equal(win.exhausted, undefined);
});

test('mesa: los grupos del mismo número nunca salen de la mesa (crecen a 5 y más)', () => {
  const r = mk();
  r.planted.A = true; r.phase = 'main';
  r.melds = [{ id: 1, owner: 'B', meld: { kind: 'set', rank: '8', cards: cs('8♥', '8♠', '8♦') } }];
  const e1 = c('8♣'), e2 = c('8♥'), extra = c('K♦');
  r.hands.A = [e1, e2, extra, c('3♥')];
  const res = r.playTurn('A', { hooks: [{ meldId: 1, cardId: e1.id }, { meldId: 1, cardId: e2.id }], discard: extra.id });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.cleared, []);
  assert.equal(r.melds[0].meld.cards.length, 5);
  assert.equal(r.hands.A.length, 1);
});

test('mesa: un consecutivo del 3 al As sale de la mesa; uno incompleto se queda', () => {
  const r = mk();
  r.planted.A = true; r.phase = 'main';
  const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const slots = ranks.map((rk, i) => ({ card: c(`${rk}♥`), value: i + 3 }));
  r.melds = [
    { id: 1, owner: 'B', meld: { kind: 'run', suit: '♥', slots } },
    { id: 2, owner: 'C', meld: { kind: 'run', suit: '♠', slots: [5, 6, 7].map((v) => ({ card: c(`${v}♠`), value: v })) } },
  ];
  const ace = c('A♥'), eight = c('8♠'), extra = c('Q♣');
  r.hands.A = [ace, eight, extra, c('3♦')];
  const res = r.playTurn('A', { hooks: [{ meldId: 1, cardId: ace.id }, { meldId: 2, cardId: eight.id }], discard: extra.id });
  assert.equal(res.ok, true);
  assert.deepEqual(res.cleared.map((x) => [x.kind, x.cards.length]), [['run', 12]]);
  assert.deepEqual(r.melds.map((m) => m.id), [2]);                    // el 5-8♠ sigue
  assert.equal(r.melds[0].meld.slots.length, 4);
});

test('plantarse con un cuarteto (ronda 5): queda en la mesa', () => {
  const r = mk(4);
  r.phase = 'main';
  const quad = cs('9♥', '9♠', '9♦', '9♣'), run = cs('3♣', '4♣', '5♣', '6♣', '7♣', '8♣', '10♣', 'J♣');
  run.splice(6, 0, c('2♦'));                                            // el 2 hace de 9♣
  run.pop();                                                             // 3…10♣ con comodín: 8 cartas
  const extra = c('K♦');
  r.hands.A = [...quad, ...run, extra, c('Q♠')];
  const res = r.playTurn('A', {
    plant: [{ cardIds: ids(quad) }, { cardIds: ids(run), ordered: true }], discard: extra.id,
  });
  assert.equal(res.ok, true, res.error);
  assert.equal(r.planted.A, true);
  assert.deepEqual(r.melds.map((m) => m.meld.kind), ['set', 'run']);
});

test('plantarse con grupos más grandes y con grupos de más (ronda 1: dos tríos, un cuarteto y un consecutivo)', () => {
  const r = mk(0);
  r.phase = 'main';
  const t1 = cs('5♥', '5♥', '5♦'), t2 = cs('7♣', '7♣', '2♦'), quad = cs('K♥', 'K♠', 'K♦', 'K♣'), run = cs('Q♠', 'K♠', 'A♠');
  const extra = c('9♦');
  r.hands.A = [...t1, ...t2, ...quad, ...run, extra];
  const res = r.playTurn('A', {
    plant: [{ cardIds: ids(t1) }, { cardIds: ids(t2) }, { cardIds: ids(quad) }],
    melds: [{ cardIds: ids(run), ordered: true }], discard: extra.id,
  });
  assert.equal(res.ok, true, res.error);
  assert.equal(r.melds.length, 4);
  assert.equal(r.hands.A.length, 0);
});
