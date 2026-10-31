import assert from "assert";
import { getServer } from "./_server.js";
import { MemoryStore, setStore } from "../src/accounts/store.js";

const PORT = 2568; // boot() siempre usa 2568 cuando la configuración ya es un Server (defineServer)
const API = `http://127.0.0.1:${PORT}/api`;
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const api = (path, { code, body, method } = {}) =>
  fetch(API + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(code ? { Authorization: `Bearer ${code}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

describe("Cuentas: API y salas", () => {
  let colyseus, store;
  before(async () => (colyseus = await getServer()));
  beforeEach(async () => { await colyseus.cleanup(); store = new MemoryStore(); setStore(store); });

  async function join(room, opts) {
    const c = await colyseus.connectTo(room, opts);
    c.view = null; c.rejected = null; c.account = null;
    c.onMessage("state", (v) => (c.view = v));
    c.onMessage("rejected", (r) => (c.rejected = r.error));
    c.onMessage("event", () => {});
    c.onMessage("account", (a) => (c.account = a));
    c.send("requestState");
    return c;
  }

  it("API: crear cuenta, leerla con el código y cambiar el nombre", async () => {
    const r = await api("/account", { body: { name: "Ana" } });
    assert.equal(r.status, 200);
    assert.equal(r.account.name, "Ana");
    assert.equal(r.account.level, 1);
    assert.equal(r.account.chips, 0);
    assert.match(r.account.code, /^[A-Za-z0-9]{20}$/);
    const me = await api("/account", { code: r.account.code });
    assert.equal(me.account.name, "Ana");
    const renamed = await api("/account/name", { code: r.account.code, body: { name: "Anita" } });
    assert.equal(renamed.account.name, "Anita");
  });

  it("API: código inválido o inexistente → 401; nombre vacío → 400", async () => {
    assert.equal((await api("/account", { code: "corto" })).status, 401);
    assert.equal((await api("/account", { code: "A".repeat(20) })).status, 401);
    assert.equal((await api("/account", { body: { name: "   " } })).status, 400);
  });

  it("API: fichas gratis una vez cada 24 h (lo decide el servidor)", async () => {
    const { account } = await api("/account", { body: { name: "Ana" } });
    const r1 = await api("/chips/claim", { code: account.code, body: {} });
    assert.equal(r1.ok, true);
    assert.equal(r1.account.chips, 300);
    assert.equal(r1.account.claim.canClaim, false);
    const r2 = await api("/chips/claim", { code: account.code, body: {} });
    assert.equal(r2.ok, false);
    assert.equal(r2.account.chips, 300);
    assert.ok(r2.account.claim.msLeft > 0);
  });

  it("sala: con cuenta entras con tu nombre y nivel; un código falso no entra", async () => {
    const acc = await store.create("Ana");
    await store.reward([{ id: acc.id, xp: 150, chips: 0 }]);
    const room = await colyseus.createRoom("push_gin", {});
    const a = await join(room, { code: acc.code, name: "otro nombre" });
    await tick();
    assert.equal(a.view.players[0].name, "Ana");
    assert.equal(a.view.players[0].level, 2);
    await assert.rejects(colyseus.connectTo(room, { code: "B".repeat(20) }));
    await assert.rejects(colyseus.connectTo(room, { code: acc.code }));     // la misma cuenta dos veces, no
  });

  it("sala con cuota: invitados no entran y se cobra a todos al empezar", async () => {
    const [a1, b1] = [await store.create("Ana"), await store.create("Luis")];
    await store.claim(a1.id);                                          // Ana 300, Luis 0
    const room = await colyseus.createRoom("push_gin", { entryFee: 100 });
    const a = await join(room, { code: a1.code });
    await assert.rejects(colyseus.connectTo(room, { name: "Invitado" }));
    const b = await join(room, { code: b1.code });
    await tick();
    assert.equal(a.view.entryFee, 100);
    a.send("start"); await tick();
    assert.match(a.rejected, /fichas suficientes.*Luis/);
    assert.equal(a.view.phase, "lobby");
    assert.equal((await store.byId(a1.id)).chips, 300);                 // a nadie se le cobró
    await store.claim(b1.id);
    a.send("start"); await tick(150);
    assert.equal(a.view.phase, "playing");
    assert.equal((await store.byId(a1.id)).chips, 200);
    assert.equal((await store.byId(b1.id)).chips, 200);
  });

  it("una cuota que no está en la lista se ignora (sala sin cuota)", async () => {
    const room = await colyseus.createRoom("push_gin", { entryFee: 37 });
    assert.equal(room.entryFee, 0);
  });

  it("fin de la partida: XP por puesto y el pozo para el ganador", async () => {
    const [a1, b1] = [await store.create("Ana"), await store.create("Luis")];
    await store.claim(a1.id); await store.claim(b1.id);
    const room = await colyseus.createRoom("push_gin", { entryFee: 100 });
    const a = await join(room, { code: a1.code });
    const b = await join(room, { code: b1.code });
    await tick();
    a.send("start"); await tick(150);
    for (let r = 0; r < 5; r++) {                // Ana gana todas las rondas
      const g = room.game;
      g.turnIndex = g.players.indexOf(a.sessionId);
      g.hands[a.sessionId] = [{ id: `w${r}`, rank: "K", suit: "♣" }];
      g.hands[b.sessionId] = [{ id: `x${r}`, rank: "A", suit: "♠" }];
      g.phase = "main";
      a.send("discard", { cardId: `w${r}` }); await tick();
      if (r < 4) { a.send("nextRound"); await tick(); }
    }
    await room.rewardsSaved; await tick();
    assert.equal(a.view.phase, "finished");
    assert.deepEqual(a.view.rewards[a.sessionId], { place: 0, xp: 100, chips: 100 });
    assert.deepEqual(a.view.rewards[b.sessionId], { place: 1, xp: 50, chips: -100 });
    const [ana, luis] = [await store.byId(a1.id), await store.byId(b1.id)];
    assert.deepEqual([ana.xp, ana.chips], [100, 400]);   // 300 − 100 + 200 del pozo
    assert.deepEqual([luis.xp, luis.chips], [50, 200]);
    assert.equal(a.account.chips, 400);                  // la cuenta actualizada llega al cliente
    assert.equal(a.account.level, 2);
  });
});
