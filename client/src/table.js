import "./table.css";
import { h, toast, fsButton, avatarImg, coinImg } from "./dom.js";
import { t, num } from "./i18n.js";
import { cardEl, faceEl } from "./cardview.js";
import { actions } from "./net.js";
import { suitColor } from "./format.js";
import { groupRuns, groupSets } from "./grouping.js";
import { extendMeld, stealTwo } from "../../src/logic/melds.js";
import { planHooks } from "../../src/logic/plan.js";
import { isBot } from "../../src/logic/bot.js";
import { meldShape, groupAt, previewMelds, addToGroup, buildTurn, emptyStage, stagedIds } from "./staging.js";
import { syncCells, placeCard, placeGroup, cellsFromGroups, nextFree, gridShape, cellItems } from "./handgrid.js";

// ---------- estado SOLO de interfaz (cosmético/local, no se sincroniza: spec sección 0) ----------
// ui.cells es TU mano como cuadrícula: cada casilla tiene el id de una carta o null (un espacio que dejaste).
const ui = {
  cells: [],
  dragging: false,      // estás arrastrando (o manteniendo presionada) una carta: la mesa no se redibuja hasta soltar
  deferred: false,      // llegó algo mientras arrastrabas: al soltar se redibuja con lo último
  renders: 0,           // cuántas veces se dibujó la mesa (para no redibujar dos veces al soltar)
  landing: null,        // id de la carta que otro jugador descartó y aún vuela al descarte (mientras, se ve vacío)
  liveSent: null,       // última jugada en preparación que enviaste (para mandar solo los cambios)
  prevLive: new Map(),  // cartas que se veían en la jugada en vivo de otro (las que ya estaban no repiten su entrada)
  handW: 0,             // ancho medido de la mano (para calcular cuántas casillas caben)
  incoming: null,       // carta del descarte que arrastraste a tu mano y que el servidor aún no confirma
  pending: null,        // carta arrastrada al descarte, a la espera de ✓
  arriving: new Set(),  // cartas que están "volando" hacia tu mano (ocultas hasta que lleguen)
  fly: null,            // capa de la animación en curso
  round: null,
  stage: emptyStage(),  // jugada sin confirmar: { groups:[{cards, ordered}], hooks:[{meldId, card, end}] }
  flights: new Map(),   // id de carta → { at: ms }: recién jugadas; aparecen de translúcidas a sólidas en la mesa
  gameAct: false,       // acabas de enviar plantarse / bajar / enganchar / robar y esperas respuesta
  prevIds: new Set(),   // cartas que había en tu mano en el render anterior (para detectar las recién llegadas)
  pushWait: null,       // un push acaba de ocurrir: { by, to, anim } (las cartas nuevas esperan a la animación)
  dealRound: null,      // ronda para la que ya se animó el reparto
  dealPending: null,    // cartas que están por repartirse a tu mano
  remotePlay: null,     // otro jugador acaba de plantarse / bajar / enganchar: { by, at }
  clearing: new Map(),  // plantes completos que están saliendo de la mesa: id → { cards, index, started }
  prevTurn: null,       // { current, top, round } del render anterior (para animar lo que hacen los demás con el descarte)
  lastPushAt: 0,        // hora del último push (el descarte desaparece por el push, no porque alguien lo tomara)
  prevMesa: new Set(),  // cartas que había en la mesa en el render anterior
};
const LONG_PRESS_MS = 350; // mantener presionada la primera o última carta de un grupo lo toma entero
let cur = null; // contexto del último render { view, room, rerender, canTake, mustDiscard }
let hooks = { onExit: () => location.reload(), play: () => {} };
// main.js conecta aquí la salida al menú y los sonidos.
export function setTableHooks(next) { hooks = { ...hooks, ...next }; }

export function resetPending() {
  ui.pending = null;
  ui.incoming = null;
  ui.arriving.clear();
  ui.fly?.remove();
  ui.fly = null;
  ui.flights.clear();
}

// Si el servidor rechaza una jugada de mesa (plantarse, bajar, enganchar, robar) no se toca tu descarte pendiente.
export function handleRejected() {
  if (ui.gameAct) { ui.gameAct = false; ui.flights.clear(); }
  else resetPending();
}

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- tu mano: una cuadrícula (ver handgrid.js) ----------
// Cartas que no se muestran en la mano (la del descarte pendiente y las que pusiste en la mesa sin confirmar).
const hiddenIds = () => new Set([...stagedIds(ui.stage), ...(ui.pending ? [ui.pending] : [])]);
// Las casillas como [{card}|{gap}]. De paso coloca las cartas nuevas y vacía las que ya no tienes.
function layoutItems(view) {
  const hand = [...view.hand];
  if (ui.incoming && !hand.some((c) => c.id === ui.incoming.id)) hand.push(ui.incoming); // aún no confirmada
  else ui.incoming = null;
  ui.cells = syncCells(ui.cells, hand.map((c) => c.id));
  return cellItems(ui.cells, new Map(hand.map((c) => [c.id, c])), hiddenIds());
}
const visibleCards = () => layoutItems(cur.view).filter((i) => i.card).map((i) => i.card);

// Botones 789 / 777: ordenan UNA vez y dejan una casilla vacía entre grupo y grupo.
function sortHand(mode) {
  const groups = (mode === "runs" ? groupRuns : groupSets)(visibleCards());
  const hidden = [...hiddenIds()].filter((id) => cur.view.hand.some((c) => c.id === id));
  ui.cells = [...cellsFromGroups(groups), ...(hidden.length ? [null, ...hidden] : [])];
  cur.rerender();
}

