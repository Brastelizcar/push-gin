import "./table.css";
import { h, toast, fsButton, sizeButton } from "./dom.js";
import { actions } from "./net.js";
import { groupRuns, groupSets } from "./grouping.js";
import { extendMeld, stealTwo } from "../../src/logic/melds.js";
import { findPlantGroups, findFreeMelds, planHooks } from "../../src/logic/plan.js";
import { meldShape, validGroupsById, previewMelds, addToGroup, buildTurn, emptyStage, stagedIds } from "./staging.js";

// ---------- estado SOLO de interfaz (cosmético/local, no se sincroniza: spec sección 0) ----------
// ui.order es el diseño de TU mano: ids de cartas y "espacios" ("gap:1", "gap:2"…) en el orden que elegiste.
// Los espacios son elementos propios: mover una carta nunca los cierra ni los junta.
const ui = {
  order: [],
  gapSeq: 1,
  pending: null,        // carta arrastrada al descarte, a la espera de ✓
  arriving: new Set(),  // cartas que están "volando" hacia tu mano (ocultas hasta que lleguen)
  fly: null,            // capa de la animación en curso
  round: null,
  selected: new Set(),  // cartas que tocaste para plantarte / bajar / enganchar
  stage: emptyStage(),  // jugada sin confirmar: { groups:[{cards, ordered}], hooks:[{meldId, card, end}] }
  flights: new Map(),   // id de carta → { from: rect, at: ms } para animar mano → mesa cuando llegue el estado
  flying: new Set(),    // cartas de la mesa que están llegando volando (ocultas hasta que aterricen)
  gameAct: false,       // acabas de enviar plantarse / bajar / enganchar / robar y esperas respuesta
  prevIds: new Set(),   // cartas que había en tu mano en el render anterior (para detectar las recién llegadas)
  pushWait: null,       // un push acaba de ocurrir: { by, to, anim } (las cartas nuevas esperan a la animación)
  dealRound: null,      // ronda para la que ya se animó el reparto
  dealPending: null,    // cartas que están por repartirse a tu mano
  remotePlay: null,     // otro jugador acaba de plantarse / bajar / enganchar: { by, at }
  prevMesa: new Set(),  // cartas que había en la mesa en el render anterior
};
const MAX_GAPS = 10;
let cur = null; // contexto del último render { view, room, rerender, canTake, mustDiscard }
let hooks = { onExit: () => location.reload(), play: () => {} };
// main.js conecta aquí la salida al menú y los sonidos.
export function setTableHooks(next) { hooks = { ...hooks, ...next }; }

export function resetPending() {
  ui.pending = null;
  ui.arriving.clear();
  ui.fly?.remove();
  ui.fly = null;
  ui.flights.clear();
  ui.flying.clear();
}

// Si el servidor rechaza una jugada de mesa (plantarse, bajar, enganchar, robar) no se toca tu descarte pendiente.
export function handleRejected() {
  if (ui.gameAct) { ui.gameAct = false; ui.flights.clear(); ui.flying.clear(); }
  else resetPending();
}

const isRed = (c) => c.suit === "♥" || c.suit === "♦";
const points = (c) => (c.rank === "A" ? 15 : c.rank === "2" ? 20 : ["10", "J", "Q", "K"].includes(c.rank) ? 10 : 5);
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const isGapId = (id) => typeof id === "string" && id.startsWith("gap:");
const newGapId = () => `gap:${ui.gapSeq++}`;

function cardEl(c, extra = "", idx) {
  return h("div", { class: `card ${isRed(c) ? "red" : "black"} ${extra}`, "data-id": c.id, ...(idx !== undefined ? { "data-idx": idx } : {}) },
    h("div", { class: "corner" }, c.rank, h("small", {}, c.suit)),
    h("div", { class: "pip" }, c.suit));
}
function gapEl(id) {
  return h("div", { class: "hand-gap", "data-id": id, title: "Arrastra para mover · toca para quitar" }, h("span", { class: "gap-line" }));
}
function faceEl(c) {
  return h("div", { class: "face" },
    h("div", { class: "corner " + (isRed(c) ? "red" : "black") }, c.rank),
    h("div", { class: "suit " + (isRed(c) ? "red" : "black") }, c.suit));
}

// ---------- diseño de la mano ----------
// Devuelve [{card}|{gap}] en el orden elegido, sin la carta pendiente de descarte ni las que pusiste en la mesa.
function layoutItems(view) {
  const byId = new Map(view.hand.map((c) => [c.id, c]));
  const out = [], seen = new Set(stagedIds(ui.stage));
  if (ui.pending) seen.add(ui.pending);
  for (const id of ui.order) {
    if (isGapId(id)) out.push({ gap: id });
    else if (byId.has(id) && !seen.has(id)) { out.push({ card: byId.get(id) }); seen.add(id); }
  }
  for (const c of view.hand) if (!seen.has(c.id)) out.push({ card: c }); // cartas nuevas al final
  // Los espacios que ya no separan nada (al inicio, al final o seguidos, p. ej. tras plantarte) desaparecen.
  const clean = [];
  for (const it of out) {
    if (it.gap && (!clean.length || clean.at(-1).gap)) continue;
    clean.push(it);
  }
  while (clean.length && clean.at(-1).gap) clean.pop();
  return clean;
}
const visibleCards = () => layoutItems(cur.view).filter((i) => i.card).map((i) => i.card);
const layoutIds = () => layoutItems(cur.view).map((i) => i.card?.id ?? i.gap);

// Inserta una carta en la posición idx del diseño (contando cartas y espacios).
function insertIntoLayout(id, idx) {
  const ids = layoutIds().filter((x) => x !== id);
  ids.splice(idx ?? ids.length, 0, id);
  ui.order = ui.pending ? [...ids, ui.pending] : ids;
}
function removeGap(id) { ui.order = ui.order.filter((x) => x !== id); cur.rerender(); }

// Botones 789 / 777: ordenan UNA vez (no quedan activos) y separan los grupos con espacios.
function sortHand(mode) {
  const groups = (mode === "runs" ? groupRuns : groupSets)(visibleCards());
  const order = [];
  groups.forEach((g, i) => { if (i) order.push(newGapId()); order.push(...g.map((c) => c.id)); });
  ui.order = ui.pending ? [...order, ui.pending] : order;
  cur.rerender();
}

// Guarda en ui.order el orden actual del DOM (después de arrastrar/soltar).
function commitDomOrder() {
  const ids = [...document.getElementById("handLine").querySelectorAll("[data-id]")].map((e) => e.dataset.id);
  if (ids.filter(isGapId).length > MAX_GAPS) { toast(`Máximo ${MAX_GAPS} espacios`); return false; }
  ui.order = ui.pending ? [...ids, ui.pending] : ids;
  return true;
}

