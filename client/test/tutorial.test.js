import test from "node:test";
import assert from "node:assert/strict";
import { startPractice } from "../src/practice.js";
import { tutorialSetup, TUTORIAL_HAND, nextStep, tutorialLocks } from "../src/tutorial.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error("tiempo agotado"); await sleep(5); } };
const name = (c) => c.rank + c.suit;

function tutorial() {
  const log = { views: [], rejected: [] };
  const room = startPractice({ name: "Ana", bots: 2, botDelay: [5, 10], botShow: 5, setup: tutorialSetup, noPush: true }, {
    onState: (v) => log.views.push(v), onEvent() {}, onRejected: (e) => log.rejected.push(e), onLeave() {},
  });
  return { room, log, last: () => log.views.at(-1) };
}

test("tutorial: reparto preparado — empiezas tú, Rosa ya está plantada con un comodín en su trío de 5", async () => {
  const { room, last } = tutorial();
  await until(() => last());
  const v = last();
  assert.deepEqual(v.hand.map(name), TUTORIAL_HAND);
  assert.equal(name(v.discardTop), "9♦");
  assert.equal(v.current, v.you);
  assert.equal(v.deckCount, 156 - 30 - 1);                          // como un reparto normal (se anima igual)
  assert.deepEqual(v.players.map((p) => p.planted), [false, true, false]);
  assert.deepEqual(v.melds.map((m) => m.meld.cards.map(name).join(" ")), ["5♥ 5♣ 2♦", "8♠ 8♥ 8♦", "J♣ J♦ J♠"]);
  const ids = [...v.hand.map((c) => c.id), v.discardTop.id, ...v.melds.flatMap((m) => m.meld.cards.map((c) => c.id))];
  assert.equal(new Set(ids).size, ids.length);                       // cartas de verdad, sin ids repetidos
  room.leave();
});

test("tutorial: el recorrido completo (robar, push, plantarse, enganchar) termina ganando la ronda", async () => {
  const { room, log, last } = tutorial();
  await until(() => last());
  const byName = (s) => last().hand.find((c) => name(c) === s).id;
  const myStart = () => last().current === last().you && last().turnPhase === "start";
  // Turno 1: roba el comodín de Rosa con el 5♠, toma el 9♦ y descarta la K♠ (no se puede plantar).
  const fives = last().melds.find((m) => m.meld.rank === "5");
  room.send("steal2", { meldId: fives.id, index: 2, cardId: byName("5♠") });
  await until(() => last().stoleThisTurn);
  assert.ok(last().hand.some((c) => name(c) === "2♦"));
  room.send("takeDiscard");
  await until(() => last().turnPhase === "main");
  room.send("playTurn", { discard: byName("K♠") });
  await until(() => last().current !== last().you);
  // Turno 2: push y se planta con 7♥ 7♠ 7♦, Q♦ Q♣ 2♦ y 9♣ 9♥ 9♦; descarta la carta robada del mazo.
  await until(myStart);
  assert.equal(last().players.some((p) => p.id === "bot2" && p.planted), false);
  room.send("push");
  await until(() => last().turnPhase === "main");
  const drawn = last().drawn;
  const group = (...s) => ({ cardIds: s.map(byName) });
  room.send("playTurn", { plant: [group("7♥", "7♠", "7♦"), group("Q♦", "Q♣", "2♦"), group("9♣", "9♥", "9♦")], discard: drawn });
  await until(() => last().players[0].planted);
  assert.deepEqual(last().hand.map(name), ["7♣"]);
  // Turno 3: toma el descarte, engancha el 7♣ y descarta la última carta.
  await until(myStart);
  room.send("takeDiscard");
  await until(() => last().turnPhase === "main");
  const seven = byName("7♣"), other = last().hand.find((c) => c.id !== seven).id;
  const trio = last().melds.find((m) => m.owner === last().you && m.meld.rank === "7");
  room.send("playTurn", { hooks: [{ meldId: trio.id, cardId: seven }], discard: other });
  await until(() => last().phase === "roundOver");
  assert.equal(last().winner, last().you);
  assert.deepEqual(log.rejected, []);
  room.leave();
});

test("tutorial: los pasos avanzan con lo que pasa en la mesa", () => {
  const me = "tú";
  const view = (o = {}) => ({ phase: "playing", you: me, current: me, turnPhase: "start", stoleThisTurn: false,
    players: [{ id: me, planted: false }, { id: "bot1", planted: true }], ...o });
  const planted = { players: [{ id: me, planted: true }, { id: "bot1", planted: true }] };
  assert.equal(nextStep("intro", view()), "intro");                                  // con «Siguiente»
  assert.equal(nextStep("wild", view()), "wild");
  assert.equal(nextStep("steal", view()), "steal");
  assert.equal(nextStep("steal", view({ stoleThisTurn: true })), "take");
  assert.equal(nextStep("take", view({ stoleThisTurn: true, turnPhase: "main" })), "endturn");
  assert.equal(nextStep("endturn", view({ current: "bot1" })), "wait");
  assert.equal(nextStep("wait", view({ current: "bot1" })), "wait");
  assert.equal(nextStep("wait", view()), "push");
  assert.equal(nextStep("push", view({ turnPhase: "main" })), "stage");
  assert.equal(nextStep("stage", view({ turnPhase: "main" }), { groups: 3 }), "discard");
  assert.equal(nextStep("discard", view({ turnPhase: "main" }), { groups: 1 }), "stage");   // devolviste un grupo
  assert.equal(nextStep("discard", view({ ...planted, current: "bot1" })), "planted");
  assert.equal(nextStep("planted", view({ ...planted, current: "bot1" })), "planted");
  assert.equal(nextStep("planted", view(planted)), "hook");
  assert.equal(nextStep("hook", view({ phase: "roundOver", winner: me })), "won");
  assert.equal(nextStep("hook", view({ phase: "roundOver", winner: "bot1" })), "over");
  assert.equal(nextStep("tips", view({ phase: "roundOver", winner: me })), "tips");
  // si toma carta sin robar, sigue por el camino de plantarse; si termina el turno sin plantarse, juega libre
  assert.equal(nextStep("steal", view({ turnPhase: "main" })), "stage");
  assert.equal(nextStep("stage", view({ current: "bot1" })), "free");
});

test("tutorial: en el primer turno no deja tomar carta antes de robar, ni hacer push en vez de tomar el 9♦", () => {
  for (const step of ["intro", "goal", "wild", "steal"]) assert.ok(tutorialLocks(step).take && tutorialLocks(step).push, step);
  assert.equal(tutorialLocks("take").take, undefined);                 // tomar el 9♦ sí
  assert.match(tutorialLocks("take").push, /9♦/);                     // push no: sin el 9♦ no hay trío de 9
  for (const step of ["endturn", "wait", "push", "stage", "hook", "free"]) assert.deepEqual(tutorialLocks(step), {}, step);
});
