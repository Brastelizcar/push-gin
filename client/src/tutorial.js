// Tutorial: una ronda de práctica local con un reparto preparado y un "entrenador" que explica cada paso. Empieza
// solo después de crear la cuenta (y se puede repetir desde Ajustes). Se sale con «Saltar» (barra de la mesa).
//
// El reparto garantiza el recorrido: con el 9♦ del descarte completas tus 9; te plantas con 7♥ 7♠ 7♦, Q♦ Q♣ 2♠ y
// 9♣ 9♥ 9♦; descartas la K♠ y te queda el 7♣, que en tu siguiente turno enganchas en el trío de 7 para descartar tu
// última carta y ganar la ronda. Los bots reciben manos sin pares útiles (no se plantan antes que tú), sin Q (no
// pueden robarte el 2) y no hacen push (startPractice con noPush: no te pasan cartas). Los pasos avanzan solos según lo que pasa en la mesa (`nextStep`).
import { h } from "./dom.js";
import { t } from "./i18n.js";
import { makeDeck, shuffle } from "../../src/logic/cards.js";
import { extendMeld } from "../../src/logic/melds.js";

export const TUTORIAL_HAND = ["7♥", "7♠", "7♦", "Q♦", "Q♣", "2♠", "K♠", "7♣", "9♣", "9♥"];
const BOT_HANDS = [
  ["3♣", "4♠", "5♦", "6♠", "8♥", "10♣", "J♦", "K♦", "A♠", "9♠"],
  ["3♥", "4♦", "5♣", "6♦", "8♠", "10♦", "J♥", "K♣", "A♣", "7♠"],
];
const DISCARD = "9♦";
const DECK_TOP = ["4♥", "6♣", "8♦", "J♣", "3♦", "5♠", "10♥", "A♦", "6♥", "5♥"]; // las próximas cartas del mazo

// Prepara el reparto de la ronda 1 (se pasa como `setup` a startPractice). Usa cartas de verdad de la baraja (ids
// únicos) y deja el mazo con la misma cantidad de cartas que un reparto normal.
export function tutorialSetup(match) {
  const g = match.game;
  const pool = shuffle(makeDeck(3));
  const take = (s) => pool.splice(pool.findIndex((c) => c.rank + c.suit === s), 1)[0];
  const [me, ...bots] = g.players;
  g.hands[me] = TUTORIAL_HAND.map(take);
  bots.forEach((b, i) => (g.hands[b] = (BOT_HANDS[i] ?? BOT_HANDS[0]).map(take)));
  g.discardTop = take(DISCARD);
  const top = DECK_TOP.map(take);
  g.deck = [...pool, ...top.reverse()];           // pop() saca primero DECK_TOP[0]
  g.turnIndex = 0;                                // empiezas tú
}

// ---------- el entrenador ----------
const PATH = ["intro", "goal", "take", "stage", "discard", "planted", "push", "hook", "won", "tips"];
let step = "intro";
let shown = null;                 // último paso dibujado (la entrada animada solo al cambiar de paso)
export const resetTutorial = () => { step = "intro"; shown = null; };
export const tutorialStep = () => step;

// Siguiente paso según la vista y tu jugada sin confirmar (stage = stageInfo() de la mesa). Función pura.
// Los pasos con botón «Siguiente» (intro, goal, won, over) solo avanzan con el botón.
export function nextStep(step, view, stage = { groups: 0 }) {
  const myTurn = view.phase === "playing" && view.current === view.you;
  const planted = !!view.players.find((p) => p.id === view.you)?.planted;
  if (view.phase === "roundOver" || view.phase === "finished")
    return ["won", "over", "tips"].includes(step) ? step : view.winner === view.you ? "won" : "over";
  if (step === "take" && myTurn && view.turnPhase === "main") step = "stage";
  if (step === "stage") {
    if (planted) step = "planted";
    else if (stage.groups >= 3) step = "discard";
    else if (!myTurn) step = "free";
  } else if (step === "discard") {
    if (planted) step = "planted";
    else if (!myTurn) step = "free";
    else if (stage.groups < 3) step = "stage";
  }
  if (step === "planted" && myTurn && view.turnPhase === "start") step = "push";
  if (step === "push" && myTurn && view.turnPhase === "main") step = "hook";
  if (step === "hook" && !myTurn) step = "free";
  return step;
}