// ---------- FLIP (spec 1.3): las cartas se deslizan a su nuevo sitio en 0.15 s ----------
const snapshot = (line) => new Map([...line.children].map((c) => [c, c.getBoundingClientRect()]));
function flip(line, before) {
  if (reduceMotion()) return;
  for (const c of line.children) {
    const o = before.get(c);
    if (!o) continue;
    const n = c.getBoundingClientRect();
    const dx = o.left - n.left, dy = o.top - n.top;
    if (dx || dy) c.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 150, easing: "ease-out" });
  }
}
// Mueve `node` dentro de la mano según el puntero (el elemento más cercano decide el lado).
function placeAt(node, x, y) {
  const line = document.getElementById("handLine");
  const others = [...line.children].filter((c) => c !== node && !c.classList.contains("lifted"));
  let ref = null;
  if (others.length) {
    let best = null, bd = Infinity;
    for (const c of others) {
      const r = c.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(x - cx, (y - cy) * 1.5);
      if (d < bd) { bd = d; best = { c, cx }; }
    }
    ref = x < best.cx ? best.c : best.c.nextSibling;
  }
  if (ref === node || (node.parentNode === line && ref === node.nextSibling)) return;
  const before = snapshot(line);
  line.insertBefore(node, ref);
  flip(line, before);
}

// ---------- animación: una carta vuela entre el descarte y tu mano (lenta y con arco) ----------
function flyCard(card, fromRect, toRect) {
  ui.arriving.add(card.id);
  ui.fly?.remove();
  if (reduceMotion()) { ui.arriving.delete(card.id); return; }
  const el = cardEl(card, "fly-take");
  el.style.cssText = `left:${toRect.left}px;top:${toRect.top}px;width:${toRect.width}px;height:${toRect.height}px`;
  const layer = h("div", { class: "fly-layer" }, el);
  ui.fly = layer;
  document.body.append(layer);
  const dx = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2);
  const dy = fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2);
  const k = fromRect.width / toRect.width;
  el.animate(
    [
      { transform: `translate(${dx}px,${dy}px) scale(${k}) rotate(-6deg)`, offset: 0 },
      { transform: `translate(${dx * 0.45}px,${dy * 0.45 - 60}px) scale(${(k + 1) / 2 * 1.12}) rotate(3deg)`, offset: 0.55 },
      { transform: "none", offset: 1 },
    ],
    { duration: 900, easing: "ease-in-out", fill: "forwards" }
  ).finished.catch(() => {}).finally(() => {
    layer.remove();
    if (ui.fly === layer) ui.fly = null;
    if (ui.arriving.delete(card.id)) cur.rerender(); // la carta aparece ya en su sitio
  });
}

// Dónde caerá la carta si la tomas con un clic: al final de tu mano.
function endOfHandRect() {
  const line = document.getElementById("handLine");
  const last = line.lastElementChild;
  if (!last) return line.getBoundingClientRect();
  const r = last.getBoundingClientRect();
  const w = line.querySelector(".card")?.getBoundingClientRect() ?? r;
  return last.classList.contains("card")
    ? new DOMRect(r.left + r.width * 0.61, r.top, r.width, r.height)
    : new DOMRect(r.right, r.bottom - w.height, w.width, w.height);
}

// Con clic (sin `index`) la carta viaja animada a tu mano. Si la arrastraste tú, ya la moviste con la mano: sin animación.
function takeDiscard(card, toRect, index) {
  insertIntoLayout(card.id, index);
  if (index === undefined) flyCard(card, document.getElementById("unifiedSlot").getBoundingClientRect(), toRect ?? endOfHandRect());
  actions.takeDiscard(cur.room);
}

// Devolver a tu mano la carta que habías puesto en el descarte: con clic viaja animada; arrastrándola, no.
function undoDiscard(card, index) {
  const from = document.getElementById("unifiedSlot").getBoundingClientRect();
  ui.pending = null;
  if (index !== undefined) { insertIntoLayout(card.id, index); cur.rerender(); return; }
  ui.arriving.add(card.id);
  cur.rerender();
  const dest = document.querySelector(`#handLine [data-id="${card.id}"]`)?.getBoundingClientRect();
  ui.arriving.delete(card.id);
  if (dest) flyCard(card, from, dest);
  cur.rerender();
}

// Intercambio: sueltas una carta de tu mano sobre la que ya pusiste en el descarte.
// La del descarte vuela a tu mano y ocupa JUSTO el lugar de la carta que pusiste en su lugar.
function swapWithPending(card) {
  const old = cur.view.hand.find((c) => c.id === ui.pending);
  const from = document.getElementById("unifiedSlot").getBoundingClientRect();
  const ids = layoutIds();                 // sin la pendiente; incluye la carta que soltaste
  ids[ids.indexOf(card.id)] = old.id;      // la vieja toma el lugar exacto de la nueva
  ui.order = [...ids, card.id];
  ui.pending = card.id;                    // la nueva queda en el descarte
  ui.arriving.add(old.id);
  cur.rerender();
  const dest = document.querySelector(`#handLine [data-id="${old.id}"]`)?.getBoundingClientRect();
  ui.arriving.delete(old.id);
  if (dest) flyCard(old, from, dest);
  cur.rerender();
}

// ---------- selección y jugadas de mesa: plantarse, bajar, enganchar, robar un 2 ----------
const isWild = (c) => c.rank === "2";
const meldCardsOf = (m) => (m.kind === "set" ? m.cards : m.slots.map((s) => s.card));
const amPlanted = () => !!cur.view.players.find((p) => p.id === cur.view.you)?.planted;
const selectedCards = () => layoutItems(cur.view).filter((i) => i.card && ui.selected.has(i.card.id)).map((i) => i.card);
const toGroups = (groups) => groups.map((g) => ({ cardIds: g.cards.map((c) => c.id), ordered: g.ordered }));
const send = (fn) => { ui.gameAct = true; fn(); };

function toggleSelect(id) {
  ui.selected.has(id) ? ui.selected.delete(id) : ui.selected.add(id);
  cur.rerender();
}

// Guarda desde dónde sale cada carta (tu mano o tu jugada sin confirmar); cuando el servidor confirme,
// vuela de ahí a su lugar definitivo en la mesa.
function recordFlights(cards, fromRect) {
  for (const c of cards) {
    const from = fromRect ?? document.querySelector(`.hand-line [data-id="${c.id}"], .staged-card[data-id="${c.id}"]`)?.getBoundingClientRect();
    if (from) ui.flights.set(c.id, { from, at: performance.now() });
  }
}
function applyFlights() {
  if (!ui.flights.size) return;
  const now = performance.now();
  let n = 0;
  for (const [id, f] of [...ui.flights]) {
    if (now - f.at > 4000) { ui.flights.delete(id); continue; }
    const el = document.querySelector(`.mesa-panel .card[data-id="${id}"]`);
    if (!el) continue;                              // todavía no llegó el estado con esta carta
    ui.flights.delete(id);
    if (reduceMotion()) continue;
    const to = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.remove("recent", "arriving");
    ghost.classList.add("fly-flight");
    ghost.style.cssText = `left:${to.left}px;top:${to.top}px;width:${to.width}px;height:${to.height}px`;
    const layer = h("div", { class: "fly-layer" }, ghost);
    document.body.append(layer);
    el.classList.add("arriving");
    ui.flying.add(id);
    const dx = f.from.left + f.from.width / 2 - (to.left + to.width / 2);
    const dy = f.from.top + f.from.height / 2 - (to.top + to.height / 2);
    ghost.animate(
      [{ transform: `translate(${dx}px,${dy}px) scale(${f.from.width / to.width})` }, { transform: "none" }],
      { duration: 520, delay: n++ * 60, easing: "cubic-bezier(.2,.8,.25,1)", fill: "backwards" }
    ).finished.catch(() => {}).finally(() => {
      layer.remove();
      if (ui.flying.delete(id)) cur.rerender();
    });
  }
}

