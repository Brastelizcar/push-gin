// Tutorial: una ronda de práctica local con un reparto preparado y un "entrenador" que explica cada paso. Empieza
// solo después de crear la cuenta (y se puede repetir desde Ajustes). Se sale con «Saltar» (barra de la mesa).
//
// El reparto garantiza el recorrido en 3 turnos tuyos:
//  1) Rosa ya está plantada (3 tríos en la mesa) y su trío de 5 lleva un comodín: lo ROBAS con tu 5♠ (al empezar el
//     turno), tomas el 9♦ del descarte y descartas la K♠. Como robaste, ese turno no te puedes plantar.
//  2) Haces PUSH y te plantas con 7♥ 7♠ 7♦, Q♦ Q♣ + el comodín robado y 9♣ 9♥ 9♦; descartas la carta que robaste
//     del mazo y te queda el 7♣.
//  3) Tomas el descarte, ENGANCHAS el 7♣ en tu trío de 7 y descartas tu última carta: ganas la ronda.
// Los bots no hacen push (startPractice con noPush: no te pasan cartas); Rosa tiene una carta que no encaja en ningún
// plante y Tomás no tiene Q (no puede robarte el comodín) ni puede juntar 3 tríos. Los pasos avanzan solos según lo
// que pasa en la mesa (`nextStep`).
import { h } from "./dom.js";
import { t } from "./i18n.js";
import { cardEl, richText } from "./cardview.js";
import { makeDeck, shuffle } from "../../src/logic/cards.js";
import { buildSet, extendMeld } from "../../src/logic/melds.js";
import { HAND_SIZE } from "../../src/logic/game.js";

export const TUTORIAL_HAND = ["7♥", "7♠", "7♦", "Q♦", "Q♣", "5♠", "K♠", "7♣", "9♣", "9♥"];
const ROSA_MELDS = [["5♥", "5♣", "2♦"], ["8♠", "8♥", "8♦"], ["J♣", "J♦", "J♠"]];   // Rosa ya se plantó
const ROSA_HAND = ["3♣"];                                                         // 9 en la mesa + 1 = 10
const TOMAS_HAND = ["A♣", "A♦", "6♦", "6♠", "10♦", "10♠", "K♣", "K♦", "9♠", "4♠"];
const DISCARD = "9♦";
const DECK_TOP = ["4♥", "6♣", "10♥", "3♥", "A♥", "6♥", "4♦", "3♠", "10♣", "A♠"]; // las próximas cartas del mazo

// Prepara el reparto de la ronda 1 (se pasa como `setup` a startPractice). Usa cartas de verdad de la baraja (ids
// únicos) y deja el mazo con la misma cantidad de cartas que un reparto normal (así el reparto se anima igual).
export function tutorialSetup(match) {
  const g = match.game;
  const pool = shuffle(makeDeck(3));
  const take = (s) => pool.splice(pool.findIndex((c) => c.rank + c.suit === s), 1)[0];
  const [me, rosa, tomas] = g.players;
  g.hands[me] = TUTORIAL_HAND.map(take);
  g.hands[rosa] = ROSA_HAND.map(take);
  g.melds = ROSA_MELDS.map((cards, i) => ({ id: i + 1, owner: rosa, meld: buildSet(cards.map(take)) }));
  g.nextMeldId = ROSA_MELDS.length + 1;
  g.planted[rosa] = true;
  if (tomas) g.hands[tomas] = TOMAS_HAND.map(take);
  g.discardTop = take(DISCARD);
  const top = DECK_TOP.map(take);
  const deckSize = 156 - HAND_SIZE * g.players.length - 1;
  g.deck = [...pool.slice(0, deckSize - top.length), ...top.reverse()];   // pop() saca primero DECK_TOP[0]
  g.turnIndex = 0;                                // empiezas tú
}