// Una carta de tu mano que se puede enganchar en algún plante de la mesa (para nombrarla en el paso "hook").
function hookable(view) {
  for (const c of view.hand)
    if (view.melds.some((e) => extendMeld(e.meld, c, "high") || extendMeld(e.meld, c, "low"))) return c;
  return null;
}
const cardName = (c) => c.rank + c.suit;
const POINTS = () => t("Las cartas que les quedaron a los demás suman puntos en contra: A = 15 · 2 = 20 · 10, J, Q, K = 10 · 3 a 9 = 5. Gana la partida quien sume menos al final de las 5 rondas.");

function content(view) {
  const next = (to) => ({ label: t("Siguiente"), go: () => { step = to; } });
  switch (step) {
    case "intro": return { title: t("¡Bienvenido a Push Gin!"), center: true, next: next("goal"), body: [
      t("El objetivo es quedarte sin cartas. Se juegan 5 rondas: al terminar cada una, las cartas que te quedan en la mano suman puntos en contra."),
      t("Gana quien sume MENOS puntos al final. Vamos a jugar una ronda juntos.")] };
    case "goal": return { title: t("Plantarte"), next: next("take"), body: [
      t("Para bajar cartas a la mesa primero tienes que plantarte con lo que pide la ronda (arriba, junto a «Plantarte»)."),
      t("En la ronda 1 son 3 tríos: tres grupos de cartas del mismo número, de cualquier palo. Es el mínimo: un grupo puede tener más cartas.")] };
    case "take": return { title: t("Toma una carta"), body: [
      t("Cada turno empieza tomando una carta. El 9♦ del descarte te sirve (ya tienes dos 9): tócalo o arrástralo a tu mano."),
      t("Si el descarte no te sirve, usa Push: el descarte y una carta del mazo se van a la mano del siguiente jugador y tú robas una del mazo.")] };
    case "stage": return { title: t("Arma tus tríos"), body: [
      t("Mantén presionada la primera o la última carta de un grupo de cartas juntas y arrástralo a la mesa."),
      t("Tus tríos: 7♥ 7♠ 7♦, Q♦ Q♣ y la P (la P es el 2, el comodín: aquí vale una Q) y 9♣ 9♥ 9♦ (el 9♦ quedó al empezar la fila de abajo, justo después de los otros dos)."),
      t("Si te equivocas, toca el grupo en la mesa y vuelve a tu mano.")] };
    case "discard": return { title: t("Termina el turno"), body: [
      t("Ya tienes tus 3 tríos en la mesa. Arrastra la K♠ al descarte y pulsa ✓ Terminar turno."),
      t("Guarda el 7♣: lo vas a usar en tu próximo turno.")] };
    case "planted": return { title: t("¡Te plantaste!"), body: [
      t("Ahora juegan los demás. Desde tu próximo turno puedes bajar más grupos o enganchar cartas en cualquier plante de la mesa, tuyo o de otro jugador."),
      t("En el turno en que te plantas no se engancha.")] };
    case "push": return { title: t("Haz push"), body: [
      t("Prueba la otra forma de tomar carta: pulsa Push. El descarte y una carta del mazo, boca abajo, se van a la mano del siguiente jugador, y tú robas una carta del mazo.")] };
    case "hook": {
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
      t("Robo del 2: antes de tomar carta, si aún no te plantaste, puedes cambiar un 2 de un plante ajeno por la carta que va en su lugar."),
      t("Las reglas completas están en el botón ? del menú de inicio. ¡Buena suerte!")] };
    default: return { title: t("Sigue jugando"), body: [
      t("Juega a tu ritmo: cuando tengas lo que pide la ronda, plántate. Puedes salir cuando quieras con «Saltar».")] };
  }
}

// Ventana del entrenador. Devuelve { el, center } (center: va en medio de la pantalla y tapa la tabla de fin de ronda).
export function coach(view, stage, { onFinish, rerender }) {
  step = nextStep(step, view, stage);
  const c = content(view);
  const n = PATH.indexOf(step === "over" ? "won" : step);
  const fresh = shown !== step;
  shown = step;
  const el = h("div", { class: "coach" + (c.center ? " center" : "") + (fresh ? " enter" : ""), role: "status" },
    n >= 0 ? h("div", { class: "coach-step" }, t("Tutorial · {n} de {total}", { n: n + 1, total: PATH.length })) : null,
    h("h3", {}, c.title),
    c.body.map((p) => h("p", {}, p)),
    c.next ? h("button", { class: "coach-btn", onclick: () => { c.next.go(); rerender(); } }, c.next.label) : null,
    c.finish ? h("button", { class: "coach-btn", onclick: onFinish }, t("Terminar tutorial")) : null);
  return { el, center: !!c.center };
}