function plantStatus(sel) {
  const v = cur.view, total = v.requirement.reduce((s, r) => s + r.size, 0);
  if (v.stoleThisTurn) return { why: "Robaste un 2: no puedes plantarte este turno" };
  if (sel.length !== total) return { why: `Selecciona ${total} cartas (llevas ${sel.length})` };
  const groups = findPlantGroups(sel, v.requirement);
  if (!groups) return { why: "Esas cartas no forman lo que pide la ronda" };
  if (keptAfter(total) < 1) return { why: "Debes quedarte con una carta para descartar" };
  return { groups };
}
function layStatus(sel) {
  const groups = findFreeMelds(sel);
  if (!groups) return { why: "Esas cartas no forman un trío ni un consecutivo" };
  if (keptAfter(sel.length) < 1) return { why: "Debes quedarte con una carta para descartar" };
  return { groups };
}

// ---------- jugada en preparación: nada se envía hasta pulsar ✓ (todo junto, con playTurn) ----------
// Cartas que te quedarían (incluida la del descarte) si además apartas `n`.
const keptAfter = (n) => cur.view.hand.length - stagedIds(ui.stage).size - n;
const hasStage = () => ui.stage.groups.length > 0 || ui.stage.hooks.length > 0;
const previewOf = (meldId) => previewMelds(cur.view.melds, ui.stage.hooks).find((m) => m.id === meldId);

function stageGroups(groups) {
  if (keptAfter(groups.reduce((s, g) => s + g.cards.length, 0)) < 1) return toast("Debes quedarte con una carta para descartar");
  ui.stage.groups.push(...groups.map((g) => ({ cards: [...g.cards], ordered: g.ordered === true })));
  hooks.play("card");
  groups.forEach((g) => g.cards.forEach((c) => ui.selected.delete(c.id)));
  cur.rerender();
}
// Enganchar una o varias cartas a un plante de la mesa (propio o ajeno), en el orden que encaje.
// `prefer` ('low'|'high') decide el lado cuando una sola carta cabe por ambos extremos.
function stageHooks(entry, cards, prefer) {
  const meld = previewOf(entry.id)?.meld ?? entry.meld;
  let plan = planHooks(meld, cards);
  if (cards.length === 1 && meld.kind === "run") {
    const end = (prefer === "low" ? ["low", "high"] : ["high", "low"]).find((e) => extendMeld(meld, cards[0], e));
    plan = end ? [{ card: cards[0], end }] : null;
  }
  if (!plan) return toast("Esas cartas no encajan en ese plante");
  if (keptAfter(cards.length) < 1) return toast("Debes quedarte con una carta para descartar");
  ui.stage.hooks.push(...plan.map(({ card, end }) => ({ meldId: entry.id, card, end })));
  hooks.play("card");
  cards.forEach((c) => ui.selected.delete(c.id));
  cur.rerender();
}
function stageIntoGroup(i, cards) {
  let g = ui.stage.groups[i];
  for (const c of cards) g = g && addToGroup(g, c);
  if (!g) return toast("No encaja en ese grupo");
  if (keptAfter(cards.length) < 1) return toast("Debes quedarte con una carta para descartar");
  ui.stage.groups[i] = g;
  cards.forEach((c) => ui.selected.delete(c.id));
  cur.rerender();
}
function unstageGroup(i) { ui.stage.groups.splice(i, 1); cur.rerender(); }
function unstageHooks(meldId) { ui.stage.hooks = ui.stage.hooks.filter((x) => x.meldId !== meldId); cur.rerender(); }
function clearStage() { ui.stage = emptyStage(); cur.rerender(); }

// ✓ Fin de turno: valida TODA la jugada con la misma lógica del servidor. Si es inválida, no se envía y el turno no pasa.
function confirmTurn(btn) {
  if (!cur.mustDiscard) return;
  const res = buildTurn(cur.view, ui.stage, ui.pending, amPlanted());
  if (res.error) {
    toast(res.error);
    hooks.play("bad");
    if (!reduceMotion()) btn?.animate([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 220, iterations: 2 });
    return;
  }
  ui.gameAct = true;
  recordFlights([...ui.stage.groups.flatMap((g) => g.cards), ...ui.stage.hooks.map((x) => x.card)]);
  actions.playTurn(cur.room, res.turn);
}

// Robar un 2: la carta de tu mano reemplaza al 2 (antes de tomar carta y sin haberte plantado). Es inmediato.
function stealWith(entry, idx, card) {
  if (amPlanted()) return toast("Ya te plantaste: solo puedes robar 2s antes de plantarte");
  if (!cur.view.players.find((p) => p.id === entry.owner)?.planted) return toast("Solo puedes robar de jugadores que ya se plantaron");
  if (!isWild(meldCardsOf(entry.meld)[idx] ?? {})) return toast("Toca o suelta la carta sobre un 2");
  if (!stealTwo(entry.meld, idx, card)) return toast("Esa carta no encaja en el lugar de ese 2");
  send(() => actions.steal2(cur.room, entry.id, idx, card.id));
}

// Clic en un plante de la mesa: engancha las cartas seleccionadas, quita tus enganches sin confirmar, o roba un 2.
function onMeldClick(e, entry) {
  const cardEl_ = e.target.closest(".card");
  const idx = cardEl_ ? Number(cardEl_.dataset.idx) : -1;
  const sel = selectedCards();
  if (cur.canTake && !amPlanted()) {
    if (idx < 0 || !isWild(meldCardsOf(entry.meld)[idx])) return toast("Para robar, toca el 2 que quieres");
    if (sel.length !== 1) return toast("Selecciona la carta de tu mano que ocupará el lugar del 2");
    return stealWith(entry, idx, sel[0]);
  }
  if (!cur.mustDiscard) {
    if (cur.canTake && amPlanted()) toast("Primero toma una carta (el descarte o push). Después podrás enganchar");
    return;
  }
  if (!sel.length) {
    if (ui.stage.hooks.some((x) => x.meldId === entry.id)) return unstageHooks(entry.id);
    return toast("Arrastra una carta sobre el plante, o selecciónala y toca el plante");
  }
  stageHooks(entry, sel);
}
// Clic en un grupo sin confirmar: engancha ahí lo seleccionado, o lo devuelve a tu mano.
function onStagedClick(i) {
  const sel = selectedCards();
  if (sel.length) return stageIntoGroup(i, sel);
  unstageGroup(i);
}