// Tamaño normal de una casilla en px: la carta de la mano (--hw de table.css) más un poquito de aire (las cartas del
// atril van casi pegadas).
const CELL_AIR = 1.05;
function cellMax() {
  const scale = Number(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
  const hw = Math.min(84, Math.max(38, Math.min(innerWidth * 0.05, innerHeight * 0.082))) * scale;
  return hw * CELL_AIR;
}
// Casilla de la mano más cercana al puntero, o -1 si estás fuera de la mano.
function cellAt(x, y) {
  const panel = document.querySelector(".hand-panel");
  if (!panel || !inRect(panel.getBoundingClientRect(), x, y, 12)) return -1;
  let best = -1, bd = Infinity;
  for (const el of document.querySelectorAll("#handLine .hand-cell")) {
    const r = el.getBoundingClientRect();
    const d = Math.hypot(x - (r.left + r.width / 2), (y - (r.top + r.height / 2)) * 1.3);
    if (d < bd) { bd = d; best = Number(el.dataset.cell); }
  }
  return best;
}
// Resalta las casillas donde caería lo que arrastras (una carta o un grupo de n).
function markCells(from, n = 1) {
  document.querySelectorAll("#handLine .hand-cell.drop-cell").forEach((e) => e.classList.remove("drop-cell"));
  for (let i = from; from >= 0 && i < from + n; i++) document.querySelector(`#handLine .hand-cell[data-cell="${i}"]`)?.classList.add("drop-cell");
}
const cellRect = (i) => document.querySelector(`#handLine .hand-cell[data-cell="${i}"]`)?.getBoundingClientRect();

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

// Dónde caerá la carta si la tomas con un clic: la primera casilla libre después de tu última carta.
function endOfHandRect() {
  return cellRect(nextFree(ui.cells)) ?? document.getElementById("handLine").getBoundingClientRect();
}

// Acción bloqueada por el tutorial (locks() → { take?, push? }: el aviso que explica qué hacer en ese paso).
function locked(action) {
  const msg = cur.locks?.()?.[action];
  if (msg) { toast(msg); hooks.play("bad"); }
  return !!msg;
}

// Con clic (sin `index`) la carta viaja animada a tu mano. Si la arrastraste a una casilla, queda ahí sin animación.
// Devuelve false si no se pudo tomar (bloqueado en el tutorial).
function takeDiscard(card, toRect, index) {
  if (locked("take")) return false;
  const at = index ?? nextFree(ui.cells);
  const dest = toRect ?? cellRect(at) ?? endOfHandRect();
  ui.cells = placeCard(ui.cells, card.id, at);
  ui.incoming = card;
  if (index === undefined) flyCard(card, document.getElementById("unifiedSlot").getBoundingClientRect(), dest);
  actions.takeDiscard(cur.room);
  return true;
}

// Devolver a tu mano la carta que habías puesto en el descarte: con clic viaja animada; arrastrándola, no.
function undoDiscard(card, index) {
  const from = document.getElementById("unifiedSlot").getBoundingClientRect();
  ui.pending = null;
  if (index !== undefined) { ui.cells = placeCard(ui.cells, card.id, index); cur.rerender(); return; }
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
  const a = ui.cells.indexOf(card.id), b = ui.cells.indexOf(old.id);
  ui.cells[a] = old.id;                    // la vieja toma la casilla exacta de la nueva
  if (b >= 0) ui.cells[b] = card.id;
  ui.pending = card.id;                    // la nueva queda en el descarte
  ui.arriving.add(old.id);
  cur.rerender();
  const dest = document.querySelector(`#handLine [data-id="${old.id}"]`)?.getBoundingClientRect();
  ui.arriving.delete(old.id);
  if (dest) flyCard(old, from, dest);
  cur.rerender();
}

// ---------- jugadas de mesa: plantarse, bajar, enganchar, robar un 2 (todo arrastrando) ----------
const isWild = (c) => c.rank === "2";
const meldCardsOf = (m) => (m.kind === "set" ? m.cards : m.slots.map((s) => s.card));
const amPlanted = () => !!cur.view.players.find((p) => p.id === cur.view.you)?.planted;
const send = (fn) => { ui.gameAct = true; fn(); };

// Cartas que acabas de enviar a la mesa: cuando el servidor confirme, aparecen de translúcidas a sólidas.
function recordFlights(cards) {
  for (const c of cards) ui.flights.set(c.id, { at: performance.now() });
}
function applyFlights() {
  if (!ui.flights.size) return;
  const now = performance.now();
  for (const [id, f] of [...ui.flights]) {
    if (now - f.at > 4000) { ui.flights.delete(id); continue; }
    const el = document.querySelector(`.mesa-panel .card[data-id="${id}"]`);
    if (!el) continue;                              // todavía no llegó el estado con esta carta
    ui.flights.delete(id);
    if (reduceMotion()) continue;
    el.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 650, easing: "ease-out" });
  }
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
  if (!amPlanted()) return toast("Primero te plantas. Podrás enganchar desde tu próximo turno");
  if (!plan) return toast("Esas cartas no encajan en ese plante");
  if (keptAfter(cards.length) < 1) return toast("Debes quedarte con una carta para descartar");
  ui.stage.hooks.push(...plan.map(({ card, end }) => ({ meldId: entry.id, card, end })));
  hooks.play("card");
  cur.rerender();
}
function stageIntoGroup(i, cards) {
  let g = ui.stage.groups[i];
  for (const c of cards) g = g && addToGroup(g, c);
  if (!g) return toast("No encaja en ese grupo");
  if (keptAfter(cards.length) < 1) return toast("Debes quedarte con una carta para descartar");
  ui.stage.groups[i] = g;
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

// Clic en un plante de la mesa: quita tus enganches sin confirmar de ese plante (todo lo demás se hace arrastrando).
function onMeldClick(e, entry) {
  if (!cur.mustDiscard && !cur.canTake) return;
  if (ui.stage.hooks.some((x) => x.meldId === entry.id)) return unstageHooks(entry.id);
  toast(cur.canTake && !amPlanted()
    ? t("Para robar un 2, arrastra la carta de tu mano que va en su lugar y suéltala sobre el 2")
    : t("Arrastra una carta de tu mano sobre el plante para engancharla"));
}
// Clic en un grupo sin confirmar: lo devuelve a tu mano.
function onStagedClick(i) { unstageGroup(i); }

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
    // ¿Quería robar un 2? Solo se puede al empezar el turno (antes de tomar carta): se lo explicamos.
    const onTwo = isWild(meldCardsOf(entry.meld)[target.idx] ?? {});
    if (!amPlanted() && onTwo && stealTwo(entry.meld, target.idx, card))
      return toast("Los 2 se roban al EMPEZAR tu turno, antes de tomar el descarte o hacer push. Inténtalo en tu próximo turno");
    // Los consecutivos se ven de mayor a menor (A K Q … 3): lado izquierdo → el extremo alto; derecho → el bajo.
    const r = target.meldEl.getBoundingClientRect();
    stageHooks(entry, [card], x < r.left + r.width / 2 ? "high" : "low");
  } else if (cur.canTake) {
    if (amPlanted()) return toast("Primero toma una carta (el descarte o push). Después podrás enganchar");
    stealWith(entry, target.idx, card);
  }
}
// Soltar un GRUPO entero en la mesa: sobre un plante → enganchar todas; en otro lugar de la mesa → plante nuevo.
function dropGroup(cards, x, y) {
  if (!cur.mustDiscard) return toast(cur.canTake ? t("Primero toma una carta (el descarte o push)") : t("Espera tu turno"));
  const target = meldAt(x, y);
  if (target && target.stage !== null) return stageIntoGroup(target.stage, cards);
  if (target) {
    const entry = cur.view.melds.find((m) => m.id === Number(target.meldEl.dataset.meld));
    return entry && stageHooks(entry, cards);
  }
  const shape = meldShape(cards);
  if (shape) stageGroups([{ cards, ordered: shape.ordered }]);
  else toast(cards.length < 3 ? t("Un plante necesita al menos 3 cartas") : t("Esas cartas no forman un plante"));
}

