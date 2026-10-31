// Jugada completa de un turno (fase 'main'), validada de UNA vez. Función pura: no modifica el estado recibido.
//
// turn = {
//   plant?:  [{ cardIds, ordered?, start? }],  // grupos con los que te plantas (requisito exacto de la ronda)
//   melds?:  [{ cardIds, ordered?, start? }],  // combinaciones nuevas (ya plantado, o plantándote en este turno)
//   hooks?:  [{ meldId, cardId, end? }],       // enganches, en el orden en que se aplican
//   discard?: cardId,                          // carta que descartas (obligatoria en playTurn)
// }
// state = { hand, melds:[{ id, owner, meld }], planted, stoleThisTurn, roundIndex, nextMeldId }
//
// Orden: plantarse → bajar → enganchar → descartar (enganchar solo si ya estabas plantado antes de este turno). Devuelve
//   { ok:true, hand, melds, planted, nextMeldId, playedCards, plantedNow, laid, hooked }
// (hand SIN las cartas jugadas, pero todavía CON la carta a descartar) o { ok:false, error }.
import { matchPlant } from './rounds.js';
import { buildSet, buildRun, extendMeld, meldCards } from './melds.js';

const fail = (error) => ({ ok: false, error });
const isStr = (x) => typeof x === 'string';

function parseGroup(g, byId) {
  const cards = g.cardIds.map((id) => byId.get(id));
  return { cards, start: g.start, ordered: g.ordered === true };
}

export function resolveTurn(state, pid, turn = {}) {
  const plant = turn.plant ?? [];
  const groups = turn.melds ?? [];
  const hooks = turn.hooks ?? [];
  const discard = turn.discard;

  // 1) Todas las cartas usadas deben estar en tu mano y no repetirse.
  const used = [
    ...plant.flatMap((g) => g.cardIds),
    ...groups.flatMap((g) => g.cardIds),
    ...hooks.map((h) => h.cardId),
    ...(discard !== undefined ? [discard] : []),
  ];
  if (!used.every(isStr)) return fail('Cartas inválidas o repetidas');
  if (new Set(used).size !== used.length) return fail('Cartas inválidas o repetidas');
  const byId = new Map(state.hand.map((c) => [c.id, c]));
  if (!used.every((id) => byId.has(id))) return fail('Cartas inválidas o repetidas');

  let planted = state.planted;
  const plantedNow = plant.length > 0;
  const newMelds = [];

  // 2) Plantarse.
  if (plantedNow) {
    if (planted) return fail('Ya te plantaste');
    if (state.stoleThisTurn) return fail('Robaste un 2: no puedes plantarte este turno');
    const melds = matchPlant(plant.map((g) => parseGroup(g, byId)), state.roundIndex);
    if (!melds) return fail('Las cartas no cumplen exactamente el requisito de la ronda');
    newMelds.push(...melds);
    planted = true;
  }

  // 3) Bajar combinaciones nuevas.
  if (groups.length) {
    if (!planted) return fail('Primero debes plantarte');
    for (const g of groups) {
      const p = parseGroup(g, byId);
      const meld = buildSet(p.cards) ?? buildRun(p.cards, { start: p.start, ordered: p.ordered });
      if (!meld) return fail('Alguna combinación no es válida');
      newMelds.push(meld);
    }
  }

  let nextMeldId = state.nextMeldId;
  const melds = [
    ...state.melds.map((e) => ({ ...e })),
    ...newMelds.map((meld) => ({ id: nextMeldId++, owner: pid, meld })),
  ];

  // 4) Enganchar (sobre plantes propios o ajenos). Solo si te plantaste en un turno ANTERIOR:
  //    en el turno en que te plantas no puedes enganchar.
  if (hooks.length && !planted) return fail('Primero debes plantarte');
  if (hooks.length && plantedNow) return fail('No puedes enganchar en el turno en que te plantas: engancha desde tu próximo turno');
  for (const h of hooks) {
    if (h.end !== undefined && h.end !== 'low' && h.end !== 'high') return fail('Mensaje inválido');
    const entry = melds.find((m) => m.id === h.meldId);
    if (!entry) return fail('Plante inexistente');
    const next = extendMeld(entry.meld, byId.get(h.cardId), h.end);
    if (!next) return fail('La carta no extiende ese plante');
    entry.meld = next;
  }

  // 5) Debe quedar al menos una carta: la del descarte obligatorio.
  const playedCards = [...newMelds.flatMap(meldCards), ...hooks.map((h) => byId.get(h.cardId))];
  const playedIds = new Set(playedCards.map((c) => c.id));
  const hand = state.hand.filter((c) => !playedIds.has(c.id));
  if (hand.length < 1) return fail('Debes conservar al menos una carta para descartar');

  return {
    ok: true, hand, melds, planted, nextMeldId, playedCards,
    plantedNow, laid: newMelds.length - (plantedNow ? plant.length : 0), hooked: hooks.length,
  };
}