// ¿Qué hay bajo el puntero? Un plante de la mesa o un grupo sin confirmar (stage = su índice).
function meldAt(x, y) {
  const els = document.elementsFromPoint(x, y);
  const meldEl = els.find((e) => e.classList?.contains("meld"));
  if (!meldEl) return null;
  const cardEl_ = els.find((e) => e.classList?.contains("card") && meldEl.contains(e));
  return {
    meldEl, idx: cardEl_ ? Number(cardEl_.dataset.idx) : -1,
    stage: meldEl.dataset.stage !== undefined ? Number(meldEl.dataset.stage) : null,
  };
}
const overMesa = (x, y) => { const m = document.querySelector(".mesa-panel"); return !!m && inRect(m.getBoundingClientRect(), x, y); };
function markMeldHover(x, y) {
  document.querySelectorAll(".meld.drop-over, .mesa-panel.drop-over").forEach((m) => m.classList.remove("drop-over"));
  if (x === undefined || !(cur.mustDiscard || cur.canTake)) return;
  const t = meldAt(x, y);
  if (t) t.meldEl.classList.add("drop-over");
  else if (cur.mustDiscard && overMesa(x, y)) document.querySelector(".mesa-panel").classList.add("drop-over");
}
// Soltar UNA carta de tu mano en la mesa: enganche (preparado) o, antes de tomar carta, robo de un 2.
function dropOnMeld(card, target, x) {
  if (cur.mustDiscard && target.stage !== null) return stageIntoGroup(target.stage, [card]);
  const entry = cur.view.melds.find((m) => m.id === Number(target.meldEl.dataset.meld));
  if (!entry) return;
  if (cur.mustDiscard) {
    const r = target.meldEl.getBoundingClientRect();     // lado izquierdo del plante → inicio; derecho → final
    stageHooks(entry, [card], x < r.left + r.width / 2 ? "low" : "high");
  } else if (cur.canTake) {
    if (amPlanted()) return toast("Primero toma una carta (el descarte o push). Después podrás enganchar");
    stealWith(entry, target.idx, card);
  }
}
// Soltar un GRUPO entero en la mesa: sobre un plante → enganchar todas; en otro lugar de la mesa → plante nuevo.
function dropGroup(cards, x, y) {
  if (!cur.mustDiscard) return toast(cur.canTake ? "Primero toma una carta (el descarte o push)" : "Espera tu turno");
  const target = meldAt(x, y);
  if (target && target.stage !== null) return stageIntoGroup(target.stage, cards);
  if (target) {
    const entry = cur.view.melds.find((m) => m.id === Number(target.meldEl.dataset.meld));
    return entry && stageHooks(entry, cards);
  }
  const shape = meldShape(cards);
  if (shape) stageGroups([{ cards, ordered: shape.ordered }]);
}

// Barra sobre tu mano: qué puedes hacer y cómo va tu jugada.
function actionBar(view, planted) {
  const sel = selectedCards();
  const kids = [];
  const btn = (label, ok, fn) => h("button", { class: "act-btn", disabled: !ok, onclick: fn }, label);
  const text = (t, cls = "") => h("span", { class: "act-text " + cls }, t);
  if (cur.mustDiscard) {
    if (sel.length) {
      const st = !planted && !ui.stage.groups.length ? plantStatus(sel) : layStatus(sel);
      kids.push(btn("A la mesa", !!st.groups, () => stageGroups(st.groups)),
        text(st.groups ? "Pulsa «A la mesa», o toca un plante para enganchar" : `${st.why} · o toca un plante para enganchar`, st.groups ? "good" : ""));
    } else if (hasStage()) {
      const res = buildTurn(view, ui.stage, ui.pending, planted);
      kids.push(text(res.turn ? "Jugada lista: pulsa ✓ para terminar el turno" : res.error, res.turn ? "good" : ""));
    } else {
      kids.push(text(planted
        ? "Arrastra un grupo a la mesa o una carta sobre un plante · termina con ✓"
        : "Arrastra a la mesa los grupos con los que te plantas (desde su primera o última carta) · termina con ✓"));
    }
    if (hasStage()) kids.push(h("button", { class: "act-clear", title: "Devolver a tu mano todo lo que pusiste en la mesa", onclick: clearStage }, "↶ Deshacer"));
  } else if (cur.canTake && !planted && view.melds.some((m) => meldCardsOf(m.meld).some(isWild))) {
    kids.push(text("Puedes robar un 2 antes de tomar carta: arrastra una carta que encaje sobre un 2 de la mesa"));
  } else if (cur.canTake && planted) {
    kids.push(text("Toma una carta (descarte o push) para poder bajar o enganchar"));
  }
  if (sel.length) kids.push(h("button", { class: "act-clear", title: "Quitar selección", onclick: () => { ui.selected.clear(); cur.rerender(); } }, `✕ ${sel.length}`));
  return h("div", { class: "hand-actions" }, kids);
}

// ---------- arrastre con Pointer Events (mouse y táctil), spec sección 3 ----------
// 'hand'    : reordenar tu mano (local) o soltar la carta en el descarte.
// 'gap'     : mover un espacio de tu mano; si lo sueltas fuera de la mano, se quita.
// 'gaptool' : sacar un espacio nuevo del botón "Espacio" y colocarlo entre tus cartas.
// 'slot'    : mode 'take' → traer el descarte a tu mano;  mode 'undo' → devolver tu carta pendiente.
// 'group'   : un grupo válido de tu mano (tomado de su primera o última carta): a la mesa entero, o moverlo en tu mano.
const inRect = (r, x, y, pad = 0) => x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;

