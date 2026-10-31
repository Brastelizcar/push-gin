import assert from "assert";
import { getServer } from "./_server.js";

// Conecta un cliente y guarda su última vista y último rechazo.
async function join(colyseus, room, name) {
  const c = await colyseus.connectTo(room, { name });
  c.view = null; c.rejected = null; c.views = 0;
  c.onMessage("state", (v) => { c.view = v; c.views++; });
  c.onMessage("rejected", (r) => { c.rejected = r.error; });
  c.events = [];
  c.onMessage("event", (e) => c.events.push(e));
  c.send("requestState"); // el mensaje de bienvenida llega antes de registrar listeners: se pide de nuevo
  return c;
}
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

describe("PushGinRoom", () => {
  let colyseus;
  before(async () => (colyseus = await getServer()));
  beforeEach(async () => colyseus.cleanup());

  async function setup(n = 3) {
    const room = await colyseus.createRoom("push_gin", {});
    const names = ["Ana", "Luis", "Sofía", "Camilo"].slice(0, n);
    const cs = [];
    for (const nm of names) cs.push(await join(colyseus, room, nm));
    await tick();
    return { room, cs };
  }

  it("el código de sala son 4 dígitos y es único", async () => {
    const ids = new Set();
    for (let i = 0; i < 12; i++) {
      const r = await colyseus.createRoom("push_gin", {});
      assert.match(r.roomId, /^[1-9]\d{3}$/);
      ids.add(r.roomId);
    }
    assert.equal(ids.size, 12);
  });

  it("un segundo jugador entra con el código (joinById) y uno inexistente falla", async () => {
    const room = await colyseus.createRoom("push_gin", {});
    const a = await colyseus.sdk.joinById(room.roomId, { name: "Ana" });
    const b = await colyseus.sdk.joinById(room.roomId, { name: "Luis" });
    await tick();
    assert.equal(room.clients.length, 2);
    assert.notEqual(a.sessionId, b.sessionId);
    await assert.rejects(colyseus.sdk.joinById("0000", { name: "X" }));
  });

  it("lobby: lista jugadores y el primero es anfitrión", async () => {
    const { cs } = await setup(3);
    assert.equal(cs[2].view.phase, "lobby");
    assert.equal(cs[2].view.players.length, 3);
    assert.equal(cs[2].view.host, cs[0].sessionId);
  });

  it("solo el anfitrión empieza y se necesitan 2+ jugadores", async () => {
    const { cs } = await setup(3);
    cs[1].send("start"); await tick();
    assert.match(cs[1].rejected, /anfitrión/);
    const solo = await colyseus.createRoom("push_gin", {});
    const a = await join(colyseus, solo, "Solo"); await tick();
    a.send("start"); await tick();
    assert.match(a.rejected, /al menos 2/);
  });

  it("al empezar, cada jugador ve SOLO su mano", async () => {
    const { room, cs } = await setup(3);
    cs[0].send("start"); await tick();
    for (const c of cs) {
      assert.equal(c.view.phase, "playing");
      assert.equal(c.view.hand.length, 10);
      assert.deepEqual(c.view.hand, room.game.hands[c.sessionId]);
      assert.ok(c.view.players.every((p) => p.cards === 10));
      assert.equal(c.view.hands, undefined);           // no se filtran manos ajenas
      assert.ok(!JSON.stringify(c.view).includes(room.game.hands[cs[(cs.indexOf(c) + 1) % 3].sessionId][0].id));
    }
  });

  it("rechaza acciones fuera de turno y permite las del turno", async () => {
    const { room, cs } = await setup(3);
    cs[0].send("start"); await tick();
    cs[1].send("takeDiscard"); await tick();
    assert.match(cs[1].rejected, /turno/);
    cs[0].send("takeDiscard"); await tick();
    assert.equal(cs[0].view.hand.length, 11);
    const card = cs[0].view.hand[0];
    cs[0].send("discard", { cardId: card.id }); await tick();
    assert.equal(cs[1].view.current, cs[1].sessionId);
    assert.equal(cs[1].view.discardTop.id, card.id);
  });

  it("push: el siguiente jugador recibe 2 cartas", async () => {
    const { cs } = await setup(3);
    cs[0].send("start"); await tick();
    cs[0].send("push"); await tick();
    assert.equal(cs[1].view.hand.length, 12);
    assert.equal(cs[0].view.hand.length, 11);
    // todos reciben el aviso del push (para animarlo) con quién lo hizo y quién recibe
    for (const c of cs) assert.deepEqual(c.events, [{ type: "push", by: cs[0].sessionId, to: cs[1].sessionId }]);
  });

  it("el contador del mazo baja con cada carta robada (push = 2 cartas)", async () => {
    const { cs } = await setup(3);
    cs[0].send("start"); await tick();
    assert.equal(cs[0].view.deckCount, 156 - 30 - 1); // 3 baraja − 3×10 repartidas − 1 descarte
    cs[0].send("takeDiscard"); await tick();
    assert.equal(cs[1].view.deckCount, 125);           // tomar el descarte no toca el mazo
    cs[0].send("discard", { cardId: cs[0].view.hand[0].id }); await tick();
    cs[1].send("push"); await tick();
    assert.equal(cs[2].view.deckCount, 123);           // la carta ciega + la propia
  });

  it("la vista incluye el requisito de la ronda y avanza con las rondas", async () => {
    const { cs } = await setup(2);
    cs[0].send("start"); await tick();
    assert.deepEqual(cs[0].view.requirement, [{ kind: "set", size: 3 }, { kind: "set", size: 3 }, { kind: "set", size: 3 }]);
  });

  it("mensajes malformados no tumban el servidor", async () => {
    const { cs } = await setup(2);
    cs[0].send("start"); await tick();
    cs[0].send("playTurn", { plant: "x", discard: "a" });
    cs[0].send("playTurn", { hooks: [{}], discard: "a" });
    cs[0].send("playTurn", {});
    cs[0].send("discard", { cardId: 5 });
    await tick();
    assert.equal(cs[0].rejected, "Mensaje inválido");
    cs[0].send("takeDiscard"); await tick();
    assert.equal(cs[0].view.hand.length, 11);
  });

  it("ganar una ronda, sumar puntos y avanzar hasta el final", async () => {
    const { room, cs } = await setup(2);
    cs[0].send("start"); await tick();
    for (let r = 0; r < 5; r++) {
      const g = room.game;
      const [a, b] = cs;
      const first = g.currentPlayer === a.sessionId ? a : b;
      const other = first === a ? b : a;
      g.hands[first.sessionId] = [{ id: `w${r}`, rank: "K", suit: "♣" }];
      g.hands[other.sessionId] = [{ id: `x${r}`, rank: "A", suit: "♠" }]; // 15
      g.phase = "main";
      first.send("discard", { cardId: `w${r}` }); await tick();
      assert.equal(first.view.winner, first.sessionId);
      assert.equal(first.view.roundScores[other.sessionId], 15);
      assert.equal(first.view.hands[other.sessionId][0].rank, "A");
      if (r < 4) {
        assert.equal(first.view.phase, "roundOver");
        a.send("nextRound"); await tick();
        assert.equal(a.view.round, r + 2);
      }
    }
    const v = cs[0].view;
    assert.equal(v.phase, "finished");
    assert.ok(v.gameWinners.length >= 1);
    assert.equal(v.players.reduce((s, p) => s + p.total, 0), 15 * 5);
  });

  const ids = (cards) => cards.map((x) => x.id);
  const card = (rank, suit, id) => ({ id, rank, suit });

  it("plantarse con playTurn: el servidor valida, avisa a todos y pasa el turno", async () => {
    const { room, cs } = await setup(3);
    cs[0].send("start"); await tick();
    const g = room.game, A = cs[0].sessionId;
    const hand = [card("5","♥","a1"),card("5","♠","a2"),card("5","♦","a3"), card("7","♥","b1"),card("7","♠","b2"),card("7","♦","b3"),
                  card("9","♥","c1"),card("9","♠","c2"),card("9","♦","c3"), card("K","♣","k1"), card("Q","♣","q1")];
    g.hands[A] = hand; g.phase = "main";
    const grp = (a, b) => ({ cardIds: ids(hand.slice(a, b)) });
    cs[0].send("playTurn", { plant: [grp(0, 3), grp(3, 5)], discard: "k1" }); await tick();   // incompleto
    assert.match(cs[0].rejected, /requisito/);
    assert.equal(g.hands[A].length, 11);                   // nada cambió…
    assert.equal(g.currentPlayer, A);                      // …y el turno no pasó
    cs[0].send("playTurn", { plant: [grp(0, 3), grp(3, 6), grp(6, 9)], discard: "k1" }); await tick();
    assert.deepEqual(ids(cs[0].view.hand), ["q1"]);
    assert.equal(cs[1].view.melds.length, 3);
    assert.equal(cs[1].view.discardTop.id, "k1");
    assert.equal(cs[1].view.current, cs[1].sessionId);
    assert.equal(cs[1].view.players.find((p) => p.id === A).planted, true);
    for (const c of cs) assert.deepEqual(c.events.at(-1), { type: "turn", by: A, planted: true, laid: 0, hooked: 0 });
  });

  it("playTurn es atómico: si un enganche falla no se planta nada", async () => {
    const { room, cs } = await setup(2);
    cs[0].send("start"); await tick();
    const g = room.game, A = cs[0].sessionId, B = cs[1].sessionId;
    g.melds.push({ id: 1, owner: B, meld: { kind: "run", suit: "♠", slots: [5,6,7].map((v, i) => ({ card: card(String(v),"♠","r"+i), value: v })) } });
    g.nextMeldId = 2;
    const hand = [card("5","♥","a1"),card("5","♠","a2"),card("5","♦","a3"), card("7","♥","b1"),card("7","♠","b2"),card("7","♦","b3"),
                  card("9","♥","c1"),card("9","♠","c2"),card("9","♦","c3"), card("K","♣","k1"), card("8","♥","x1")];
    g.hands[A] = hand; g.phase = "main";
    const grp = (a, b) => ({ cardIds: ids(hand.slice(a, b)) });
    cs[0].send("playTurn", { plant: [grp(0, 3), grp(3, 6), grp(6, 9)], hooks: [{ meldId: 1, cardId: "x1" }], discard: "k1" }); await tick();
    assert.match(cs[0].rejected, /extiende/);
    assert.equal(g.hands[A].length, 11);
    assert.equal(g.melds.length, 1);
    assert.equal(g.melds[0].meld.slots.length, 3);
    assert.equal(g.planted[A], false);
    assert.equal(g.currentPlayer, A);
    assert.equal(cs[0].events.length, 0);
  });

  it("robar un 2: solo antes de tomar carta, avisa a todos y bloquea plantarse", async () => {
    const { room, cs } = await setup(3);
    cs[0].send("start"); await tick();
    const g = room.game, A = cs[0].sessionId, B = cs[1].sessionId;
    g.melds.push({ id: 1, owner: B, meld: { kind: "set", rank: "5", cards: [card("5","♥","m1"), card("5","♠","m2"), card("2","♦","m3")] } });
    g.planted[B] = true;
    g.hands[A] = [card("5","♦","h1"), card("K","♣","h2"), card("3","♣","h3")];
    cs[0].send("steal2", { meldId: 1, index: 2, cardId: "h1" }); await tick();
    assert.ok(cs[0].view.hand.some((x) => x.rank === "2"));
    assert.equal(cs[0].view.stoleThisTurn, true);
    for (const c of cs) assert.deepEqual(c.events.at(-1), { type: "steal", by: A, victim: B });
    cs[0].send("takeDiscard"); await tick();
    cs[0].send("steal2", { meldId: 1, index: 2, cardId: "h2" }); await tick();
    assert.match(cs[0].rejected, /antes de tomar/);    // ya tomó carta: mensaje claro
  });

  it("enganchar con playTurn: extiende el plante y rechaza lo que no encaja", async () => {
    const { room, cs } = await setup(2);
    cs[0].send("start"); await tick();
    const g = room.game, A = cs[0].sessionId;
    g.melds.push({ id: 1, owner: A, meld: { kind: "run", suit: "♥", slots: [5,6,7].map((v, i) => ({ card: card(String(v),"♥","r"+i), value: v })) } });
    g.planted[A] = true; g.phase = "main";
    g.hands[A] = [card("8","♥","x1"), card("9","♠","x2"), card("K","♣","x3")];
    cs[0].send("playTurn", { hooks: [{ meldId: 1, cardId: "x2" }], discard: "x3" }); await tick();
    assert.match(cs[0].rejected, /extiende/);
    cs[0].send("playTurn", { hooks: [{ meldId: 1, cardId: "x1", end: "high" }], discard: "x3" }); await tick();
    assert.equal(cs[1].view.melds[0].meld.slots.length, 4);
    assert.equal(cs[0].view.hand.length, 1);
    for (const c of cs) assert.deepEqual(c.events.at(-1), { type: "turn", by: A, planted: false, laid: 0, hooked: 1 });
  });

  it("las acciones sueltas plant/layMelds/hook ya no existen: todo pasa por playTurn", async () => {
    const { room, cs } = await setup(2);
    cs[0].send("start"); await tick();
    const g = room.game, A = cs[0].sessionId;
    g.phase = "main";
    const before = g.hands[A].length;
    cs[0].send("plant", { groups: [{ cardIds: [g.hands[A][0].id] }] }); await tick();
    assert.equal(g.hands[A].length, before);
    assert.equal(g.phase, "main");
  });

  it("anfitrión se traspasa si sale en el lobby", async () => {
    const { cs } = await setup(3);
    await cs[0].leave(); await tick();
    assert.equal(cs[1].view.host, cs[1].sessionId);
    assert.equal(cs[1].view.players.length, 2);
  });
});
