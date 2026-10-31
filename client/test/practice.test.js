import test from "node:test";
import assert from "node:assert/strict";
import { startPractice } from "../src/practice.js";
import { seededRng } from "../../src/logic/cards.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function practice(opts = {}) {
  const log = { views: [], events: [], rejected: [], left: false };
  const room = startPractice({ name: "Ana", bots: 2, rng: seededRng(3), ...opts }, {
    onState: (v) => log.views.push(v),
    onEvent: (e) => log.events.push(e),
    onRejected: (e) => log.rejected.push(e),
    onLeave: () => (log.left = true),
  });
  return { room, log, last: () => log.views.at(-1) };
}

test("práctica: empieza sola con tus rivales y solo ves tu mano", async () => {
  const { room, last } = practice({ bots: 3 });
  await sleep(5);
  const v = last();
  assert.equal(v.phase, "playing");
  assert.deepEqual(v.players.map((p) => p.name), ["Ana", "Rosa", "Tomás", "Lucía"]);
  assert.equal(v.hand.length, 10);
  assert.equal(v.hands, undefined);
  room.leave();
});

test("práctica: tus jugadas pasan por las mismas reglas (rechazos incluidos)", async () => {
  const { room, log, last } = practice();
  await sleep(5);
  room.send("playTurn", { discard: last().hand[0].id });   // aún no tomaste carta
  await sleep(5);
  assert.match(log.rejected.at(-1), /toma el descarte/);
  room.send("takeDiscard"); await sleep(5);
  assert.equal(last().hand.length, 11);
  room.send("playTurn", { discard: last().hand[0].id }); await sleep(5);
  assert.equal(last().current, "bot1");
  room.leave();
});

test("práctica: los bots juegan su turno solos y te devuelven el turno", async () => {
  const { room, log, last } = practice({ bots: 1 });
  await sleep(5);
  room.send("takeDiscard"); await sleep(5);
  room.send("playTurn", { discard: last().hand[0].id }); await sleep(5);
  assert.equal(last().current, "bot1");
  for (let i = 0; i < 40 && last().current !== "tú"; i++) await sleep(100);
  assert.equal(last().current, "tú");
  assert.equal(log.rejected.length, 0);
  room.leave();
  assert.equal(log.left, true);
});

test("práctica: el temporizador juega tu turno si se acaba el tiempo", async () => {
  const { room, log, last } = practice({ bots: 1, turnTime: 30 });
  await sleep(5);
  assert.ok(last().turnMsLeft > 29_000);
  room.match.turnStartedAt -= 30_000;                       // como si ya hubieran pasado 30 s
  room.send("requestState");                                // (cualquier cambio reprograma el reloj)
  room.send("takeDiscard"); await sleep(120);
  assert.deepEqual(log.events.find((e) => e.type === "timeout"), { type: "timeout", by: "tú" });
  room.leave();
});