function beginDrag(e, { kind, mode, card, el, onTap, gapId, group }) {
  if (e.button > 0) return;
  if (e.pointerType === "mouse") e.preventDefault();
  const sx = e.clientX, sy = e.clientY;
  let ghost = null, placeholder = null;
  const panel = () => document.querySelector(".hand-panel");
  const slot = () => document.getElementById("unifiedSlot");
  const gapDrag = kind === "gap" || kind === "gaptool";
  const inHandKinds = kind === "hand" || kind === "gap";
  const groupEls = () => group.map((c) => document.querySelector(`#handLine [data-id="${c.id}"]`)).filter(Boolean);
  const makeGhost = () => {
    if (gapDrag) return h("div", { class: "ghost-gap" }, h("span", { class: "gap-line" }));
    if (kind === "group") return h("div", { class: "ghost-group" }, group.map((c) => cardEl(c)));
    return cardEl(card, "ghost");
  };

  const move = (ev) => {
    if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
      ghost = makeGhost();
      document.body.append(ghost);
      if (kind === "group") groupEls().forEach((x) => x.classList.add("lifted"));
      else if (kind !== "gaptool") el.classList.add("dragging");
    }
    if (!ghost) return;
    ghost.style.left = ev.clientX + "px";
    ghost.style.top = ev.clientY + "px";
    const overHand = inRect(panel().getBoundingClientRect(), ev.clientX, ev.clientY, 12);
    if (kind === "hand" || kind === "group") markMeldHover(ev.clientX, ev.clientY);
    if (kind === "group" && cur.mustDiscard) slot().classList.toggle("drag-over", inRect(slot().getBoundingClientRect(), ev.clientX, ev.clientY, 14));
    if (inHandKinds) {
      if (overHand) placeAt(el, ev.clientX, ev.clientY);
      if (kind === "hand" && cur.mustDiscard) slot().classList.toggle("drag-over", inRect(slot().getBoundingClientRect(), ev.clientX, ev.clientY, 14));
    } else if (overHand) {
      placeholder ??= kind === "gaptool" ? gapEl(newGapId())
        : kind === "group" ? h("div", { class: "card placeholder group-ph", style: `width:calc(var(--hw) * ${0.61 * group.length + 0.39})` })
        : h("div", { class: "card placeholder" });
      placeAt(placeholder, ev.clientX, ev.clientY);
    } else if (placeholder) {
      const line = document.getElementById("handLine"), before = snapshot(line);
      placeholder.remove(); placeholder = null;
      flip(line, before);
    }
  };

  const end = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    if (!ghost) return ev.type === "pointerup" ? onTap?.() : undefined;
    const ghostRect = ghost.getBoundingClientRect();
    ghost.remove();
    el.classList.remove("dragging");
    slot()?.classList.remove("drag-over");
    markMeldHover();
    const ok = ev.type === "pointerup" && (kind === "gaptool" || el.isConnected);
    if (kind === "group") {
      groupEls().forEach((x) => x.classList.remove("lifted"));
      const overHandNow = ok && inRect(panel().getBoundingClientRect(), ev.clientX, ev.clientY, 12);
      if (ok && cur.mustDiscard && inRect(slot().getBoundingClientRect(), ev.clientX, ev.clientY, 14)) {
        placeholder?.remove();                       // al descarte va solo la carta que tomaste, no el grupo
        if (ui.pending && ui.pending !== card.id) return swapWithPending(card);
        ui.pending = card.id;
        ui.selected.delete(card.id);
        return cur.rerender();
      }
      if (ok && !overHandNow && (overMesa(ev.clientX, ev.clientY) || meldAt(ev.clientX, ev.clientY))) {
        placeholder?.remove();
        return dropGroup(group, ev.clientX, ev.clientY);
      }
      if (overHandNow && placeholder) moveGroupTo(placeholder, group);  // reordenar el grupo entero en tu mano
      placeholder?.remove();
      return cur.rerender();
    }
    if (kind === "hand" && ok) {                    // ¿la soltaste sobre un plante de la mesa? (enganchar / robar un 2)
      const target = meldAt(ev.clientX, ev.clientY);
      if (target) { dropOnMeld(card, target, ev.clientX, ghostRect); return cur.rerender(); }
      if (cur.mustDiscard && overMesa(ev.clientX, ev.clientY))
        toast("Una carta sola no es un plante: suéltala sobre un plante para engancharla, o arrastra un grupo");
    }
    const overHand = ok && inRect(panel().getBoundingClientRect(), ev.clientX, ev.clientY, 12);

    if (kind === "hand") {
      if (ok && cur.mustDiscard && inRect(slot().getBoundingClientRect(), ev.clientX, ev.clientY, 14)) {
        if (ui.pending && ui.pending !== card.id) return swapWithPending(card); // intercambio animado
        ui.pending = card.id;                       // descartar (se confirma con ✓)
        hooks.play("card");
        ui.selected.delete(card.id);
      } else if (overHand) {
        commitDomOrder();                           // reordenar (los espacios no se tocan)
      }
      cur.rerender();                               // fuera de todo: la carta vuelve a su sitio
    } else if (kind === "gap") {
      if (ok && !overHand) return removeGap(gapId); // soltar fuera de la mano = quitar el espacio
      if (overHand) commitDomOrder();
      cur.rerender();
    } else if (kind === "gaptool") {
      if (overHand && placeholder) commitDomOrder(); else placeholder?.remove();
      cur.rerender();
    } else if (ok && overHand && placeholder) {     // kind 'slot'
      const idx = [...document.getElementById("handLine").children].indexOf(placeholder);
      if (mode === "take" && cur.canTake) {
        takeDiscard(card, undefined, idx);                      // arrastrado: sin animación
        placeholder.replaceWith(cardEl(card));                  // el hueco se vuelve la carta al instante
        document.getElementById("unifiedSlot")?.classList.add("taken"); // la carta del slot ya está en tu mano
      }
      else if (mode === "undo") undoDiscard(card, idx);
      else placeholder.remove();
    } else {
      placeholder?.remove();
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

// El grupo arrastrado queda donde está el hueco, separado por espacios a ambos lados.
function moveGroupTo(placeholder, group) {
  const ids = new Set(group.map((c) => c.id));
  const order = [];
  for (const child of document.getElementById("handLine").children) {
    if (child === placeholder) order.push(newGapId(), ...ids, newGapId());
    else if (child.dataset.id && !ids.has(child.dataset.id)) order.push(child.dataset.id);
  }
  ui.order = ui.pending ? [...order, ui.pending] : order;
}

// ---------- render de la mesa ----------
export function renderTable(app, { view, room, rerender }) {
  const me = view.you;
  const byId = Object.fromEntries(view.players.map((p) => [p.id, p]));
  const myTurn = view.phase === "playing" && view.current === me;
  const canTake = myTurn && view.turnPhase === "start";
  const mustDiscard = myTurn && view.turnPhase === "main";
  cur = { view, room, rerender, canTake, mustDiscard };

  if (ui.round !== view.round) { ui.round = view.round; ui.order = []; ui.selected.clear(); ui.stage = emptyStage(); resetPending(); }
  if (!mustDiscard || !view.hand.some((c) => c.id === ui.pending)) ui.pending = null;
  // La jugada sin confirmar solo vive durante tu fase 'main'; si alguna carta ya no está en tu mano, se descarta entera.
  const inHand = new Set(view.hand.map((c) => c.id));
  if (!mustDiscard || [...stagedIds(ui.stage)].some((id) => !inHand.has(id))) ui.stage = emptyStage();
  const pendingCard = view.hand.find((c) => c.id === ui.pending) ?? null;
  ui.gameAct = false;
  // Reparto: solo cuando la ronda está recién empezada (nadie ha tomado carta ni hecho push).
  if (view.phase === "playing" && ui.dealRound !== view.round && view.deckCount === 156 - 10 * view.players.length - 1) {
    ui.dealRound = view.round;
    ui.dealPending = layoutItems(view).filter((i) => i.card).map((i) => i.card);
    ui.dealPending.forEach((c) => ui.arriving.add(c.id));
  }
  if (ui.pushWait) {                    // un push acaba de pasar: las cartas que te llegan esperan a la animación
    const w = ui.pushWait;
    const fresh = view.hand.filter((c) => !ui.prevIds.has(c.id));
    if (w.by !== me && w.to !== me) ui.pushWait = null;
    else if (fresh.length) {
      ui.pushWait = null;
      fresh.forEach((c) => ui.arriving.add(c.id));
      if (w.by === me) w.anim.landed.then(() => flyFromDeck(fresh[0]));          // tu carta del mazo
      else w.anim.done.finally(() => { fresh.forEach((c) => ui.arriving.delete(c.id)); cur.rerender(); }); // las 2 que te pasaron
    }
  }
  ui.prevIds = new Set(view.hand.map((c) => c.id));
  for (const id of [...ui.selected]) if (!view.hand.some((c) => c.id === id) || id === ui.pending) ui.selected.delete(id);
  const planted = !!byId[me]?.planted;
  const canMeldAct = mustDiscard || (canTake && !planted); // los plantes responden al toque / al arrastre

  // --- barra superior ---
  const hint = !myTurn
    ? `Turno de ${byId[view.current]?.name ?? "…"}`
    : canTake ? "Tu turno: toma el descarte o haz push" : pendingCard ? "Termina con ✓" : "Arma tu jugada y descarta";
  const topbar = h("div", { class: "topbar" },
    h("div", { class: "r-title" }, `Ronda ${view.round} de ${view.totalRounds}`),
    goalInline(view, byId[me]),
    h("div", { class: "scoreboard" },
      view.players.map((p) =>
        h("div", { class: "sc-item" + (p.id === me ? " you" : "") },
          h("div", { class: "name" }, p.name), h("div", { class: "total" }, p.total)))),
    h("div", { class: "turn-flag" + (myTurn ? "" : " wait") }, hint, turnClock(view)),
    h("div", { class: "top-btns" }, sizeButton(() => requestAnimationFrame(fitMesa)), fsButton()));

  // --- tira de jugadores (dinámica: 2, 3 o 4) ---
  const strip = h("div", { class: "players-strip" },
    view.players.map((p) =>
      h("div", { class: "p-chip" + (p.id === me ? " you" : "") + (p.id === view.current ? " turn" : ""), "data-pid": p.id },
        h("div", { class: "avatar" }, (p.name || "?")[0].toUpperCase()),
        h("div", { class: "p-chip-meta" },
          h("div", { class: "p-name" }, p.name),
          h("span", { class: "status-chip" + (p.planted ? "" : " off") }, p.planted ? "Plantado" : p.connected ? "Sin plantar" : "Desconectado")),
        h("div", { class: "card-count" }, h("span", { class: "icon" }, ""), p.cards))));

  // --- plantes en mesa, agrupados por dueño (con tus enganches sin confirmar ya colocados, en punteado) ---
  const shownMelds = previewMelds(view.melds, ui.stage.hooks);
  const owners = view.players.filter((p) => shownMelds.some((m) => m.owner === p.id));
  const recent = new Set(view.recentCardIds);
  const stagedHookIds = new Set(ui.stage.hooks.map((x) => x.card.id));
  const stagedRow = ui.stage.groups.length
    ? h("div", { class: "owner-row staged-row" },
        h("div", { class: "owner-label" }, h("span", { class: "dot" }), h("span", { class: "name", title: "Sin confirmar: toca un grupo para devolverlo a tu mano" }, "Tu jugada")),
        h("div", { class: "melds-line" },
          ui.stage.groups.map((g, gi) =>
            h("div", { class: "meld staged-meld tappable", "data-stage": gi, onclick: () => onStagedClick(gi) },
              g.cards.map((c, i) => cardEl(c, "staged-card " + (isWild(c) ? "wild" : ""), i))))))
    : null;
  const mesa = h("div", { class: "mesa-panel" + (mustDiscard ? " droppable" : "") },
    h("div", { class: "mesa-title" }, "Plantes en mesa"),
    stagedRow,
    owners.length
      ? owners.map((p) =>
          h("div", { class: "owner-row" },
            h("div", { class: "owner-label" }, h("span", { class: "dot" }), h("span", { class: "name" }, p.id === me ? `${p.name} (tú)` : p.name)),
            h("div", { class: "melds-line" },
              shownMelds.filter((m) => m.owner === p.id).map((m) => {
                const cards = m.meld.kind === "set" ? m.meld.cards : m.meld.slots.map((s) => s.card);
                const original = view.melds.find((x) => x.id === m.id);
                return h("div", { class: "meld" + (canMeldAct ? " tappable" : ""), "data-meld": m.id, onclick: (e) => onMeldClick(e, original) },
                  cards.map((c, i) => cardEl(c, (stagedHookIds.has(c.id) ? "staged-card " : recent.has(c.id) ? "recent " : "") +
                    (isWild(c) ? "wild " : "") + (ui.flying.has(c.id) ? "arriving" : ""), i)));
              }))))
      : stagedRow ? null : h("div", { class: "empty-mesa" }, mustDiscard ? "Arrastra aquí tus grupos para plantarte" : "Nadie se ha plantado todavía"));

  // --- mano: tú decides el orden y los espacios. Los tramos que forman plante se marcan y se arrastran enteros ---
  const items = layoutItems(view);
  const groupsById = validGroupsById(items);
  const handLine = h("div", { class: "hand-line", id: "handLine" },
    items.map((it) => {
      if (it.gap) {
        const g = gapEl(it.gap);
        g.addEventListener("pointerdown", (e) => beginDrag(e, { kind: "gap", el: g, gapId: it.gap, onTap: () => removeGap(it.gap) }));
        return g;
      }
      const c = it.card, grp = groupsById.get(c.id);
      const handle = grp && (grp.first || grp.last);
      const el = cardEl(c, (ui.arriving.has(c.id) ? "arriving " : "") + (ui.selected.has(c.id) ? "selected " : "") +
        (grp ? "in-grp " : "") + (grp?.first ? "grp-first " : "") + (grp?.last ? "grp-last " : ""));
      if (handle) el.title = "Arrastra desde aquí para mover el grupo entero";
      el.addEventListener("pointerdown", (e) => beginDrag(e, handle
        ? { kind: "group", group: grp.cards, card: c, el, onTap: () => toggleSelect(c.id) }
        : { kind: "hand", card: c, el, onTap: () => toggleSelect(c.id) }));
      return el;
    }));
  const gapTool = h("div", {
    class: "gap-tool", title: "Arrastra un espacio entre tus cartas para separarlas",
    onpointerdown: (e) => beginDrag(e, { kind: "gaptool", el: gapTool, onTap: () => toast("Arrastra el espacio hasta el lugar de tu mano donde quieras separar") }),
  }, h("span", { class: "gap-tool-icon" }, "⇿"), "Espacio");
  const handPanel = h("div", { class: "hand-panel" }, h("div", { class: "hand-top" }, actionBar(view, planted), gapTool), handLine);

  // --- riel de acciones ---
  let slotClass = "unified-slot", slotBody, slotLabel, dragSlot = null;
  const top = view.discardTop;
  if (mustDiscard) {
    if (pendingCard) {
      slotClass += " has-card tappable";
      slotBody = faceEl(pendingCard);
      slotLabel = "Toca o arrastra para recuperarla";
      dragSlot = { mode: "undo", card: pendingCard, onTap: () => undoDiscard(pendingCard) };
    } else {
      slotClass += " empty-wait";
      slotBody = h("span", { class: "drop-icon" }, "⇩");
      slotLabel = "Descartar";
    }
  } else if (top) {
    slotClass += " has-card" + (canTake ? " tappable" : "");
    slotBody = faceEl(top);
    slotLabel = canTake ? "Toca o arrastra a tu mano" : "Descarte";
    if (canTake) dragSlot = { mode: "take", card: top, onTap: () => takeDiscard(top) };
  } else {
    slotClass += " empty-wait idle";
    slotBody = h("span", { class: "drop-icon" }, "…");
    slotLabel = "Descarte";
  }
  const slotEl = h("div", { id: "unifiedSlot", class: slotClass }, slotBody);
  if (dragSlot) slotEl.addEventListener("pointerdown", (e) => beginDrag(e, { kind: "slot", el: slotEl, ...dragSlot }));

  // ✓ siempre responde en tu turno: si la jugada no vale, explica por qué y no la envía.
  const turnCheck = mustDiscard ? buildTurn(view, ui.stage, ui.pending, planted) : null;
  const confirmState = !mustDiscard ? "disabled" : turnCheck.turn ? "active" : pendingCard || hasStage() ? "invalid" : "disabled";
  const stagedPoints = [...ui.stage.groups.flatMap((g) => g.cards), ...ui.stage.hooks.map((x) => x.card)].reduce((s, c) => s + points(c), 0);
  const rail = h("div", { class: "action-rail" },
    h("div", { class: "rail-pill" },
      h("div", { class: "val" }, h("span", { class: "coin" }), view.handPoints - (pendingCard ? points(pendingCard) : 0) - stagedPoints),
      h("div", { class: "sub" }, "En juego")),
    h("div", { class: "rail-center-group" },
      h("div", { class: "sort-btn", "aria-label": "Ordenar por consecutivos", onclick: () => sortHand("runs") }, h("div", { class: "val" }, "789")),
      h("div", { class: "sort-btn", "aria-label": "Ordenar por tríos", onclick: () => sortHand("sets") }, h("div", { class: "val" }, "777")),
      h("button", { class: "push-btn" + (canTake ? "" : " disabled"), onclick: () => canTake && actions.push(room) },
        h("span", { class: "p-badge" }, "P"), h("span", { class: "p-text" }, "Push")),
      slotEl,
      h("div", { class: "slot-label" }, slotLabel),
      h("div", { class: "deck-count", title: "Cartas que quedan en el mazo" },
        h("span", { class: "deck-back" }), h("span", { class: "deck-num" }, view.deckCount)),
      h("div", {
        class: "confirm-btn " + confirmState, title: turnCheck?.error ?? "",
        onclick: (e) => confirmTurn(e.currentTarget),
      }, "✓"),
      h("div", { class: "confirm-label" }, "Fin de turno")));

  const main = h("div", { class: "main-col" }, topbar, strip, mesa, handPanel);
  const felt = h("div", { class: "table-felt" }, main, rail);
  app.replaceChildren(h("div", { class: "table-frame wide-frame" }, felt));
  fitMesa();
  detectRemotePlay(view);
  applyFlights();
  if (ui.dealPending) {                           // reparto: las cartas salen del mazo hacia tu mano, una por una
    const list = ui.dealPending;
    ui.dealPending = null;
    list.forEach((c, i) => flyFromDeck(c, i * 90, 650));
  }
  if (view.phase === "roundOver" || view.phase === "finished") app.append(overlay(view, room));
}

// ---------- temporizador de turno ----------
// El servidor manda cuánto le queda al turno (turnMsLeft); aquí se convierte en una hora local al recibir cada vista
// nueva y un intervalo actualiza el número cada segundo sin redibujar la mesa.
const clock = { view: null, endsAt: null };
function turnClock(view) {
  if (view !== clock.view) { clock.view = view; clock.endsAt = view.turnMsLeft == null ? null : Date.now() + view.turnMsLeft; }
  if (clock.endsAt == null || view.phase !== "playing") return null;
  return h("span", { class: "turn-clock", "data-ends": clock.endsAt }, clockText(clock.endsAt));
}
const clockText = (endsAt) => {
  const s = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  return ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
setInterval(() => {
  for (const el of document.querySelectorAll(".turn-clock[data-ends]")) {
    const ends = Number(el.dataset.ends);
    el.textContent = clockText(ends);
    el.classList.toggle("urgent", ends - Date.now() <= 10_000);
  }
}, 500);

// ---------- fin de ronda / fin de partida ----------
function overlay(view, room) {
  const byId = Object.fromEntries(view.players.map((p) => [p.id, p]));
  const finished = view.phase === "finished";
  const isHost = view.host === view.you;
  const rows = [...view.players]
    .sort((a, b) => (finished ? a.total - b.total : 0))
    .map((p) =>
      h("div", { class: "score-row" + (p.id === view.winner ? " win" : "") },
        h("div", { class: "p-name" }, p.name, p.id === view.winner ? " 🏆" : ""),
        h("div", { class: "pts" }, `+${view.roundScores[p.id]}`),
        h("div", { class: "tot" }, p.total)));
  const title = finished
    ? `Ganó ${view.gameWinners.map((id) => byId[id].name).join(" y ")}`
    : view.winner ? `Ronda ${view.round}: ganó ${byId[view.winner].name}` : `Ronda ${view.round}: se acabó el mazo`;
  return h("div", { class: "overlay" },
    h("div", { class: "overlay-card" },
      h("h2", {}, title),
      h("div", { class: "score-head" }, h("span", {}, "Jugador"), h("span", {}, "Ronda"), h("span", {}, "Total")),
      rows,
      finished ? rewardsBox(view) : null,
      finished
        ? h("button", { class: "primary", onclick: () => hooks.onExit() }, "Volver al menú")
        : isHost
          ? h("button", { class: "primary", onclick: () => actions.nextRound(room) }, "Siguiente ronda")
          : h("div", { class: "hint" }, "Esperando al anfitrión…")));
}

// Tus premios al terminar la partida (XP y fichas). Los invitados sin cuenta no tienen.
function rewardsBox(view) {
  const r = view.rewards?.[view.you];
  if (!r) return null;
  const place = ["1.º", "2.º", "3.º", "4.º"][r.place] ?? "";
  return h("div", { class: "rewards" },
    h("div", { class: "rewards-row" },
      h("span", {}, "Puesto ", h("b", {}, place)),
      h("span", {}, "+", h("b", {}, r.xp), " XP"),
      view.entryFee ? h("span", {}, "Fichas ", h("b", {}, (r.chips > 0 ? "+" : "") + r.chips)) : null));
}

// ---------- objetivo de la ronda ----------
// Agrupa el requisito [{kind,size}] en tarjetas: "3× trío", "consecutivo de 5", etc.
function goalInline(view, mePlayer) {
  const groups = [];
  for (const r of view.requirement) {
    const g = groups.find((x) => x.kind === r.kind && x.size === r.size);
    g ? g.count++ : groups.push({ ...r, count: 1 });
  }
  const mini = (rank, suit) =>
    h("span", { class: "mini-card " + (suit === "♥" || suit === "♦" ? "red" : "black") }, rank, h("small", {}, suit));
  const pills = groups.map((g) => {
    let samples, label;
    if (g.kind === "set") {
      samples = g.size === 3 ? [mini("7", "♠"), mini("7", "♥"), mini("7", "♦")] : [mini("7", "♠"), mini("7", "♥"), mini("7", "♦"), mini("7", "♣")];
      label = g.size === 3 ? (g.count > 1 ? "tríos" : "trío") : g.count > 1 ? "cuartetos" : "cuarteto";
    } else {
      samples = [mini("4", "♣"), mini("5", "♣"), mini("6", "♣"), h("span", { class: "mini-dots" }, "…")];
      label = `consecutivo${g.count > 1 ? "s" : ""} de ${g.size}`;
    }
    return h("div", { class: "req-pill" },
      g.count > 1 ? h("span", { class: "req-count" }, `${g.count}×`) : null,
      h("span", { class: "mini-row" }, samples),
      h("span", { class: "req-label" }, label));
  });
  const withPlus = pills.flatMap((p, i) => (i ? [h("span", { class: "req-plus" }, "+"), p] : [p]));
  if (mePlayer?.planted) return h("div", { class: "goal-inline" }, h("span", { class: "goal-title done" }, "Plantado ✓"), infoButton());
  return h("div", { class: "goal-inline" }, h("span", { class: "goal-title" }, "Plantarte:"), withPlus, infoButton());
}

// Botón ⓘ: la explicación aparece al pasar el cursor (o al tocarlo en el celular), sin hacer clic.
function infoButton() {
  const row = (term, text) => h("div", { class: "info-row" }, h("b", {}, term), " ", text);
  return h("span", { class: "info", tabindex: "0", "aria-label": "Qué es un trío, un cuarteto y un consecutivo" },
    "i",
    h("div", { class: "info-pop" },
      row("Trío:", "3 cartas del mismo número y de distinto palo."),
      row("Cuarteto:", "4 cartas del mismo número, una de cada palo."),
      row("Consecutivo:", "cartas seguidas del mismo palo (ej. 4♣ 5♣ 6♣ 7♣ 8♣)."),
      row("El 2:", "es comodín y reemplaza cualquier carta.")));
}

// ---------- animación del push (spec sección 5: dos tiempos) ----------
// 1) la carta boca abajo cae sobre el descarte y lo tapa. 2) ambas viajan al jugador que las recibe.
async function runPushAnimation({ card, toPid, me }, onLanded) {
  const slot = document.getElementById("unifiedSlot");
  const target = toPid === me ? document.querySelector(".hand-panel") : document.querySelector(`[data-pid="${toPid}"]`);
  if (!slot || !target) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const s = slot.getBoundingClientRect(), t = target.getBoundingClientRect();
  const under = card ? h("div", { class: "fly fly-face" }, faceEl(card)) : null;
  const back = h("div", { class: "fly fly-back" }, h("span", {}, "P"));
  const group = h("div", {
    class: "fly-group",
    style: `left:${s.left}px;top:${s.top}px;width:${s.width}px;height:${s.height}px;--sw:${s.width}px`,
  }, under, back);
  const layer = h("div", { class: "fly-layer" }, group);
  document.body.append(layer);

  try {
    // Tiempo 1: cae y cubre el descarte
    await back.animate(
      [
        { transform: "translateY(-130px) rotate(-10deg) scale(1.15)", opacity: 0 },
        { transform: "translateY(0) rotate(0) scale(1)", opacity: 1 },
      ],
      { duration: 450, easing: "ease-out", fill: "forwards" }
    ).finished;
    await new Promise((r) => setTimeout(r, 300)); // pausa para que se vea que quedó cubierta
    onLanded();
    // Tiempo 2: el par se desliza hacia el siguiente jugador
    const dx = t.left + t.width / 2 - (s.left + s.width / 2);
    const dy = t.top + t.height / 2 - (s.top + s.height / 2);
    await group.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: `translate(${dx}px,${dy}px) scale(.55)`, opacity: 0.15 },
      ],
      { duration: 900, easing: "ease-in-out", fill: "forwards" }
    ).finished;
    // Latido en el destino para marcar quién recibió
    target.animate([{ transform: "scale(1)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" }], { duration: 260 });
  } finally {
    layer.remove();
  }
}

