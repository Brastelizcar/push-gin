// Jugada en preparación (Lote 2). Funciones puras: se prueban sin navegador.
// Durante tu turno (fase 'main') armas la jugada en local: grupos que sueltas en la mesa, cartas que enganchas
// y la carta del descarte. Nada llega al servidor hasta pulsar ✓; entonces viaja todo junto (playTurn).
import { buildSet, buildRun, extendMeld } from "../../src/logic/melds.js";
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

// Tramos de la mano separados por espacios: items [{card}|{gap}] → [[card, ...], ...].
export function handSegments(items) {
  const out = [[]];
  for (const it of items) it.gap ? out.push([]) : out.at(-1).push(it.card);
  return out.filter((s) => s.length);
}

// Para cada carta de un tramo que forma plante: { cards, first, last }. Las demás no aparecen.
export function validGroupsById(items) {
  const map = new Map();
  for (const seg of handSegments(items)) {
    if (!meldShape(seg)) continue;
    seg.forEach((c, i) => map.set(c.id, { cards: seg, first: i === 0, last: i === seg.length - 1 }));
  }
  return map;
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
