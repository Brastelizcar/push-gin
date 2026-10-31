import test from 'node:test';
import assert from 'node:assert/strict';
import { xpToReach, levelInfo, placements, gameRewards, claimStatus, CLAIM_INTERVAL_MS } from '../src/logic/progress.js';

test('nivel N → N+1 cuesta 100×N XP', () => {
  assert.equal(xpToReach(1), 0);
  assert.equal(xpToReach(2), 100);
  assert.equal(xpToReach(3), 300);   // 100 + 200
  assert.equal(xpToReach(4), 600);   // + 300
  assert.deepEqual(levelInfo(0), { level: 1, into: 0, needed: 100 });
  assert.deepEqual(levelInfo(99), { level: 1, into: 99, needed: 100 });
  assert.deepEqual(levelInfo(100), { level: 2, into: 0, needed: 200 });
  assert.deepEqual(levelInfo(450), { level: 3, into: 150, needed: 300 });
});

test('puestos: menor total gana y los empates comparten puesto', () => {
  assert.deepEqual(placements({ a: 30, b: 10, c: 50, d: 20 }), { a: 2, b: 0, c: 3, d: 1 });
  assert.deepEqual(placements({ a: 10, b: 10, c: 40 }), { a: 0, b: 0, c: 2 });
});

test('XP por puesto: 100, 50, 30, 10', () => {
  const r = gameRewards(['a', 'b', 'c', 'd'], { a: 30, b: 10, c: 50, d: 20 });
  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => r[id].xp), [30, 100, 10, 50]);
  assert.ok(Object.values(r).every((x) => x.chips === 0));   // sin cuota no se mueven fichas
});

test('pozo de cuotas: el ganador se lo lleva; empate se reparte', () => {
  const r = gameRewards(['a', 'b', 'c'], { a: 5, b: 9, c: 7 }, 100);
  assert.deepEqual([r.a.chips, r.b.chips, r.c.chips], [200, -100, -100]);    // cobra 300, pagó 100
  const t = gameRewards(['a', 'b', 'c'], { a: 5, b: 5, c: 7 }, 100);
  assert.deepEqual([t.a.chips, t.b.chips, t.c.chips], [50, 50, -100]);       // 150 cada uno
  const odd = gameRewards(['a', 'b', 'c'], { a: 5, b: 5, c: 5 }, 100);
  assert.equal(odd.a.chips + odd.b.chips + odd.c.chips, 0);                  // nada se pierde
});

test('abandonar: pierdes la cuota (queda en el pozo) y el XP; los puestos se reparten entre los demás', () => {
  // b tenía el menor total, pero abandonó: gana a (el mejor de los que siguieron).
  const r = gameRewards(['a', 'b', 'c'], { a: 20, b: 5, c: 40 }, 100, ['b']);
  assert.deepEqual(r.b, { place: null, xp: 0, chips: -100, left: true });
  assert.deepEqual([r.a.place, r.a.xp, r.a.chips], [0, 100, 200]);           // cobra el pozo de 300
  assert.deepEqual([r.c.place, r.c.xp, r.c.chips], [1, 50, -100]);
  assert.equal(r.a.chips + r.b.chips + r.c.chips, 0);
});

test('fichas gratis cada 24 h, con el reloj del servidor', () => {
  assert.deepEqual(claimStatus(null, 1000), { canClaim: true, msLeft: 0 });
  const t = 1_000_000;
  assert.deepEqual(claimStatus(t, t + 1000), { canClaim: false, msLeft: CLAIM_INTERVAL_MS - 1000 });
  assert.deepEqual(claimStatus(t, t + CLAIM_INTERVAL_MS), { canClaim: true, msLeft: 0 });
});