// Devuelve { landed, done }: `landed` = la carta ya cubrió el descarte; `done` = el par llegó al siguiente jugador.
export function playPushAnimation(args) {
  let resolveLanded;
  const landed = new Promise((r) => (resolveLanded = r));
  const done = runPushAnimation(args, () => resolveLanded()).catch(() => {});
  done.finally(() => resolveLanded());
  return { landed, done };
}
export function notePush(info) { ui.pushWait = info; }

// Tu carta del mazo tras un push: sale del contador del mazo, vuela a tu mano y se da vuelta.
function flyFromDeck(card, delay = 0, T = 1000) {
  const finish = () => { if (ui.arriving.delete(card.id)) cur.rerender(); };
  const deck = document.querySelector(".deck-back");
  const dest = document.querySelector(`#handLine [data-id="${card.id}"]`)?.getBoundingClientRect();
  if (!deck || !dest || reduceMotion()) return finish();
  const from = deck.getBoundingClientRect();
  const face = cardEl(card);
  const back = h("div", { class: "card fly-draw-back" });
  const wrap = h("div", { class: "fly-draw", style: `left:${dest.left}px;top:${dest.top}px;width:${dest.width}px;height:${dest.height}px` }, face, back);
  const layer = h("div", { class: "fly-layer" }, wrap);
  document.body.append(layer);
  const dx = from.left + from.width / 2 - (dest.left + dest.width / 2);
  const dy = from.top + from.height / 2 - (dest.top + dest.height / 2);
  const k = from.width / dest.width;
  wrap.animate([
    { transform: `translate(${dx}px,${dy}px) scale(${k})`, offset: 0 },
    { transform: `translate(${dx * 0.45}px,${dy * 0.45 - 60}px) scale(${((k + 1) / 2) * 1.1})`, offset: 0.55 },
    { transform: "none", offset: 1 },
  ], { duration: T, delay, easing: "ease-in-out", fill: "both" });
  back.animate([{ opacity: 1 }, { opacity: 1, offset: 0.62 }, { opacity: 0 }], { duration: T, delay, fill: "both" });
  face.animate([{ opacity: 0 }, { opacity: 0, offset: 0.62 }, { opacity: 1 }], { duration: T, delay, fill: "both" })
    .finished.catch(() => {}).finally(() => { layer.remove(); finish(); });
}