// ---------- el entrenador ----------
const PATH = ["intro", "goal", "wild", "steal", "take", "endturn", "wait", "push", "stage", "discard", "planted", "hook", "won", "tips"];
let step = "intro";
let shown = null;                 // último paso dibujado (la entrada animada solo al cambiar de paso)
export const resetTutorial = () => { step = "intro"; shown = null; };
export const tutorialStep = () => step;

const cardName = (c) => c.rank + c.suit;

// En cada paso SOLO se puede hacer lo que pide el entrenador (si no, el recorrido ya no se podría terminar). La mesa
// pregunta antes de cada acción: tutorialLock(acción, { card, cards, view, stage }) devuelve null si se permite, o el
// aviso que explica qué hacer. Acciones: take, push, steal, group, addToGroup, hook, discard, confirm, sort. Mover
// cartas dentro de tu mano siempre se puede. Al jugar libre ("free") no hay bloqueos.
const TRIOS = [["7♥", "7♠", "7♦"], ["Q♦", "Q♣", "2"], ["9♣", "9♥", "9♦"]];   // "2": el comodín robado (cualquier palo)
const isTrio = (cards) => TRIOS.some((trio) => {
  const left = cards.map(cardName);
  return trio.length === left.length && trio.every((want) => {
    const i = left.findIndex((n) => (want === "2" ? n.startsWith("2") : n === want));
    return i >= 0 && left.splice(i, 1);
  });
});

function hint(at, view, stage) {
  const drawn = view?.hand.find((c) => c.id === view.drawn);
  switch (at) {
    case "steal": return t("Primero roba el comodín: arrastra tu 5♠ y suéltalo sobre la P del trío de 5 de Rosa");
    case "take": return t("En este paso toma el 9♦ del descarte: lo necesitas para tu trío de 9");
    case "endturn": return t("Arrastra la K♠ al descarte y pulsa ✓ Terminar turno");
    case "wait": case "planted": return t("Espera tu turno: ahora juegan los demás");
    case "push": return t("En este paso pulsa Push");
    case "stage": return t("Lleva a la mesa solo tus tres tríos: 7♥ 7♠ 7♦, Q♦ Q♣ con el comodín y 9♣ 9♥ 9♦");
    case "discard": return drawn ? t("Arrastra al descarte la carta que robaste del mazo ({card}) y pulsa ✓", { card: cardName(drawn) })
      : t("Arrastra una carta al descarte y pulsa ✓");
    case "hook":
      if (view?.turnPhase === "start") return t("Toma una carta: toca el descarte o haz push");
      return stage?.hooks?.some((h) => cardName(h.card) === "7♣") ? t("Ahora arrastra tu última carta al descarte y pulsa ✓")
        : t("Primero engancha tu 7♣: arrástralo sobre tu trío de 7");
    default: return t("Primero lee la explicación y pulsa «Siguiente»");
  }
}

export function tutorialLock(action, { card, cards, view, stage } = {}, at = step) {
  if (at === "free") return null;
  let ok = false;
  switch (at) {
    case "steal": ok = action === "steal" && cardName(card) === "5♠"; break;
    case "take": ok = action === "take"; break;
    case "endturn": ok = (action === "discard" && cardName(card) === "K♠") || action === "confirm"; break;
    case "push": ok = action === "push"; break;
    case "stage": ok = action === "group" && isTrio(cards); break;
    case "discard": ok = (action === "discard" && card.id === view?.drawn) || action === "confirm"; break;
    case "hook":
      if (view?.turnPhase === "start") ok = action === "take" || action === "push";
      else if (action === "hook") ok = cards.length === 1 && cardName(cards[0]) === "7♣";
      else if (action === "discard") ok = !!stage?.hooks?.some((h) => cardName(h.card) === "7♣") && cardName(card) !== "7♣";
      else ok = action === "confirm";
      break;
  }
  return ok ? null : hint(at, view, stage);
}

