import test from "node:test";
import assert from "node:assert/strict";
import { startPractice } from "../src/practice.js";
import { tutorialSetup, TUTORIAL_HAND, nextStep } from "../src/tutorial.js";

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

test("tutorial: reparto preparado — empiezas tú, con tu mano fija y el 9♦ en el descarte", async () => {
  const { room, last } = tutorial();
  await until(() => last());
  const v = last();
  assert.deepEqual(v.hand.map(name), TUTORIAL_HAND);
  assert.equal(name(v.discardTop), "9♦");
  assert.equal(v.current, v.you);
  assert.equal(v.deckCount, 156 - 30 - 1);                          // como un reparto normal (se anima igual)
  const ids = [...v.hand.map((c) => c.id), v.discardTop.id];
  assert.equal(new Set(ids).size, ids.length);                       // cartas de verdad, sin ids repetidos
  room.leave();
});

test("tutorial: el recorrido completo se puede jugar y termina ganando la ronda", async () => {
  const { room, log, last } = tutorial();
  await until(() => last());
  const byName = (s) => last().hand.find((c) => name(c) === s).id;
  room.send("takeDiscard");
  await until(() => last().turnPhase === "main");
  const group = (...s) => ({ cardIds: s.map(byName) });
  room.send("playTurn", {
    plant: [group("7♥", "7♠", "7♦"), { ...group("Q♦", "Q♣", "2♠"), ordered: false }, group("9♣", "9♥", "9♦")],
    discard: byName("K♠"),
  });
  await until(() => last().players[0].planted);
  assert.deepEqual(last().hand.map(name), ["7♣"]);
  // los bots juegan y vuelve tu turno: push, enganchas el 7♣ y descartas la última carta
  await until(() => last().current === last().you && last().turnPhase === "start");
  assert.equal(last().players.some((p) => p.id !== last().you && p.planted), false);   // nadie se plantó antes
  room.send("push");
  await until(() => last().turnPhase === "main" && last().hand.length === 2);
  const seven = byName("7♣"), other = last().hand.find((c) => c.id !== seven).id;
  const trio = last().melds.find((m) => m.meld.kind === "set" && m.meld.rank === "7");
  room.send("playTurn", { hooks: [{ meldId: trio.id, cardId: seven }], discard: other });
  await until(() => last().phase === "roundOver");
  assert.equal(last().winner, last().you);
  assert.deepEqual(log.rejected, []);
  room.leave();
});

test("tutorial: los pasos avanzan con lo que pasa en la mesa", () => {
  const me = "tú";
  const view = (o = {}) => ({ phase: "playing", you: me, current: me, turnPhase: "start",
    players: [{ id: me, planted: false }, { id: "bot1", planted: false }], ...o });
  assert.equal(nextStep("intro", view()), "intro");                                  // con «Siguiente»
  assert.equal(nextStep("take", view()), "take");
  assert.equal(nextStep("take", view({ turnPhase: "main" })), "stage");
  assert.equal(nextStep("stage", view({ turnPhase: "main" }), { groups: 2 }), "stage");
  assert.equal(nextStep("stage", view({ turnPhase: "main" }), { groups: 3 }), "discard");
  assert.equal(nextStep("discard", view({ turnPhase: "main" }), { groups: 1 }), "stage");   // devolviste un grupo
  const planted = { players: [{ id: me, planted: true }, { id: "bot1", planted: false }] };
  assert.equal(nextStep("discard", view({ ...planted, current: "bot1" })), "planted");
  assert.equal(nextStep("planted", view({ ...planted, current: "bot1" })), "planted");
  assert.equal(nextStep("planted", view(planted)), "push");
  assert.equal(nextStep("push", view({ ...planted, turnPhase: "main" })), "hook");
  assert.equal(nextStep("hook", view({ phase: "roundOver", winner: me })), "won");
  assert.equal(nextStep("hook", view({ phase: "roundOver", winner: "bot1" })), "over");
  assert.equal(nextStep("tips", view({ phase: "roundOver", winner: me })), "tips");
  assert.equal(nextStep("stage", view({ current: "bot1" })), "free");                // terminó el turno sin plantarse
});