// Barra sobre tu mano: qué puedes hacer y cómo va tu jugada.
function actionBar(view, planted) {
  const kids = [];
  const text = (t, cls = "") => h("span", { class: "act-text " + cls }, t);
  if (cur.mustDiscard) {
    if (hasStage()) {
      const res = buildTurn(view, ui.stage, ui.pending, planted);
      kids.push(text(res.turn ? t("Jugada lista: pulsa ✓ para terminar el turno") : t(res.error), res.turn ? "good" : ""));
      kids.push(h("button", { class: "act-clear", title: t("Devolver a tu mano todo lo que pusiste en la mesa"), onclick: clearStage }, t("↶ Deshacer")));
    } else {
      kids.push(text(planted
        ? t("Arrastra cartas a la mesa · mantén presionada la 1.ª o última carta de un grupo para llevarlo entero · termina con ✓")
        : t("Para plantarte, mantén presionada la 1.ª o última carta de cada grupo y arrástralo a la mesa · termina con ✓")));
    }
  } else if (cur.canTake && !planted && view.melds.some((m) => meldCardsOf(m.meld).some(isWild))) {
    kids.push(text(t("Puedes robar un 2 antes de tomar carta: arrastra una carta que encaje sobre un 2 de la mesa")));
  } else if (cur.canTake && planted) {
    kids.push(text(t("Toma una carta (descarte o push) para poder bajar o enganchar")));
  }
  return h("div", { class: "hand-actions" }, kids);
}

// ---------- arrastre con Pointer Events (mouse y táctil), spec sección 3 ----------
// 'hand'  : mover una carta a otra casilla de tu mano (si está ocupada, empuja las cartas hasta el siguiente espacio),
//           soltarla en el descarte o sobre un plante de la mesa.
// 'group' : un grupo válido de tu mano: se toma MANTENIENDO PRESIONADA su primera o última carta. Va entero a la
//           mesa, o a otras casillas de tu mano (las cartas quedan juntas, pero sueltas: no queda agrupado).
// 'slot'  : mode 'take' → traer el descarte a una casilla de tu mano;  mode 'undo' → devolver tu carta pendiente.
const inRect = (r, x, y, pad = 0) => x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;

function beginDrag(e, { kind, mode, card, el, onTap, group, findGroup }) {
  if (e.button > 0) return;
  if (e.pointerType === "mouse") e.preventDefault();
  const sx = e.clientX, sy = e.clientY;
  let ghost = null, pressTimer = null, longPressed = false;
  ui.dragging = true;                                // lo que llegue mientras tanto espera a que sueltes
  const slot = () => document.getElementById("unifiedSlot");
  const groupEls = () => group.map((c) => document.querySelector(`#handLine [data-id="${c.id}"]`)).filter(Boolean);
  const overSlot = (ev) => inRect(slot().getBoundingClientRect(), ev.clientX, ev.clientY, 14);
  const makeGhost = () => (kind === "group" ? h("div", { class: "ghost-group" }, group.map((c) => cardEl(c))) : cardEl(card, "ghost"));
  // Carta de la mano: si la mantienes presionada sin moverla y es la 1.ª o última de un grupo válido, tomas el grupo.
  if (kind === "hand" && findGroup) {
    pressTimer = setTimeout(() => {
      const g = !ghost && findGroup();
      if (!g) return;
      kind = "group"; group = g.cards; longPressed = true;
      groupEls().forEach((x) => x.classList.add("grp-pick"));
      hooks.play("card");
    }, LONG_PRESS_MS);
  }

  const move = (ev) => {
    if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
      clearTimeout(pressTimer);
      ghost = makeGhost();
      document.body.append(ghost);
      if (kind === "group") groupEls().forEach((x) => { x.classList.remove("grp-pick"); x.classList.add("lifted"); });
      else el.classList.add("dragging");
    }
    if (!ghost) return;
    ghost.style.left = ev.clientX + "px";
    ghost.style.top = ev.clientY + "px";
    if (kind !== "slot") markMeldHover(ev.clientX, ev.clientY);
    if (kind !== "slot" && cur.mustDiscard) slot().classList.toggle("drag-over", overSlot(ev));
    markCells(cellAt(ev.clientX, ev.clientY), kind === "group" ? group.length : 1);
  };

  // Al soltar: se aplica el movimiento y, si llegó algo mientras arrastrabas, la mesa se pone al día.
  const end = (ev) => {
    ui.dragging = false;
    const missed = ui.deferred, before = ui.renders;
    ui.deferred = false;
    finish(ev);
    if (missed && ui.renders === before) cur.rerender();
  };
  const finish = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    clearTimeout(pressTimer);
    if (!ghost) {
      if (longPressed) { groupEls().forEach((x) => x.classList.remove("grp-pick")); return; }
      return ev.type === "pointerup" ? onTap?.() : undefined;
    }
    ghost.remove();
    el.classList.remove("dragging");
    slot()?.classList.remove("drag-over");
    markMeldHover();
    markCells(-1);
    const ok = ev.type === "pointerup" && el.isConnected;
    const target = ok ? cellAt(ev.clientX, ev.clientY) : -1;   // casilla de tu mano donde lo soltaste

    if (kind === "group") {
      groupEls().forEach((x) => x.classList.remove("lifted"));
      if (ok && cur.mustDiscard && overSlot(ev)) {                // al descarte va solo la carta que tomaste
        if (ui.pending && ui.pending !== card.id) return swapWithPending(card);
        ui.pending = card.id;
        return cur.rerender();
      }
      if (ok && target < 0 && (overMesa(ev.clientX, ev.clientY) || meldAt(ev.clientX, ev.clientY)))
        return dropGroup(group, ev.clientX, ev.clientY);
      if (target >= 0) ui.cells = placeGroup(ui.cells, group.map((c) => c.id), target);
      return cur.rerender();
    }
    if (kind === "hand") {
      if (ok && target < 0) {                                     // ¿sobre un plante de la mesa? (enganchar / robar un 2)
        const meld = meldAt(ev.clientX, ev.clientY);
        if (meld) { dropOnMeld(card, meld, ev.clientX); return cur.rerender(); }
        if (cur.mustDiscard && overMesa(ev.clientX, ev.clientY))
          toast("Una carta sola no es un plante: suéltala sobre un plante para engancharla, o arrastra un grupo");
      }
      if (ok && cur.mustDiscard && overSlot(ev)) {
        if (ui.pending && ui.pending !== card.id) return swapWithPending(card); // intercambio animado
        ui.pending = card.id;                                     // descartar (se confirma con ✓)
        hooks.play("card");
      } else if (target >= 0) {
        ui.cells = placeCard(ui.cells, card.id, target);          // a otra casilla de tu mano
      }
      return cur.rerender();                                      // fuera de todo: la carta vuelve a su casilla
    }
    // kind 'slot'
    if (target < 0) return;
    if (mode === "take" && cur.canTake) {
      if (takeDiscard(card, undefined, target))                   // arrastrada: queda en esa casilla, sin animación
        document.getElementById("unifiedSlot")?.classList.add("taken");
      cur.rerender();
    } else if (mode === "undo") undoDiscard(card, target);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