// Reduce el tamaño de las cartas de la mesa hasta que TODOS los plantes quepan sin desplazarse.
function fitMesa() {
  const panel = document.querySelector(".mesa-panel");
  if (!panel) return;
  let s = 1.1;                                       // si hay pocos plantes, pueden verse un poco más grandes
  panel.classList.add("scroll");                     // mientras se mide, el panel recorta (así scrollHeight es fiable)
  panel.style.setProperty("--mscale", s);
  const overflows = () => panel.scrollHeight > panel.clientHeight + 1 || panel.scrollWidth > panel.clientWidth + 1;
  while (overflows() && s > 0.4) {
    s -= 0.06;
    panel.style.setProperty("--mscale", s.toFixed(2));
  }
  if (!overflows()) panel.classList.remove("scroll"); // cabe todo: sin recorte, así el zoom de las cartas se ve completo
}
window.addEventListener("resize", () => { if (cur) fitMesa(); });

// Otro jugador acaba de plantarse / bajar / enganchar: sus cartas viajan desde su ficha hasta la mesa.
export function notePlay(by) { ui.remotePlay = { by, at: performance.now() }; }
function detectRemotePlay(view) {
  const ids = [...document.querySelectorAll(".mesa-panel .card[data-id]")].map((e) => e.dataset.id);
  if (ui.remotePlay && performance.now() - ui.remotePlay.at > 6000) ui.remotePlay = null;
  if (ui.remotePlay) {
    const fresh = ids.filter((id) => !ui.prevMesa.has(id) && !ui.flights.has(id));
    const chip = document.querySelector(`.p-chip[data-pid="${ui.remotePlay.by}"]`)?.getBoundingClientRect();
    if (fresh.length) {
      if (chip) for (const id of fresh) {
        const to = document.querySelector(`.mesa-panel .card[data-id="${id}"]`).getBoundingClientRect();
        const from = new DOMRect(chip.left + chip.width / 2 - to.width / 2, chip.top + chip.height / 2 - to.height / 2, to.width, to.height);
        ui.flights.set(id, { from, at: performance.now() });
      }
      ui.remotePlay = null;
    }
  }
  ui.prevMesa = new Set(ids);
}
