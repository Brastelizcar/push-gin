// Jugada en preparación (Lote 2). Funciones puras: se prueban sin navegador.
// Durante tu turno (fase 'main') armas la jugada en local: grupos que sueltas en la mesa, cartas que enganchas
// y la carta del descarte. Nada llega al servidor hasta pulsar ✓; entonces viaja todo junto (playTurn).
import { buildSet, buildRun, extendMeld } from "../../src/logic/melds.js";
import { rankValues } from "../../src/logic/cards.js";
import { splitTurnGroups } from "../../src/logic/plan.js";
import { resolveTurn } from "../../src/logic/turn.js";

// ¿Estas cartas (en este orden) forman un plante? Primero respeta el orden (el 2 vale por su posición).
// Devuelve { ordered } o null.
export function meldShape(cards) {
  if (cards.length < 3) return null;
  if (cards.length <= 4 && buildSet(cards)) return { ordered: false };
  if (buildRun(cards, { ordered: true })) return { ordered: true };
  if (buildRun(cards)) return { ordered: false };
  return null;
}

// ¿Dos cartas que van juntas? Un DÚO (mismo número) o un consecutivo de 2 (mismo palo, números seguidos; aquí el 2
// cuenta como número). Sirve para tomarlas juntas de la mano. Devuelve { ordered } o null.
export function pairShape(cards) {
  if (cards.length !== 2) return null;
  const [a, b] = cards;
  if (a.rank === b.rank) return { ordered: false };
  if (a.suit === b.suit && Math.abs(rankValues(a.rank)[0] - rankValues(b.rank)[0]) === 1) return { ordered: true };
  return null;
}

// Tramos de la mano separados por espacios: items [{card}|{gap}] → [[card, ...], ...].
export function handSegments(items) {
  const out = [[]];
  for (const it of items) it.gap ? out.push([]) : out.at(-1).push(it.card);
  return out.filter((s) => s.length);
}

// Grupo que se toma al MANTENER PRESIONADA la carta `id`: el plante más largo formado por cartas JUNTAS de la mano
// (sin espacios en medio) que empieza o termina en esa carta. Si hay empate, gana el que empieza en ella.
// Si no hay plante de 3 o más, sirve un dúo o un consecutivo de 2 (pairShape).
// items: [{card}|{gap}] en el orden de la mano. Devuelve { cards, ordered } o null.
export function groupAt(items, id) {
  for (const seg of handSegments(items)) {
    const i = seg.findIndex((c) => c.id === id);
    if (i < 0) continue;
    // El más largo de 2 a 13 cartas: hacia la derecha (empieza en la carta) o hacia la izquierda (termina en ella).
    const longest = (maxLen, slice) => {
      for (let len = Math.min(13, maxLen); len >= 2; len--) {
        const cards = slice(len), shape = len >= 3 ? meldShape(cards) : pairShape(cards);
        if (shape) return { cards, ordered: shape.ordered };
      }
      return null;
    };
    const fwd = longest(seg.length - i, (len) => seg.slice(i, i + len));
    const back = longest(i + 1, (len) => seg.slice(i + 1 - len, i + 1));
    if (!fwd) return back;
    return back && back.cards.length > fwd.cards.length ? back : fwd;
  }
  return null;
}

export const emptyStage = () => ({ groups: [], hooks: [] });
export const stagedIds = (st) => new Set([...st.groups.flatMap((g) => g.cards.map((c) => c.id)), ...st.hooks.map((h) => h.card.id)]);

// Plantes de la mesa con los enganches preparados ya aplicados (para mostrarlos). Si alguno dejó de encajar, se omite.
export function previewMelds(melds, hooks) {
  const out = melds.map((e) => ({ ...e }));
  for (const h of hooks) {
    const e = out.find((m) => m.id === h.meldId);
    const next = e && extendMeld(e.meld, h.card, h.end);
    if (next) e.meld = next;
  }
  return out;
}

// Añade una carta a un grupo preparado (al final o al principio, lo que encaje). Devuelve el grupo nuevo o null.
export function addToGroup(group, card) {
  const tries = [[...group.cards, card], [card, ...group.cards]];
  for (const cards of tries) {
    if (cards.length <= 4 && buildSet(cards)) return { cards, ordered: false };
    if (buildRun(cards, { ordered: true })) return { cards, ordered: true };
  }
  const run = buildRun(tries[0]);                  // encaja acomodándolo: se guarda ya en orden
  return run ? { cards: run.slots.map((s) => s.card), ordered: true } : null;
}

// Convierte lo preparado en el mensaje playTurn y lo valida con la MISMA lógica que el servidor.
// view: la vista del servidor. Devuelve { turn } o { error }.
export function buildTurn(view, stage, discardId, planted) {
  const roundIndex = view.round - 1;
  const split = splitTurnGroups(stage.groups, roundIndex, planted);
  const need = view.requirement?.length ?? 0;
  if (!split && stage.groups.length < need) return { error: `Para plantarte faltan grupos: llevas ${stage.groups.length} de ${need}` };
  if (!split) return { error: "Los grupos de la mesa no cumplen lo que pide la ronda" };
  if (!discardId) return { error: "Arrastra al descarte la carta con la que terminas el turno" };
  const ids = (g) => ({ cardIds: g.cards.map((c) => c.id), ordered: g.ordered === true });
  const turn = {
    plant: split.plant.map(ids),
    melds: split.melds.map(ids),
    hooks: stage.hooks.map((h) => ({ meldId: h.meldId, cardId: h.card.id, ...(h.end ? { end: h.end } : {}) })),
    discard: discardId,
  };
  const res = resolveTurn({
    hand: view.hand, melds: view.melds, planted, stoleThisTurn: view.stoleThisTurn, roundIndex,
    nextMeldId: Math.max(0, ...view.melds.map((m) => m.id)) + 1,
  }, view.you, turn);
  return res.ok ? { turn } : { error: res.error };
}