// Cuántos grupos y enganches llevas armados sin confirmar (lo usa el tutorial para saber en qué paso vas).
export const stageInfo = () => ({ groups: ui.stage.groups.length, hooks: ui.stage.hooks.length, pending: !!ui.pending });

// ---------- render de la mesa ----------
// onSkip: estás en el tutorial (la barra lleva el botón «Saltar» a la izquierda de pantalla completa).
// locks: () => { take?, push? } — el tutorial bloquea tomar el descarte o hacer push en algunos pasos.
export function renderTable(app, { view, room, rerender, onSkip, locks }) {
  // Mientras arrastras una carta no se toca la mesa (si no, la carta que agarraste desaparecería y el movimiento se
  // perdería); al soltar se dibuja con el estado más reciente.
  if (ui.dragging) { ui.deferred = true; return; }
  ui.renders++;
  const me = view.you;
  const byId = Object.fromEntries(view.players.map((p) => [p.id, p]));
  const myTurn = view.phase === "playing" && view.current === me;
  const canTake = myTurn && view.turnPhase === "start";
  const mustDiscard = myTurn && view.turnPhase === "main";
  cur = { view, room, rerender, canTake, mustDiscard, locks };
  const meldsBefore = meldRects();                     // para que los plantes se reacomoden con animación
  ui.prevLive = new Map([...document.querySelectorAll(".mesa-panel .live-card[data-id]")].map((e) => [e.dataset.id, e.getBoundingClientRect()]));

  if (ui.round !== view.round) { ui.round = view.round; ui.cells = []; ui.stage = emptyStage(); resetPending(); }
  if (!mustDiscard || !view.hand.some((c) => c.id === ui.pending)) ui.pending = null;
  // La jugada sin confirmar solo vive durante tu fase 'main'; si alguna carta ya no está en tu mano, se descarta entera.
  const inHand = new Set(view.hand.map((c) => c.id));
  if (!mustDiscard || [...stagedIds(ui.stage)].some((id) => !inHand.has(id))) ui.stage = emptyStage();
  const pendingCard = view.hand.find((c) => c.id === ui.pending) ?? null;
  ui.gameAct = false;
  sendLive(mustDiscard);
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
      else w.anim.landed.then(() => {                                            // las 2 que te pasaron
        const from = document.getElementById("unifiedSlot")?.getBoundingClientRect();
        fresh.forEach((c, i) => flyFromDeck(c, i * 140, 800, from, c.id !== w.card?.id));
      });
    }
  }
  ui.prevIds = new Set(view.hand.map((c) => c.id));
  const planted = !!byId[me]?.planted;
  const canMeldAct = mustDiscard || (canTake && !planted); // los plantes responden al toque / al arrastre

  // --- barra superior ---
  const hint = !myTurn
    ? t("Turno de {name}", { name: byId[view.current]?.name ?? "…" })
    : canTake ? t("Tu turno: toma el descarte o haz push") : pendingCard ? t("Termina con ✓") : t("Arma tu jugada y descarta");
  const topbar = h("div", { class: "topbar" },
    h("div", { class: "r-title" }, t("Ronda {n} de {total}", { n: view.round, total: view.totalRounds }),
      view.finalTurnsLeft != null ? h("span", { class: "last-lap", title: t("Se acabó el mazo: cada jugador juega un turno más y se cuentan las manos") },
        " · " + t("Última vuelta ({n})", { n: view.finalTurnsLeft })) : null),
    goalInline(view, byId[me]),
    h("div", { class: "turn-flag" + (myTurn ? "" : " wait") }, hint, turnClock(view)),
    h("div", { class: "top-btns" },
      onSkip ? h("button", { class: "skip-btn", onclick: onSkip }, t("Saltar")) : null,
      fsButton(),
      h("button", { class: "fs-btn menu-btn", title: t("Menú: ajustes, reglas y salir"), "aria-label": t("Menú"), onclick: () => hooks.onMenu?.() }, "☰")));

  // --- columna de jugadores (izquierda): los demás en orden de turno y tú abajo. El que tiene el turno lleva el aro
  //     dorado alrededor del avatar: es su reloj (se va vaciando). ---
  const myIdx = view.players.findIndex((p) => p.id === me);
  const seated = [...view.players.slice(myIdx + 1), ...view.players.slice(0, myIdx), view.players[myIdx]].filter(Boolean);
  const seat = (p) => {
    const turn = p.id === view.current && view.phase === "playing";
    const status = p.reconnectMsLeft != null && !p.left
      ? h("span", { class: "status-chip off reconnecting", "data-reconnect": reconnectEnds(view, p), title: t("Se desconectó: si no vuelve a tiempo, abandona") }, reconnectText(reconnectEnds(view, p)))
      : h("span", { class: "status-chip" + (p.planted ? "" : " off") }, p.left ? t("Abandonó") : p.planted ? t("Plantado") : p.connected ? t("Sin plantar") : t("Desconectado"));
    return h("div", { class: "p-chip seat" + (p.id === me ? " you" : "") + (turn ? " turn" : ""), "data-pid": p.id, ...(turn && turnFill(view)) },
      h("div", { class: "seat-av" },
        p.avatar ? avatarImg(p.avatar, p.name) : h("div", { class: "avatar" }, (p.name || "?")[0].toUpperCase()),
        p.level ? h("span", { class: "seat-level", title: t("Nivel {n}", { n: p.level }) }, p.level) : null),
      h("div", { class: "seat-name" }, p.name),
      h("div", { class: "seat-meta" },
        h("span", { class: "card-count", title: t("Cartas en la mano") }, h("span", { class: "icon" }, ""), p.cards),
        h("span", { class: "seat-total", title: t("Puntos acumulados en la partida") }, p.total)),
      status);
  };
  const playersCol = h("div", { class: "players-col", style: `--n:${seated.length}` }, seated.map(seat));

  // --- plantes en mesa: de todos (sin nombres), con tus enganches sin confirmar ya colocados (en punteado). Tu jugada
  //     sin confirmar va AL FINAL (debajo), para no mover los plantes que ya están. ---
  // La jugada en vivo de otro jugador (lo que arma sin confirmar): sus enganches ya colocados y sus grupos abajo.
  const live = view.live && (view.live.groups.length || view.live.hooks.length) ? view.live : null;
  const shownMelds = previewMelds(view.melds, [...ui.stage.hooks, ...(live?.hooks ?? [])]);
  const recent = new Set(view.recentCardIds);
  const stagedHookIds = new Set(ui.stage.hooks.map((x) => x.card.id));
  const liveHookIds = new Set((live?.hooks ?? []).map((x) => x.card.id));
  const stagedMelds = ui.stage.groups.map((g, gi) =>
    h("div", { class: "meld staged-meld tappable", "data-stage": gi, title: t("Sin confirmar: toca para devolverlo a tu mano"), onclick: () => onStagedClick(gi) },
      g.cards.map((c, i) => cardEl(c, "staged-card " + (isWild(c) ? "wild" : ""), i))));
  // Los consecutivos se muestran de mayor a menor (A K Q … 3); data-idx sigue siendo la posición en m.meld (robo de 2).
  const tableMelds = shownMelds.map((m) => {
    const cards = meldCardsOf(m.meld);
    const order = m.meld.kind === "run" ? cards.map((_, i) => cards.length - 1 - i) : cards.map((_, i) => i);
    const original = view.melds.find((x) => x.id === m.id);
    return h("div", { class: "meld" + (canMeldAct ? " tappable" : ""), "data-meld": m.id, onclick: (e) => onMeldClick(e, original) },
      order.map((i) => { const c = cards[i]; return cardEl(c, (stagedHookIds.has(c.id) ? "staged-card " : liveHookIds.has(c.id) ? `live-card ${ui.prevLive.has(c.id) ? "" : "live-new "}` : recent.has(c.id) ? "recent " : "") +
        (isWild(c) ? "wild " : ""), i); }));
  });
  for (const [id, c] of ui.clearing) {
    const ph = h("div", { class: "meld clearing", "data-clearing": id }, c.cards.map((card) => cardEl(card, "ph-hidden")));
    tableMelds.splice(Math.min(Math.max(c.index, 0), tableMelds.length), 0, ph);
  }
  const mesa = h("div", { class: "mesa-panel" + (mustDiscard ? " droppable" : "") },
    h("div", { class: "mesa-title" }, t("Plantes en mesa")),
    stagedMelds.length || tableMelds.length || live
      ? h("div", { class: "melds-line" }, tableMelds,
          stagedMelds.length ? h("div", { class: "staged-row" }, stagedMelds) : null,
          live ? h("div", { class: "staged-row live-row" },
            h("div", { class: "live-tag" }, t("{name} está armando su jugada…", { name: byId[live.by]?.name ?? t("Alguien") })),
            live.groups.map((g) => h("div", { class: "meld live-meld" }, g.map((c, i) => cardEl(c, "live-card" + (ui.prevLive.has(c.id) ? "" : " live-new") + (isWild(c) ? " wild" : ""), i))))) : null)
      : h("div", { class: "empty-mesa" }, mustDiscard ? t("Arrastra aquí tus grupos para plantarte") : t("Nadie se ha plantado todavía")));

  // --- mano: una cuadrícula de SIEMPRE 2 filas (alto fijo); cada carta en su casilla y las vacías son tus espacios.
  //     Mantener presionada la 1.ª o última carta de un grupo de cartas juntas lo toma entero. ---
  const items = layoutItems(view);
  const maxCell = cellMax();
  // El atril empieza con 10 casillas por fila; con más cartas CRECE a lo ancho (las cartas conservan su tamaño) y solo
  // si ya no cabe entre los jugadores y el riel, las cartas se achican.
  const shape = gridShape(items.length, ui.handW || Math.max(300, innerWidth * 0.6), maxCell);
  // --hw: tamaño de las cartas (el normal, o más chicas si la casilla es angosta) · --hwmax: el normal, que fija el alto
  // de las 2 filas. Van en el atril (también lo usa para su madera).
  const rackStyle = `--cols:${shape.cols};--cell:${shape.cell}px;--hw:${(Math.min(shape.cell, maxCell) / CELL_AIR).toFixed(1)}px;--hwmax:${(maxCell / CELL_AIR).toFixed(1)}px`;
  const handLine = h("div", { class: "hand-line", id: "handLine" }, Array.from({ length: shape.rows * shape.cols }, (_, i) => {
    const c = items[i]?.card;
    // fila de arriba pegada hacia abajo y la de abajo hacia arriba: las dos filas siempre juntas
    const cell = h("div", { class: "hand-cell" + (i < shape.cols ? " row-top" : " row-bottom") + (c ? "" : " empty"), "data-cell": i });
    if (c) {
      const el = cardEl(c, ui.arriving.has(c.id) ? "arriving" : "");
      el.addEventListener("pointerdown", (e) => beginDrag(e, {
        kind: "hand", card: c, el, findGroup: () => groupAt(layoutItems(cur.view), c.id),
      }));
      cell.append(el);
    }
    return cell;
  }));
  const handPanel = h("div", { class: "hand-panel" }, actionBar(view, planted), handLine);

  // --- riel de acciones ---
  let slotClass = "unified-slot", slotBody, slotLabel, dragSlot = null;
  const top = view.discardTop;
  if (mustDiscard) {
    if (pendingCard) {
      slotClass += " has-card tappable";
      slotBody = faceEl(pendingCard);
      slotLabel = t("Toca o arrastra para recuperarla");
      dragSlot = { mode: "undo", card: pendingCard, onTap: () => undoDiscard(pendingCard) };
    } else {
      slotClass += " empty-wait";
      slotBody = h("span", { class: "drop-icon" }, "⇩");
      slotLabel = t("Descartar");
    }
  } else if (top && ui.landing !== top.id) {
    slotClass += " has-card" + (canTake ? " tappable" : "");
    slotBody = faceEl(top);
    slotLabel = canTake ? t("Toca o arrastra a tu mano") : t("Descarte");
    if (canTake) dragSlot = { mode: "take", card: top, onTap: () => takeDiscard(top) };
  } else {
    slotClass += " empty-wait idle";
    slotBody = h("span", { class: "drop-icon" }, "…");
    slotLabel = t("Descarte");
  }
  const slotEl = h("div", { id: "unifiedSlot", class: slotClass }, slotBody);
  if (dragSlot) slotEl.addEventListener("pointerdown", (e) => beginDrag(e, { kind: "slot", el: slotEl, ...dragSlot }));

  // ✓ siempre responde en tu turno: si la jugada no vale, explica por qué y no la envía.
  const turnCheck = mustDiscard ? buildTurn(view, ui.stage, ui.pending, planted) : null;
  const confirmState = !mustDiscard ? "disabled" : turnCheck.turn ? "active" : pendingCard || hasStage() ? "invalid" : "disabled";
  const payers = view.players.filter((p) => !isBot(p.id)).length;   // los bots no pagan cuota
  const pot = (view.entryFee ?? 0) * payers;                         // lo que se lleva el ganador de la partida
  const rail = h("div", { class: "action-rail" },
    pot ? h("div", { class: "rail-pill pot", title: t("Cuota de {fee} fichas × {n} jugadores: se lo lleva el ganador de la partida", { fee: view.entryFee, n: payers }) },
      h("div", { class: "val" }, coinImg("coin"), num(pot)),
      h("div", { class: "sub" }, t("Pozo"))) : null,
    h("div", { class: "rail-center-group" },
      h("div", { class: "sort-btn", "aria-label": t("Ordenar por consecutivos"), onclick: () => sortHand("runs") }, h("div", { class: "val" }, "789")),
      h("div", { class: "sort-btn", "aria-label": t("Ordenar por tríos"), onclick: () => sortHand("sets") }, h("div", { class: "val" }, "777")),
      h("button", {
        class: "push-btn" + (canTake && view.deckCount >= 2 ? "" : " disabled"),
        title: view.deckCount < 2 ? t("Se acabó el mazo: solo puedes tomar el descarte") : "",
        onclick: () => canTake && !locked("push") && (view.deckCount < 2 ? toast("Se acabó el mazo: solo puedes tomar el descarte") : actions.push(room)),
      },
        h("span", { class: "p-badge" }, "P"), h("span", { class: "p-text" }, t("Push"))),
      slotEl,
      h("div", { class: "slot-label" }, slotLabel),
      h("div", { class: "deck-count", title: t("Cartas que quedan en el mazo") },
        h("span", { class: "deck-back" }), h("span", { class: "deck-num" }, view.deckCount)),
      h("button", {
        class: "confirm-btn " + confirmState, title: turnCheck?.error ? t(turnCheck.error) : "", "aria-label": t("Terminar turno"),
        onclick: (e) => confirmTurn(e.currentTarget),
      }, h("span", { class: "ck" }, "✓"), h("span", { class: "ck-lbl" }, t("Terminar turno")))));

  // Cuadrícula de la mesa: jugadores a la izquierda; arriba la barra; el tablero al centro con el riel a su derecha
  // (empieza a la misma altura); abajo el atril de madera, pegado al borde. El contenedor del atril da el ancho disponible.
  const felt = h("div", { class: "table-felt" }, playersCol, topbar, mesa, rail,
    h("div", { class: "hand-dock" }, h("div", { class: "hand-rack", style: rackStyle }, handPanel)));
  app.replaceChildren(h("div", { class: "table-frame wide-frame" }, felt));
  fitMesa();
  fitHand();
  startClearing();
  slideMelds(meldsBefore);
  detectRemotePlay(view);
  detectRemoteDiscard(view);
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
// Jugador desconectado: cuánto le queda para volver (el servidor manda los ms; aquí se cuenta hacia atrás).
const reconnectAt = new WeakMap(); // vista → { id: hora local en que vence }
function reconnectEnds(view, p) {
  if (!reconnectAt.has(view)) reconnectAt.set(view, {});
  const m = reconnectAt.get(view);
  return (m[p.id] ??= Date.now() + p.reconnectMsLeft);
}
const reconnectText = (endsAt) => t("Reconectando… {s} s", { s: Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) });

