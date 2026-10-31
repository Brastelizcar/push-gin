import test from "node:test";
import assert from "node:assert/strict";
import { meldShape, handSegments, validGroupsById, previewMelds, addToGroup, buildTurn, emptyStage, stagedIds } from "../src/staging.js";

let n = 0;
const c = (s) => ({ id: `s${n++}`, rank: s.slice(0, -1), suit: s.slice(-1) });
const cs = (...l) => l.map(c);
const items = (...parts) => parts.flatMap((p, i) => [...(i ? [{ gap: `gap:${i}` }] : []), ...p.map((card) => ({ card }))]);
const runMeld = (suit, ...v) => ({ kind: "run", suit, slots: v.map((x) => ({ card: c(`${x}${suit}`), value: x })) });

test("meldShape: trío, consecutivo en orden (el 2 por posición) y nada", () => {
  assert.deepEqual(meldShape(cs("7♠", "7♥", "7♦")), { ordered: false });
  assert.deepEqual(meldShape(cs("5♥", "6♥", "2♣")), { ordered: true });   // el 2 es un 7
  assert.deepEqual(meldShape(cs("6♥", "5♥", "7♥")), { ordered: false });  // desordenado: se acomoda solo
  assert.equal(meldShape(cs("5♥", "6♥")), null);
  assert.equal(meldShape(cs("5♥", "6♠", "7♥")), null);
});

test("tramos de la mano: los espacios separan grupos y solo los válidos se marcan", () => {
  const a = cs("7♠", "7♥", "7♦"), b = cs("K♣", "3♦"), d = cs("4♣", "5♣", "6♣", "7♣");
  const it = items(a, b, d);
  assert.deepEqual(handSegments(it).map((s) => s.length), [3, 2, 4]);
  const map = validGroupsById(it);
  assert.equal(map.size, 7);
  assert.equal(map.get(a[0].id).first, true);
  assert.equal(map.get(a[2].id).last, true);
  assert.equal(map.get(d[1].id).first, false);
  assert.equal(map.has(b[0].id), false);
  assert.equal(validGroupsById(items([...a, ...b])).size, 0);   // sin espacio, el tramo entero no es plante
});

test("previewMelds aplica los enganches sin tocar la mesa real", () => {
  const melds = [{ id: 1, owner: "B", meld: runMeld("♥", 5, 6, 7) }];
  const [eight, four] = cs("8♥", "4♥");
  const prev = previewMelds(melds, [{ meldId: 1, card: eight, end: "high" }, { meldId: 1, card: four, end: "low" }]);
  assert.deepEqual(prev[0].meld.slots.map((s) => s.value), [4, 5, 6, 7, 8]);
  assert.equal(melds[0].meld.slots.length, 3);
});

test("addToGroup: agrega por el extremo que encaje", () => {
  const g = { cards: cs("5♥", "6♥", "7♥"), ordered: true };
  assert.deepEqual(addToGroup(g, c("8♥")).cards.map((x) => x.rank), ["5", "6", "7", "8"]);
  assert.deepEqual(addToGroup(g, c("4♥")).cards.map((x) => x.rank), ["4", "5", "6", "7"]);
  assert.equal(addToGroup(g, c("9♠")), null);
});

test("stagedIds reúne las cartas de grupos y enganches", () => {
  const st = emptyStage();
  st.groups.push({ cards: cs("7♠", "7♥", "7♦") });
  st.hooks.push({ meldId: 1, card: c("8♥") });
  assert.equal(stagedIds(st).size, 4);
});

// Vista mínima del servidor para buildTurn.
function view(hand, extra = {}) {
  return { you: "A", round: 1, requirement: [{ kind: "set", size: 3 }, { kind: "set", size: 3 }, { kind: "set", size: 3 }], hand, melds: [], stoleThisTurn: false, ...extra };
}

test("buildTurn: plante completo + descarte arma el mensaje playTurn", () => {
  const t = cs("5♥", "5♠", "5♦", "7♥", "7♠", "7♦", "9♥", "9♠", "9♦", "K♣", "Q♣");
  const st = emptyStage();
  for (let i = 0; i < 9; i += 3) st.groups.push({ cards: t.slice(i, i + 3), ordered: false });
  const res = buildTurn(view(t), st, t[9].id, false);
  assert.equal(res.error, undefined);
  assert.equal(res.turn.plant.length, 3);
  assert.deepEqual(res.turn.melds, []);
  assert.equal(res.turn.discard, t[9].id);
});

test("buildTurn: rechaza la jugada incompleta, sin descarte o con enganche sin plantarse", () => {
  const t = cs("5♥", "5♠", "5♦", "7♥", "7♠", "7♦", "8♥", "K♣");
  const st = emptyStage();
  st.groups.push({ cards: t.slice(0, 3) }, { cards: t.slice(3, 6) });
  assert.match(buildTurn(view(t), st, t[7].id, false).error, /faltan grupos: llevas 2 de 3/);
  assert.match(buildTurn(view(t), emptyStage(), null, false).error, /descarte/);
  const hookOnly = { groups: [], hooks: [{ meldId: 1, card: t[6] }] };
  const v = view(t, { melds: [{ id: 1, owner: "B", meld: runMeld("♥", 5, 6, 7) }] });
  assert.match(buildTurn(v, hookOnly, t[7].id, false).error, /plantarte/);
  assert.ok(buildTurn(v, hookOnly, t[7].id, true).turn);          // ya plantado: válido
});

test("buildTurn: plantarse y enganchar en el mismo turno no vale (primero te plantas)", () => {
  const t = cs("5♥", "5♠", "5♦", "7♥", "7♠", "7♦", "9♥", "9♠", "9♦", "8♥", "K♣");
  const st = emptyStage();
  for (let i = 0; i < 9; i += 3) st.groups.push({ cards: t.slice(i, i + 3), ordered: false });
  st.hooks.push({ meldId: 1, card: t[9], end: "high" });
  const v = view(t, { melds: [{ id: 1, owner: "B", meld: runMeld("♥", 5, 6, 7) }] });
  assert.match(buildTurn(v, st, t[10].id, false).error, /turno en que te plantas/);
  st.hooks = [];
  assert.ok(buildTurn(v, st, t[10].id, false).turn);              // sin el enganche, el plante sí vale
});

test("buildTurn: solo descartar es una jugada válida", () => {
  const t = cs("K♣", "3♦");
  assert.deepEqual(buildTurn(view(t), emptyStage(), t[0].id, false).turn, { plant: [], melds: [], hooks: [], discard: t[0].id });
});
