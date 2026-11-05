// Cómo se dibuja una carta (mano, mesa, descarte, animaciones y tutorial). Sin CSS propio: lo pone table.css.
import { h } from "./dom.js";
import { t } from "./i18n.js";
import { suitColor } from "./format.js";

// El 2 (comodín): una P grande y los 4 palos en las esquinas (ref. docs/referencias/Comodin.png), del color de su palo.
const WILD_CORNERS = [["tl", "♥"], ["tr", "♣"], ["bl", "♦"], ["br", "♠"]];
const wildCorners = () => WILD_CORNERS.map(([pos, s]) => h("span", { class: "wc " + pos }, s));

// plain: el 2 se dibuja como una carta normal (solo para mostrar en el tutorial cómo se veía antes).
export function cardEl(c, extra = "", idx, plain = false) {
  const attrs = { "data-id": c.id, ...(idx !== undefined ? { "data-idx": idx } : {}) };
  if (c.rank === "2" && !plain) return h("div", { class: `card ${suitColor(c.suit)} wild-card ${extra}`, ...attrs, title: t("Comodín (2)") }, wildCorners(), h("div", { class: "pip" }, "P"));
  return h("div", { class: `card ${suitColor(c.suit)} ${extra}`, ...attrs },
    h("div", { class: "corner" }, c.suit),            // palo pequeño arriba a la izquierda
    h("div", { class: "pip" }, c.rank));              // número grande al centro
}
// Cara de la carta del descarte (y de la animación del push): igual que las demás, palo pequeño y número grande.
export function faceEl(c) {
  if (c.rank === "2") return h("div", { class: `face ${suitColor(c.suit)} wild-face` }, wildCorners(), h("div", { class: "f-rank" }, "P"));
  return h("div", { class: "face " + suitColor(c.suit) },
    h("div", { class: "f-suit" }, c.suit),
    h("div", { class: "f-rank" }, c.rank));
}

// Texto con cartas: cada "7♣", "K♠", "10♥"… se dibuja como una carta pequeña dentro del renglón (el 2, como el
// comodín), y una "P" suelta como la carta comodín (la del tutorial es un 2♦). Devuelve un <span>.
const CARD_IN_TEXT = /(10|[2-9AJQK])([♠♥♦♣])|(?<![\p{L}\d])(P)(?![\p{L}\d])/gu;
export function richText(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(CARD_IN_TEXT)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(cardEl(m[3] ? { id: "", rank: "2", suit: "♦" } : { id: "", rank: m[1], suit: m[2] }, "inline"));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return h("span", { class: "rich" }, parts);
}
