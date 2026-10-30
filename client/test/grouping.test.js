import test from "node:test";
import assert from "node:assert/strict";
import { groupSets, groupRuns } from "../src/grouping.js";

let n = 0;
const c = (s) => ({ id: `g${n++}`, rank: s.slice(0, -1), suit: s.slice(-1) });
const cs = (...l) => l.map(c);
const show = (groups) => groups.map((g) => g.map((x) => x.rank + x.suit).join(" "));

test("777: dos 5♠ idénticos NUNCA quedan en el mismo grupo (el bug reportado)", () => {
  const g = groupSets(cs("5♠", "5♠", "5♥", "5♦", "9♣"));
  for (const grp of g) {
    const suits = grp.filter((x) => x.rank === "5").map((x) => x.suit);
    assert.equal(new Set(suits).size, suits.length, "palo repetido en " + show([grp]));
  }
  assert.deepEqual(show(g)[0], "5♠ 5♥ 5♦"); // el trío válido va primero
});
test("777: tres copias de la misma carta quedan separadas", () => {
  const g = groupSets(cs("7♠", "7♠", "7♠"));
  assert.equal(g.length, 1);           // todas sueltas, juntas en el bloque final
  assert.equal(g[0].length, 3);
});
test("777: comodines (2) y sueltas al final", () => {
  const g = show(groupSets(cs("K♠", "K♥", "K♦", "2♣", "4♠")));
  assert.deepEqual(g, ["K♠ K♥ K♦", "4♠ 2♣"]);
});
test("789: escalera simple y sueltas", () => {
  assert.deepEqual(show(groupRuns(cs("7♥", "5♥", "6♥", "9♠", "K♦"))), ["5♥ 6♥ 7♥", "9♠ K♦"]);
});
test("789: un 6♥ repetido no rompe ni duplica la escalera", () => {
  const g = show(groupRuns(cs("5♥", "6♥", "6♥", "7♥")));
  assert.deepEqual(g, ["5♥ 6♥ 7♥", "6♥"]);
});
test("789: As alto (Q-K-A) y As bajo (A-2... el 2 es comodín y va al final)", () => {
  assert.deepEqual(show(groupRuns(cs("Q♠", "K♠", "A♠"))), ["Q♠ K♠ A♠"]);
  assert.deepEqual(show(groupRuns(cs("3♣", "4♣", "A♣", "2♦"))), ["3♣ 4♣", "A♣ 2♦"]);
});
test("no se pierde ni se duplica ninguna carta", () => {
  const hand = cs("5♠", "5♠", "5♥", "6♠", "6♠", "7♠", "2♥", "K♦", "A♦", "A♦", "J♣");
  for (const fn of [groupSets, groupRuns]) {
    const ids = fn(hand).flat().map((x) => x.id).sort();
    assert.deepEqual(ids, hand.map((x) => x.id).sort());
  }
});
