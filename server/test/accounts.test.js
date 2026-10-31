import assert from "assert";
import { getServer } from "./_server.js";
import { MemoryStore, setStore } from "../src/accounts/store.js";

const PORT = 2568; // boot() siempre usa 2568 cuando la configuración ya es un Server (defineServer)
const API = `http://127.0.0.1:${PORT}/api`;
const tick = (ms = 100) => new Promise((r) => setTimeout(r, ms));
const api = (path, { token, body, method } = {}) =>
  fetch(API + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

  it("API: crear cuenta devuelve un token; con él se lee la cuenta y se cambia el nombre", async () => {
    const r = await api("/account", { body: { name: "Ana" } });
    assert.equal(r.status, 200);
    assert.equal(r.account.name, "Ana");
    assert.equal(r.account.level, 1);
    assert.equal(r.account.chips, 0);
    assert.match(r.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(r.account.code, undefined);
    const me = await api("/account", { token: r.token });
    assert.equal(me.account.name, "Ana");
    const renamed = await api("/account/name", { token: r.token, body: { name: "Anita" } });
    assert.equal(renamed.account.name, "Anita");
  });

  it("API: token inválido o inexistente → 401; nombre vacío → 400", async () => {
    assert.equal((await api("/account", { token: "corto" })).status, 401);
    assert.equal((await api("/account", { token: "A".repeat(43) })).status, 401);
    assert.equal((await api("/account")).status, 401);
    assert.equal((await api("/account", { body: { name: "   " } })).status, 400);
  });

  it("API: XP y fichas los decide el servidor (lo que mande el cliente se ignora)", async () => {
    const r = await api("/account", { body: { name: "Ana", xp: 99999, chips: 99999, level: 50 } });
    assert.deepEqual([r.account.xp, r.account.chips, r.account.level], [0, 0, 1]);
    const n = await api("/account/name", { token: r.token, body: { name: "Ana", xp: 500, chips: 500 } });
    assert.deepEqual([n.account.xp, n.account.chips], [0, 0]);
    const c = await api("/chips/claim", { token: r.token, body: { chips: 100000, now: 0 } });
    assert.equal(c.account.chips, 300);                                  // siempre 300, nunca lo que se pida
  });

  it("API: fichas gratis una vez cada 24 h (lo decide el servidor)", async () => {
    const { token } = await api("/account", { body: { name: "Ana" } });
    const r1 = await api("/chips/claim", { token, body: {} });
    assert.equal(r1.ok, true);
    assert.equal(r1.account.chips, 300);
    assert.equal(r1.account.claim.canClaim, false);
    const r2 = await api("/chips/claim", { token, body: {} });
    assert.equal(r2.ok, false);
    assert.equal(r2.account.chips, 300);
    assert.ok(r2.account.claim.msLeft > 0);
  });

  it("API: sincronizar otro dispositivo con un código corto de un solo uso", async () => {
    const { token: t1 } = await api("/account", { body: { name: "Ana" } });
    assert.equal((await api("/sync/code", { body: {} })).status, 401);   // sin sesión no hay código
    const { code, expiresInMs } = await api("/sync/code", { token: t1, body: {} });
    assert.equal(code.length, 8);
    assert.equal(expiresInMs, 600_000);
    const r = await api("/sync/redeem", { body: { code: `${code.slice(0, 4)}-${code.slice(4)}` } });
    assert.equal(r.status, 200);
    assert.equal(r.account.name, "Ana");
    assert.notEqual(r.token, t1);                                        // token propio para el nuevo dispositivo
    assert.equal((await api("/account", { token: r.token })).account.name, "Ana");
    const again = await api("/sync/redeem", { body: { code } });
    assert.equal(again.status, 400);
    assert.match(again.error, /vencido o ya usado/);
  });

  it("sala: con cuenta entras con tu nombre y nivel; un código falso no entra", async () => {
    const { account: acc, token } = await store.create("Ana");
    await store.reward([{ id: acc.id, xp: 150, chips: 0 }]);
    const room = await colyseus.createRoom("push_gin", {});
    const a = await join(room, { token, name: "otro nombre" });
    await tick();
    assert.equal(a.view.players[0].name, "Ana");
    assert.equal(a.view.players[0].level, 2);
    await assert.rejects(colyseus.connectTo(room, { token: "B".repeat(43) }));
    await assert.rejects(colyseus.connectTo(room, { token }));              // la misma cuenta dos veces, no
  });

  it("sala con cuota: invitados no entran y se cobra a todos al empezar", async () => {
    const [{ account: a1, token: ta }, { account: b1, token: tb }] = [await store.create("Ana"), await store.create("Luis")];
    await store.claim(a1.id);                                          // Ana 300, Luis 0
    const room = await colyseus.createRoom("push_gin", { entryFee: 100 });
    const a = await join(room, { token: ta });
    await assert.rejects(colyseus.connectTo(room, { name: "Invitado" }));
    const b = await join(room, { token: tb });
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
    const [{ account: a1, token: ta }, { account: b1, token: tb }] = [await store.create("Ana"), await store.create("Luis")];
    await store.claim(a1.id); await store.claim(b1.id);
    const room = await colyseus.createRoom("push_gin", { entryFee: 100 });
    const a = await join(room, { token: ta });
    const b = await join(room, { token: tb });
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

  it("abandonar a media partida: pierdes la cuota y el XP; el que se queda gana el pozo", async () => {
    const [{ account: a1, token: ta }, { account: b1, token: tb }] = [await store.create("Ana"), await store.create("Luis")];
    await store.claim(a1.id); await store.claim(b1.id);
    const room = await colyseus.createRoom("push_gin", { entryFee: 100 });
    const a = await join(room, { token: ta });
    const b = await join(room, { token: tb });
    await tick();
    a.send("start"); await tick(150);
    assert.equal((await store.byId(b1.id)).chips, 200);  // a los dos se les cobró
    await b.leave(); await tick(150);                    // Luis abandona en la ronda 1
    await room.rewardsSaved; await tick();
    assert.equal(a.view.phase, "finished");
    assert.deepEqual(a.view.gameWinners, [a.sessionId]);
    assert.deepEqual(a.view.rewards[b.sessionId], { place: null, xp: 0, chips: -100, left: true });
    const [ana, luis] = [await store.byId(a1.id), await store.byId(b1.id)];
    assert.deepEqual([ana.xp, ana.chips], [100, 400]);   // 300 − 100 + 200 del pozo
    assert.deepEqual([luis.xp, luis.chips], [0, 200]);   // perdió la cuota y no ganó XP
  });

  it("API: canjear códigos tiene límite de intentos por IP (no se puede adivinar a la fuerza)", async () => {
    let last;
    for (let i = 0; i < 12; i++) last = await api("/sync/redeem", { body: { code: "AAAA-AAAA" } });
    assert.equal(last.status, 429);
  });
});