// Siguiente paso según la vista y tu jugada sin confirmar (stage = stageInfo() de la mesa). Función pura.
// Los pasos con botón «Siguiente» (intro, goal, wild, won, over) solo avanzan con el botón.
export function nextStep(step, view, stage = { groups: 0 }) {
  const myTurn = view.phase === "playing" && view.current === view.you;
  const planted = !!view.players.find((p) => p.id === view.you)?.planted;
  const main = myTurn && view.turnPhase === "main", start = myTurn && view.turnPhase === "start";
  if (view.phase === "roundOver" || view.phase === "finished")
    return ["won", "over", "tips"].includes(step) ? step : view.winner === view.you ? "won" : "over";
  if (step === "steal") {
    if (view.stoleThisTurn) step = "take";
    else if (main) step = "stage";                 // tomó carta sin robar: sigue sin el robo
  }
  if (step === "take" && main) step = view.stoleThisTurn ? "endturn" : "stage";
  if (step === "endturn" && !myTurn) step = "wait";
  if (step === "wait" && start) step = "push";
  if (step === "push" && main) step = planted ? "hook" : "stage";
  if (step === "stage") {
    if (planted) step = "planted";
    else if (stage.groups >= 3) step = "discard";
    else if (!myTurn) step = "free";
  } else if (step === "discard") {
    if (planted) step = "planted";
    else if (!myTurn) step = "free";
    else if (stage.groups < 3) step = "stage";
  }
  if (step === "planted" && start) step = "hook";
  return step;
}

// Una carta de tu mano que se puede enganchar en algún plante de la mesa (para nombrarla en el paso "hook").
function hookable(view) {
  for (const c of view.hand)
    if (view.melds.some((e) => extendMeld(e.meld, c, "high") || extendMeld(e.meld, c, "low"))) return c;
  return null;
}
const POINTS = () => t("Las cartas que les quedaron a los demás suman puntos en contra: A = 15 · 2 = 20 · 10, J, Q, K = 10 · 3 a 9 = 5. Gana la partida quien sume menos al final de las 5 rondas.");

// El 2 de antes → el comodín de ahora (la misma carta), con una flecha.
function wildPicture() {
  const two = { id: "tut-2", rank: "2", suit: "♠" };
  return h("div", { class: "coach-cards" },
    h("div", { class: "coach-card" }, cardEl(two, "", undefined, true), h("span", {}, "2")),
    h("span", { class: "coach-arrow", "aria-hidden": "true" }, "➜"),
    h("div", { class: "coach-card" }, cardEl(two), h("span", {}, t("comodín"))));
}

