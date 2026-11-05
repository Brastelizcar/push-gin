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
