import test from "node:test";
import assert from "node:assert/strict";
import { groupSets, groupRuns } from "../src/grouping.js";

let n = 0;
const c = (s) => ({ id: `g${n++}`, rank: s.slice(0, -1), suit: s.slice(-1) });
const cs = (...l) => l.map(c);
const show = (groups) => groups.map((g) => g.map((x) => x.rank + x.suit).join(" "));

test("777: todas las cartas del mismo número juntas, aunque repitan palo", () => {
  assert.deepEqual(show(groupSets(cs("5♠", "5♠", "5♥", "5♦", "9♣"))), ["5♠ 5♠ 5♥ 5♦", "9♣"]);
  assert.deepEqual(show(groupSets(cs("7♠", "7♠", "7♠"))), ["7♠ 7♠ 7♠"]);
});
test("777: el 2 es solo comodín (no se agrupa) y las sueltas van al final", () => {
  assert.deepEqual(show(groupSets(cs("K♠", "K♥", "K♦", "2♣", "4♠"))), ["K♠ K♥ K♦", "2♣ 4♠"]);
  assert.deepEqual(show(groupSets(cs("2♠", "2♥", "2♦", "9♣"))), ["2♠ 2♥ 2♦ 9♣"]);
});
test("789: escalera simple y sueltas", () => {
  assert.deepEqual(show(groupRuns(cs("7♥", "5♥", "6♥", "9♠", "K♦"))), ["5♥ 6♥ 7♥", "9♠ K♦"]);
});
test("789: un 6♥ repetido no rompe ni duplica la escalera", () => {
  const g = show(groupRuns(cs("5♥", "6♥", "6♥", "7♥")));
  assert.deepEqual(g, ["5♥ 6♥ 7♥", "6♥"]);
});
test("789: el orden es 3→K,A; el As va después de la K y el 2 no entra en las escaleras", () => {
  assert.deepEqual(show(groupRuns(cs("Q♠", "K♠", "A♠"))), ["Q♠ K♠ A♠"]);           // Q-K-A
  assert.deepEqual(show(groupRuns(cs("A♠", "2♠", "3♠", "4♠"))), ["3♠ 4♠", "2♠ A♠"]); // no hay A-2-3
  assert.deepEqual(show(groupRuns(cs("3♣", "4♣", "A♣", "2♦"))), ["3♣ 4♣", "2♦ A♣"]);
});
test("no se pierde ni se duplica ninguna carta", () => {
  const hand = cs("5♠", "5♠", "5♥", "6♠", "6♠", "7♠", "2♥", "K♦", "A♦", "A♦", "J♣");
  for (const fn of [groupSets, groupRuns]) {
    const ids = fn(hand).flat().map((x) => x.id).sort();
    assert.deepEqual(ids, hand.map((x) => x.id).sort());
  }
});