function content(view) {
  const next = (to) => ({ label: t("Siguiente"), go: () => { step = to; } });
  const drawn = view.hand.find((c) => c.id === view.drawn);
  switch (step) {
    case "intro": return { title: t("¡Bienvenido a Push Gin!"), next: next("goal"), body: [
      t("El objetivo es quedarte sin cartas. Se juegan 5 rondas: al terminar cada una, las cartas que te quedan en la mano suman puntos en contra."),
      t("Gana quien sume MENOS puntos al final. Vamos a jugar una ronda juntos.")] };
    case "goal": return { title: t("Plantarte"), next: next("wild"), body: [
      t("Para bajar cartas a la mesa primero tienes que plantarte con lo que pide la ronda (arriba, junto a «Plantarte»)."),
      t("En la ronda 1 son 3 tríos: tres grupos de cartas del mismo número, de cualquier palo. Es el mínimo: un grupo puede tener más cartas.")] };
    case "wild": return { title: t("El comodín"), next: next("steal"), picture: wildPicture(), body: [
      t("El 2 es el comodín y en el juego se ve así: una P con los 4 palos, del color de su palo."),
      t("Reemplaza cualquier carta: en un trío vale ese número y en un consecutivo, el lugar donde lo pones.")] };
    case "steal": return { title: t("Roba el comodín"), body: [
      t("Rosa ya se plantó, y en su trío de 5 usó un comodín (la P)."),
      t("Mientras no te hayas plantado, al EMPEZAR tu turno puedes robar un comodín de un jugador plantado: arrastra tu 5♠ y suéltalo sobre la P. El comodín pasa a tu mano."),
      t("Puedes robar todos los comodines que quieras en ese mismo turno, de uno o varios plantes, siempre que tengas la carta que va en el lugar de cada uno."),
      t("Ojo: el turno en que robas no te puedes plantar.")] };
    case "take": return { title: t("Toma una carta"), body: [
      t("Ahora toma una carta. El 9♦ del descarte te sirve (ya tienes dos 9): tócalo o arrástralo a tu mano."),
      t("Si el descarte no te sirve, usa Push: el descarte y una carta del mazo se van a la mano del siguiente jugador y tú robas una del mazo.")] };
    case "endturn": return { title: t("Termina el turno"), body: [
      t("Como robaste un comodín, este turno no te puedes plantar. Arrastra la K♠ al descarte y pulsa ✓ Terminar turno.")] };
    case "wait": return { title: t("Turno de los demás"), body: [
      t("Ahora juegan Rosa y Tomás. Mira cómo toman el descarte y descartan; en tu próximo turno te plantas.")] };
    case "push": return { title: t("Haz push"), body: [
      t("Prueba la otra forma de tomar carta: pulsa Push. El descarte y una carta del mazo, boca abajo, se van a la mano del siguiente jugador, y tú robas una carta del mazo.")] };
    case "stage": return { title: t("Arma tus tríos"), body: [
      t("Mantén presionada la primera o la última carta de un grupo de cartas juntas y arrástralo a la mesa."),
      t("Tus tríos: 7♥ 7♠ 7♦, Q♦ Q♣ con el comodín que robaste (aquí vale una Q) y 9♣ 9♥ 9♦."),
      t("Si te equivocas, toca el grupo en la mesa y vuelve a tu mano.")] };
    case "discard": return { title: t("Termina el turno"), body: [
      drawn ? t("Ya tienes tus 3 tríos en la mesa. Arrastra al descarte la carta que robaste del mazo ({card}) y pulsa ✓ Terminar turno.", { card: cardName(drawn) })
        : t("Ya tienes tus 3 tríos en la mesa. Arrastra una carta al descarte y pulsa ✓ Terminar turno."),
      t("Guarda el 7♣: lo vas a usar en tu próximo turno.")] };
    case "planted": return { title: t("¡Te plantaste!"), body: [
      t("Ahora juegan los demás. Desde tu próximo turno puedes bajar más grupos o enganchar cartas en cualquier plante de la mesa, tuyo o de otro jugador."),
      t("En el turno en que te plantas no se engancha.")] };
    case "hook": {
      if (view.turnPhase === "start") return { title: t("Engancha y gana la ronda"), body: [
        t("Primero toma una carta: toca el descarte (o haz push).")] };
      const c = hookable(view);
      return { title: t("Engancha y gana la ronda"), body: c
        ? [t("Arrastra tu {card} sobre el plante donde encaja para engancharlo.", { card: cardName(c) }),
           t("Después arrastra tu última carta al descarte y pulsa ✓: quien descarta su última carta gana la ronda.")]
        : [t("Arrastra una carta al descarte y pulsa ✓. Quien descarta su última carta gana la ronda.")] };
    }
    case "won": return { title: t("¡Ganaste la ronda!"), center: true, next: next("tips"), body: [POINTS(), t("En cada ronda cambia lo que se pide para plantarte.")] };
    case "over": return { title: t("Terminó la ronda"), center: true, next: next("tips"), body: [POINTS(), t("En cada ronda cambia lo que se pide para plantarte.")] };
    case "tips": return { title: t("Últimos consejos"), center: true, finish: true, body: [
      t("Consecutivo: cartas seguidas del mismo palo, en orden A, K, Q … 3. El comodín (P) puede ocupar cualquier lugar."),
      t("Robo del comodín: al empezar tu turno, antes de tomar carta y mientras no te hayas plantado, puedes robar todos los que quieras de jugadores ya plantados, siempre que tengas la carta que va en su lugar."),
      t("Las reglas completas están en el botón ? del menú de inicio. ¡Buena suerte!")] };
    default: return { title: t("Sigue jugando"), body: [
      t("Juega a tu ritmo: cuando tengas lo que pide la ronda, plántate. Puedes salir cuando quieras con «Saltar».")] };
  }
}