// Relleno de la ficha del jugador en turno: 1 = turno recién empezado, 0 = se acabó el tiempo (sin límite: lleno).
function turnFill(view) {
  if (clock.endsAt == null || !view.turnTime) return { style: "--t:1" };
  const total = view.turnTime * 1000;
  return { "data-ends": clock.endsAt, "data-total": total, style: `--t:${Math.max(0, (clock.endsAt - Date.now()) / total).toFixed(3)}` };
}

setInterval(() => {
  for (const el of document.querySelectorAll(".seat.turn[data-ends]"))
    el.style.setProperty("--t", Math.max(0, (Number(el.dataset.ends) - Date.now()) / Number(el.dataset.total)).toFixed(3));
  for (const el of document.querySelectorAll(".status-chip[data-reconnect]")) el.textContent = reconnectText(Number(el.dataset.reconnect));
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
    // de menor a mayor puntaje (el que va ganando arriba); a igual total, el que sumó menos en la ronda; quien
    // abandonó, al final
    .sort((a, b) => (!!a.left - !!b.left) || a.total - b.total || (view.roundScores?.[a.id] ?? 0) - (view.roundScores?.[b.id] ?? 0))
    .map((p) =>
      h("div", { class: "score-row" + (p.id === view.winner ? " win" : "") },
        h("div", { class: "p-name" }, p.name, p.id === view.winner ? " 🏆" : "", p.left ? t(" (abandonó)") : ""),
        h("div", { class: "pts" }, `+${view.roundScores?.[p.id] ?? 0}`),
        h("div", { class: "tot" }, p.total)));
  const title = finished
    ? t("Ganó {names}", { names: view.gameWinners.map((id) => byId[id].name).join(t(" y ")) })
    : view.winner ? t("Ronda {n}: ganó {name}", { n: view.round, name: byId[view.winner].name }) : t("Ronda {n}: se acabó el mazo", { n: view.round });
  return h("div", { class: "overlay" },
    h("div", { class: "overlay-card" },
      h("h2", {}, title),
      h("div", { class: "score-head" }, h("span", {}, t("Jugador")), h("span", {}, t("Ronda")), h("span", {}, t("Total"))),
      rows,
      finished ? rewardsBox(view) : null,
      finished
        ? h("button", { class: "primary", onclick: () => hooks.onExit() }, t("Volver al menú"))
        : isHost
          ? h("button", { class: "primary", onclick: () => actions.nextRound(room) }, t("Siguiente ronda"))
          : h("div", { class: "hint" }, t("Esperando al anfitrión…"))));
}

// Tus premios al terminar la partida (XP y fichas). Los invitados sin cuenta no tienen.
function rewardsBox(view) {
  const r = view.rewards?.[view.you];
  if (!r) return null;
  if (r.left) return h("div", { class: "rewards" }, h("div", { class: "rewards-row" }, h("span", {}, t("Abandonaste: sin XP y sin la cuota"))));
  const place = t(["1.º", "2.º", "3.º", "4.º"][r.place] ?? "");
  return h("div", { class: "rewards" },
    h("div", { class: "rewards-row" },
      h("span", {}, t("Puesto "), h("b", {}, place)),
      h("span", {}, "+", h("b", {}, r.xp), " XP"),
      view.entryFee ? h("span", {}, t("Fichas "), h("b", {}, (r.chips > 0 ? "+" : "") + r.chips)) : null));
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
    h("span", { class: "mini-card " + suitColor(suit) }, rank, h("small", {}, suit));
  const pills = groups.map((g) => {
    let samples, label;
    if (g.kind === "set") {
      samples = g.size === 3 ? [mini("7", "♠"), mini("7", "♥"), mini("7", "♦")] : [mini("7", "♠"), mini("7", "♥"), mini("7", "♦"), mini("7", "♣")];
      label = g.size === 3 ? (g.count > 1 ? t("tríos") : t("trío")) : g.count > 1 ? t("cuartetos") : t("cuarteto");
    } else {
      samples = [mini("6", "♣"), mini("5", "♣"), mini("4", "♣"), h("span", { class: "mini-dots" }, "…")];
      label = t(g.count > 1 ? "consecutivos de {n}" : "consecutivo de {n}", { n: g.size });
    }
    return h("div", { class: "req-pill" },
      g.count > 1 ? h("span", { class: "req-count" }, `${g.count}×`) : null,
      h("span", { class: "mini-row" }, samples),
      h("span", { class: "req-label" }, label));
  });
  const withPlus = pills.flatMap((p, i) => (i ? [h("span", { class: "req-plus" }, "+"), p] : [p]));
  if (mePlayer?.planted) return h("div", { class: "goal-inline" }, h("span", { class: "goal-title done" }, t("Plantado ✓")), infoButton());
  return h("div", { class: "goal-inline" }, h("span", { class: "goal-title" }, t("Plantarte:")), withPlus, infoButton());
}

// Botón ⓘ: la explicación aparece al pasar el cursor (o al tocarlo en el celular), sin hacer clic.
function infoButton() {
  const row = (term, text) => h("div", { class: "info-row" }, h("b", {}, term), " ", text);
  return h("span", { class: "info", tabindex: "0", "aria-label": t("Qué es un trío, un cuarteto y un consecutivo") },
    "i",
    h("div", { class: "info-pop" },
      row(t("Trío:"), t("3 cartas del mismo número, de cualquier palo.")),
      row(t("Cuarteto:"), t("4 cartas del mismo número, de cualquier palo.")),
      row(t("Consecutivo:"), t("cartas seguidas del mismo palo (ej. 8♣ 7♣ 6♣ 5♣ 4♣). Orden A, K, Q … 3.")),
      row(t("Mínimo:"), t("los grupos pueden ser más grandes de lo que se pide.")),
      row(t("El 2:"), t("es el comodín (la carta P) y reemplaza cualquier carta."))));
}

// ---------- animación del push (spec sección 5: dos tiempos) ----------
// 1) la carta boca abajo cae sobre el descarte y lo tapa. 2) ambas viajan al jugador que las recibe.
// Si las recibes TÚ, la animación termina al cubrir el descarte: desde ahí cada carta vuela a su casilla de tu mano.
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
    if (toPid === me) return;
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
export function notePush(info) { ui.pushWait = info; ui.lastPushAt = performance.now(); }

// Una carta vuela a su casilla de tu mano: desde el mazo (reparto, tu carta tras un push) o desde `fromRect`
// (las que te pasan con un push). Si `flip`, viaja boca abajo y se da vuelta al llegar.
function flyFromDeck(card, delay = 0, T = 1000, fromRect = null, flip = true) {
  const finish = () => { if (ui.arriving.delete(card.id)) cur.rerender(); };
  const deck = document.querySelector(".deck-back");
  const dest = document.querySelector(`#handLine [data-id="${card.id}"]`)?.getBoundingClientRect();
  if ((!deck && !fromRect) || !dest || reduceMotion()) return finish();
  const from = fromRect ?? deck.getBoundingClientRect();
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
  back.animate(flip ? [{ opacity: 1 }, { opacity: 1, offset: 0.62 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 0 }], { duration: T, delay, fill: "both" });
  face.animate(flip ? [{ opacity: 0 }, { opacity: 0, offset: 0.62 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 1 }], { duration: T, delay, fill: "both" })
    .finished.catch(() => {}).finally(() => { layer.remove(); finish(); });
}

// Reduce el tamaño de las cartas de la mesa hasta que TODOS los plantes quepan sin desplazarse.
function fitMesa() {
  const panel = document.querySelector(".mesa-panel");
  if (!panel) return;
  let s = 1.6;                                       // con pocos plantes, las cartas de la mesa se ven más grandes
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

// La cuadrícula de la mano se calcula con el ancho disponible: se mide tras dibujar y, si cambió, se redibuja.
function fitHand() {
  const line = document.getElementById("handLine");
  if (!line) return;
  const panel = document.querySelector(".hand-panel").getBoundingClientRect();
  document.documentElement.style.setProperty("--toast-bottom", `${Math.round(innerHeight - panel.top + 8)}px`); // avisos sobre tu mano
  // Ancho disponible para las casillas: el atril va centrado en la mesa entera sin pisar la columna de jugadores ni
  // el riel (se deja a cada lado lo que mida el más ancho), menos el marco del atril.
  const dock = document.querySelector(".hand-dock"), rack = document.querySelector(".hand-rack");
  const side = Math.max(document.querySelector(".players-col").offsetWidth, document.querySelector(".action-rail").offsetWidth) + 12;
  const w = Math.floor(dock.clientWidth - 2 * side - (rack.offsetWidth - line.clientWidth));
  if (Math.abs(w - ui.handW) > 2) { ui.handW = w; cur.rerender(); }
}
window.addEventListener("resize", () => requestAnimationFrame(() => cur && cur.rerender()));

// Lo que hacen los DEMÁS con el descarte: si lo toman, la carta vuela del descarte a su ficha; si descartan, vuela
// de su ficha al descarte (mientras tanto el descarte se ve vacío).
function detectRemoteDiscard(view) {
  const prev = ui.prevTurn;
  ui.prevTurn = { current: view.current, top: view.discardTop, round: view.round };
  if (!prev || prev.round !== view.round || view.phase !== "playing" || reduceMotion()) return;
  const slot = document.getElementById("unifiedSlot");
  const chipOf = (pid) => document.querySelector(`.p-chip[data-pid="${pid}"]`);
  if (!slot) return;
  const recentPush = performance.now() - ui.lastPushAt < 2500;
  // Otro jugador TOMÓ el descarte (no fue un push)
  if (prev.top && !view.discardTop && prev.current === view.current && view.current !== view.you && !recentPush) {
    const chip = chipOf(view.current);
    const sr = slot.getBoundingClientRect();
    if (chip) flyBetween(prev.top, sr, chip.getBoundingClientRect(), 650, sr);
    return;
  }
  // Otro jugador DESCARTÓ: hay una carta nueva en el descarte y el turno pasó
  if (view.discardTop && view.discardTop.id !== prev.top?.id && prev.current !== view.you && prev.current !== view.current) {
    const chip = chipOf(prev.current);
    if (!chip) return;
    // El descarte se ve VACÍO hasta que la carta llega (también si se redibuja mientras vuela).
    const sr = slot.getBoundingClientRect();
    const id = view.discardTop.id;
    ui.landing = id;
    slot.className = "unified-slot empty-wait idle";
    slot.replaceChildren(h("span", { class: "drop-icon" }, "…"));
    flyBetween(view.discardTop, chip.getBoundingClientRect(), sr, 650, sr)
      .finally(() => { if (ui.landing === id) { ui.landing = null; cur.rerender(); } });
  }
}
// Una carta boca arriba (del tamaño `size`, el del descarte) vuela de un rectángulo a otro. Junto a la ficha de un
// jugador se ve más pequeña y transparente.
function flyBetween(card, from, to, T, size) {
  const w = size.width, hgt = size.height;
  const el = h("div", { class: "fly-face fly-between", style: `width:${w}px;height:${hgt}px` }, faceEl(card));
  const layer = h("div", { class: "fly-layer" }, el);
  document.body.append(layer);
  const at = (r) => `translate(${r.left + r.width / 2 - w / 2}px,${r.top + r.height / 2 - hgt / 2}px) scale(${r === size ? 1 : 0.55})`;
  return el.animate([{ transform: at(from), opacity: from === size ? 1 : 0.5 }, { transform: at(to), opacity: to === size ? 1 : 0.3 }],
    { duration: T, easing: "cubic-bezier(.3,.7,.3,1)", fill: "forwards" }).finished.catch(() => {}).finally(() => layer.remove());
}

// Un plante COMPLETO (consecutivo de 3 a A) sale de la mesa: sus cartas se dan vuelta una por una (quedan
// boca abajo) y luego el grupo se desvanece. Mientras tanto la mesa le guarda su lugar (un hueco invisible del mismo
// tamaño): los demás plantes se reacomodan solo cuando desaparece.
export function noteCleared(list) {
  const shown = [...document.querySelectorAll(".mesa-panel .meld[data-meld], .mesa-panel .meld[data-clearing]")];
  for (const m of list) {
    const index = shown.findIndex((e) => Number(e.dataset.meld) === m.id);
    ui.clearing.set(m.id, { cards: m.cards, index: index < 0 ? Infinity : index, started: false });
  }
}
function startClearing() {
  let k = 0;
  for (const [id, c] of ui.clearing) {
    if (c.started) continue;
    c.started = true;
    const ph = document.querySelector(`.mesa-panel .meld[data-clearing="${id}"]`);
    if (!ph || reduceMotion()) { ui.clearing.delete(id); requestAnimationFrame(() => cur.rerender()); continue; }
    const r = ph.getBoundingClientRect();
    const mw = ph.querySelector(".card")?.getBoundingClientRect().width ?? 44;
    const slots = c.cards.map((card) => h("div", { class: "clear-slot" }, cardEl(card, "clear-face"), h("div", { class: "card clear-back" })));
    const row = h("div", { class: "clear-row", style: `--mw:${mw}px;left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px` }, slots);
    const layer = h("div", { class: "fly-layer" }, row);
    document.body.append(layer);
    const start = k++ * 400, step = Math.min(190, 1400 / c.cards.length), half = 200;
    slots.forEach((slot, i) => {
      const t = start + i * step;
      slot.firstChild.animate([{ transform: "rotateY(0deg)" }, { transform: "rotateY(90deg)" }], { duration: half, delay: t, easing: "ease-in", fill: "both" });
      slot.lastChild.animate([{ transform: "rotateY(-90deg)" }, { transform: "rotateY(0deg)" }], { duration: half, delay: t + half, easing: "ease-out", fill: "both" });
    });
    const flipped = start + (c.cards.length - 1) * step + 2 * half;   // todas boca abajo: un momento quietas y se apagan
    row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 800, delay: flipped + 450, easing: "ease-in", fill: "both" })
      .finished.catch(() => {}).finally(() => {
        layer.remove();
        ui.clearing.delete(id);
        cur.rerender();                                // recién ahora los demás plantes ocupan su lugar (deslizándose)
      });
  }
}