// Pone la ventana del entrenador en el espacio libre del tablero para no tapar cartas: a la derecha de una fila de
// plantes (la de más arriba donde quepa, sin pisar las filas de abajo) o, si no hay lugar, debajo de todos. Nunca
// baja hasta los avisos que van sobre tu mano. Se llama después de agregarla a la página.
export function placeCoach(el) {
  const mesa = document.querySelector(".mesa-panel")?.getBoundingClientRect();
  if (!mesa) return;
  const pad = 16;
  const limit = (document.querySelector(".hand-actions")?.getBoundingClientRect().top ?? mesa.bottom) - 8;
  const melds = [...document.querySelectorAll(".mesa-panel .meld")].map((m) => m.getBoundingClientRect());
  const rows = [];                                          // filas de plantes: { top, bottom, right }
  for (const r of melds.sort((x, y) => x.top - y.top)) {
    const row = rows.find((w) => Math.abs(w.top - r.top) < 12);
    if (row) { row.right = Math.max(row.right, r.right); row.bottom = Math.max(row.bottom, r.bottom); }
    else rows.push({ top: r.top, bottom: r.bottom, right: r.right });
  }
  el.classList.add("placed");
  const put = (left, top, w) => { el.style.width = `${w}px`; el.style.left = `${left}px`; el.style.top = `${top}px`; return true; };
  const heightAt = (w) => { el.style.width = `${w}px`; return el.offsetHeight; };
  const below = rows.length ? Math.max(...rows.map((r) => r.bottom)) + pad : mesa.top + 30;
  const wide = Math.min(640, mesa.width - 2 * pad);        // debajo de los plantes va más ancha: ocupa menos alto
  const fits = () => {
    for (let i = 0; i < rows.length; i++) {                 // a la derecha de la fila i (y de todas las de abajo)
      const x0 = Math.max(...rows.slice(i).map((w) => w.right)) + pad;
      const room = mesa.right - pad - x0;
      if (room < 300) continue;
      const w = Math.min(520, room);
      if (rows[i].top + heightAt(w) <= limit) return put(x0 + (room - w) / 2, rows[i].top, w);
    }
    if (below + heightAt(wide) <= limit) return put(mesa.left + (mesa.width - wide) / 2, below, wide);
    return false;
  };
  if (fits()) return;
  el.classList.add("compact");                              // no cabe: letra y márgenes un poco más chicos
  if (fits()) return;
  put(mesa.left + (mesa.width - wide) / 2, Math.max(mesa.top, Math.min(below, limit - heightAt(wide))), wide);
}

// Ventana del entrenador. Devuelve { el, center } (center: pasos de fin de ronda; reemplaza a la tabla de puntos).
export function coach(view, stage, { onFinish, rerender }) {
  step = nextStep(step, view, stage);
  const c = content(view);
  const n = PATH.indexOf(step === "over" ? "won" : step);
  const fresh = shown !== step;
  shown = step;
  const el = h("div", { class: "coach" + (c.center ? " center" : "") + (fresh ? " enter" : ""), role: "status" },
    n >= 0 ? h("div", { class: "coach-step" }, t("Tutorial · {n} de {total}", { n: n + 1, total: PATH.length })) : null,
    h("h3", {}, c.title),
    c.picture ?? null,
    c.body.map((p) => h("p", {}, richText(p))),
    c.next ? h("button", { class: "coach-btn", onclick: () => { c.next.go(); rerender(); } }, c.next.label) : null,
    c.finish ? h("button", { class: "coach-btn", onclick: onFinish }, t("Terminar tutorial")) : null);
  return { el, center: !!c.center };
}