// Posición de cada plante de la mesa (por id).
// (esquina y ancho de su primera carta: el ancho del plante cambia también al enganchar, el de la carta no)
function meldRects() {
  return new Map([...document.querySelectorAll(".mesa-panel .meld[data-meld]")].map((e) => {
    const r = e.getBoundingClientRect();
    return [e.dataset.meld, { left: r.left, top: r.top, cw: e.querySelector(".card")?.getBoundingClientRect().width ?? 0 }];
  }));
}
// Tras redibujar, cada plante que cambió de lugar o de tamaño (la mesa achica las cartas para dar espacio a las nuevas,
// o las agranda cuando salen) viaja suave desde como se veía hasta como queda.
const SLIDE_MS = 520;
function slideMelds(before) {
  if (reduceMotion()) return;
  for (const el of document.querySelectorAll(".mesa-panel .meld[data-meld]")) {
    const old = before.get(el.dataset.meld);
    if (!old) continue;
    const now = el.getBoundingClientRect(), cw = el.querySelector(".card")?.getBoundingClientRect().width ?? 0;
    const dx = old.left - now.left, dy = old.top - now.top, sc = cw && old.cw ? old.cw / cw : 1;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sc - 1) < 0.01) continue;
    el.animate([{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sc})` },
                { transformOrigin: "0 0", transform: "none" }], { duration: SLIDE_MS, easing: "cubic-bezier(.3,.7,.3,1)" });
  }
}

// Lo que armas sin confirmar lo ven los demás en vivo: se envía cada vez que cambia (solo en tu fase 'main').
function sendLive(active) {
  if (!active) { ui.liveSent = null; return; }
  const stage = {
    groups: ui.stage.groups.map((g) => ({ cardIds: g.cards.map((c) => c.id) })),
    hooks: ui.stage.hooks.map((x) => ({ meldId: x.meldId, cardId: x.card.id, ...(x.end && { end: x.end }) })),
  };
  const key = JSON.stringify(stage);
  if (key === ui.liveSent || !cur.room?.send) return;
  ui.liveSent = key;
  actions.stage(cur.room, stage);
}

export function notePlay(by) { ui.remotePlay = { by, at: performance.now() }; }
// Otro jugador acaba de plantarse / bajar / enganchar: sus cartas nuevas aparecen de translúcidas a sólidas.
function detectRemotePlay(view) {
  const ids = [...document.querySelectorAll(".mesa-panel .card[data-id]")].map((e) => e.dataset.id);
  if (ui.remotePlay && performance.now() - ui.remotePlay.at > 6000) ui.remotePlay = null;
  if (ui.remotePlay) {
    const fresh = ids.filter((id) => !ui.prevMesa.has(id) && !ui.flights.has(id));
    if (fresh.length) {
      for (const id of fresh) ui.flights.set(id, { at: performance.now() });   // aparecen de translúcidas a sólidas
      ui.remotePlay = null;
    }
  }
  ui.prevMesa = new Set(ids);
}
