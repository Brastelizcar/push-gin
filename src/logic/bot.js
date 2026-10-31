// Jugador automático para el modo práctica. Solo usa SU vista (su mano y la mesa; nunca las manos ajenas)
// y las mismas reglas que el servidor. Devuelve la siguiente acción: { type, msg }.
//   'steal2' → robar un 2   ·  'takeDiscard' / 'push' → tomar carta  ·  'playTurn' → jugada completa + descarte
import { isWild, rankValues, cardPoints } from './cards.js';
import { buildSet, buildRun, extendMeld, stealTwo, meldCards } from './melds.js';
import { resolveTurn } from './turn.js';

const value = (c) => rankValues(c.rank)[0];
const without = (cards, used) => cards.filter((c) => !used.has(c.id));

function* combos(arr, k, start = 0) {
  if (k === 0) { yield []; return; }
  for (let i = start; i <= arr.length - k; i++) for (const rest of combos(arr, k - 1, i + 1)) yield [arr[i], ...rest];
}

// Posibles plantes de tamaño exacto con estas cartas, de menos a más comodines. Los consecutivos salen en orden.
function setCandidates(cards, size) {
  const wilds = cards.filter(isWild), out = [];
  const byRank = new Map();
  for (const c of cards.filter((c) => !isWild(c))) {
    const bySuit = byRank.get(c.rank) ?? new Map();
    if (!bySuit.has(c.suit)) bySuit.set(c.suit, c);           // una copia por palo
    byRank.set(c.rank, bySuit);
  }
  for (const bySuit of byRank.values()) {
    const nat = [...bySuit.values()];
    for (let j = Math.min(size, nat.length); j >= 1 && size - j <= wilds.length; j--)
      for (const pick of combos(nat, j)) out.push([...pick, ...wilds.slice(0, size - j)]);
  }
  return out.filter((g) => buildSet(g));
}
function runCandidates(cards, size) {
  const wilds = cards.filter(isWild), out = [];
  for (const suit of ['♠', '♥', '♦', '♣']) {
    const own = cards.filter((c) => c.suit === suit);
    for (let s = 1; s + size - 1 <= 13; s++) {
      const used = new Set(), slots = [];
      let w = 0, naturals = 0;
      for (let v = s; v < s + size; v++) {
        const nat = own.find((c) => !used.has(c.id) && !isWild(c) && value(c) === v)
          ?? (v === 2 ? own.find((c) => !used.has(c.id) && isWild(c)) : null);
        if (nat) { used.add(nat.id); slots.push(nat); if (!isWild(nat)) naturals++; }
        else slots.push(null);
      }
      if (!naturals) continue;
      const free = wilds.filter((c) => !used.has(c.id));
      const missing = slots.filter((x) => !x).length;
      if (missing > free.length) continue;
      const run = slots.map((x) => x ?? (w++, free[w - 1]));
      if (buildRun(run, { ordered: true })) out.push(run);
    }
  }
  return out;
}
const wildsIn = (g) => g.filter(isWild).length;
const candidates = (cards, req) =>
  (req.kind === 'set' ? setCandidates(cards, req.size) : runCandidates(cards, req.size)).sort((a, b) => wildsIn(a) - wildsIn(b));

// Busca en la mano el plante EXACTO que pide la ronda. Devuelve [[cartas], ...] (en el orden del requisito) o null.
export function findPlantInHand(hand, requirement) {
  const total = requirement.reduce((s, r) => s + r.size, 0);
  if (hand.length - total < 1) return null;                    // hay que conservar una carta para descartar
  const reqs = [...requirement].sort((a, b) => b.size - a.size); // los grandes primero: menos opciones
  const go = (i, used) => {
    if (i === reqs.length) return [];
    for (const g of candidates(without(hand, used), reqs[i])) {
      const next = new Set([...used, ...g.map((c) => c.id)]);
      const rest = go(i + 1, next);
      if (rest) return [g, ...rest];
    }
    return null;
  };
  return go(0, new Set());
}

// Ya plantado: combinaciones libres (las más largas primero), conservando al menos `keep` cartas.
export function findFreeMeldsInHand(hand, keep = 1) {
  const out = [];
  let left = [...hand];
  for (;;) {
    let best = null;
    for (let size = Math.min(13, left.length - keep); size >= 3 && !best; size--) {
      const opts = [...(size <= 4 ? setCandidates(left, size) : []), ...runCandidates(left, size)]
        .sort((a, b) => wildsIn(a) - wildsIn(b));
      best = opts[0] ?? null;
    }
    if (!best) return out;
    out.push(best);
    const ids = new Set(best.map((c) => c.id));
    left = without(left, ids);
  }
}

// Qué tan útil es una carta para este jugador: 2s muy útiles; si no, cuenta "vecinas" (mismo número, o mismo palo
// a distancia ≤ 2).
export function usefulness(card, hand) {
  if (isWild(card)) return 100;
  let n = 0;
  for (const o of hand) {
    if (o.id === card.id || isWild(o)) continue;
    if (o.rank === card.rank && o.suit !== card.suit) n += 2;
    else if (o.suit === card.suit && Math.abs(value(o) - value(card)) <= 2 && o.rank !== card.rank) n += 1;
  }
  return n;
}

// Carta a descartar: la menos útil; a igual utilidad, la que más puntos vale. Evita devolver la carta que acaba
// de tomar (`avoid`), para no quedar en un ciclo tomando y devolviendo la misma.
export function chooseDiscard(hand, planted, avoid = null) {
  const base = hand.some((c) => !isWild(c)) ? hand.filter((c) => !isWild(c)) : hand;
  const pool = base.length > 1 ? base.filter((c) => c.id !== avoid) : base;
  const score = (c) => (planted ? 0 : usefulness(c, hand) * 100) - cardPoints(c);
  return [...pool].sort((a, b) => score(a) - score(b))[0];
}

// Enganches posibles con las cartas que quedan (en plantes de la mesa, incluidos los recién bajados).
function planHooksOnTable(melds, cards, keep) {
  const hooks = [];
  const table = melds.map((e) => ({ ...e }));
  let left = [...cards], progress = true;
  while (progress && left.length > keep) {
    progress = false;
    for (const card of left) {
      for (const e of table) {
        const end = e.meld.kind === 'run' ? ['high', 'low'].find((x) => extendMeld(e.meld, card, x)) : undefined;
        const next = extendMeld(e.meld, card, end);
        if (!next) continue;
        e.meld = next;
        hooks.push({ meldId: e.id, cardId: card.id, ...(end ? { end } : {}) });
        left = left.filter((c) => c.id !== card.id);
        progress = true;
        break;
      }
      if (progress || left.length <= keep) break;
    }
  }
  return { hooks, left };
}

const toGroup = (cards) => ({ cardIds: cards.map((c) => c.id), ordered: !buildSet(cards) });

// Decide la jugada de la fase 'main' (ya tomó carta).
export function planTurn(view) {
  const me = view.players.find((p) => p.id === view.you);
  const roundIndex = view.round - 1;
  let hand = [...view.hand];
  let planted = !!me?.planted;
  const turn = { plant: [], melds: [], hooks: [] };

  if (!planted && !view.stoleThisTurn) {
    const groups = findPlantInHand(hand, view.requirement);
    if (groups) {
      turn.plant = groups.map(toGroup);
      hand = without(hand, new Set(groups.flat().map((c) => c.id)));
      planted = true;
    }
  }
  let newMelds = [];
  if (planted) {
    const free = findFreeMeldsInHand(hand, 1);
    turn.melds = free.map(toGroup);
    hand = without(hand, new Set(free.flat().map((c) => c.id)));
    // Plantes de la mesa + los que se bajan ahora (con los ids que les dará el servidor).
    let nextId = Math.max(0, ...view.melds.map((m) => m.id)) + 1;
    newMelds = [...turn.plant, ...turn.melds].map((g) => {
      const cards = g.cardIds.map((id) => view.hand.find((c) => c.id === id));
      return { id: nextId++, meld: buildSet(cards) ?? buildRun(cards, { ordered: true }) };
    });
    // Enganchar solo si ya estaba plantado de un turno anterior (no en el turno en que se planta).
    if (me?.planted) {
      const { hooks, left } = planHooksOnTable([...view.melds, ...newMelds], hand, 1);
      turn.hooks = hooks;
      hand = left;
    }
  }
  turn.discard = chooseDiscard(hand, planted, view.drawn).id;

  // Siempre se comprueba con la misma lógica del servidor; si algo no cuadra, solo descarta.
  const ok = resolveTurn({
    hand: view.hand, melds: view.melds, planted: !!me?.planted, stoleThisTurn: view.stoleThisTurn,
    roundIndex, nextMeldId: Math.max(0, ...view.melds.map((m) => m.id)) + 1,
  }, view.you, turn).ok;
  return ok ? turn : { discard: chooseDiscard(view.hand, !!me?.planted, view.drawn).id };
}

// ¿Le sirve la carta del descarte? Solo si es un 2, si engancha en la mesa (ya plantado) o si completa YA un
// trío o un consecutivo de 3 con cartas de la mano. Si no, hace push (así el mazo avanza y la ronda no se estanca).
export function wantsDiscard(view) {
  const top = view.discardTop;
  if (!top) return false;
  if (isWild(top)) return true;
  const planted = view.players.find((p) => p.id === view.you)?.planted;
  if (planted && view.melds.some((e) => extendMeld(e.meld, top, 'high') || extendMeld(e.meld, top, 'low'))) return true;
  const hand = view.hand.filter((c) => !isWild(c));
  const withTop = [...hand, top];
  return [...setCandidates(withTop, 3), ...runCandidates(withTop, 3)].some((g) => g.some((c) => c.id === top.id));
}

// Robo de un 2 posible (antes de tomar carta, sin estar plantado, de plantes de jugadores plantados).
export function findSteal(view) {
  const plantedIds = new Set(view.players.filter((p) => p.planted).map((p) => p.id));
  for (const e of view.melds) {
    if (!plantedIds.has(e.owner)) continue;
    const cards = meldCards(e.meld);
    for (let i = 0; i < cards.length; i++) {
      if (!isWild(cards[i])) continue;
      for (const c of view.hand) if (stealTwo(e.meld, i, c)) return { meldId: e.id, index: i, cardId: c.id };
    }
  }
  return null;
}

// Nombres de los bots de práctica (ids bot1, bot2, bot3).
export const BOT_NAMES = ['Rosa', 'Tomás', 'Lucía'];
export const isBot = (id) => /^bot\d$/.test(id);

// Siguiente acción del bot cuando es su turno.
export function botMove(view) {
  const planted = view.players.find((p) => p.id === view.you)?.planted;
  if (view.turnPhase === 'start') {
    // Robar 2s solo si de todos modos no puede plantarse ahora.
    if (!planted && !findPlantInHand([...view.hand, ...(view.discardTop ? [view.discardTop] : [])], view.requirement)) {
      const steal = findSteal(view);
      if (steal) return { type: 'steal2', msg: steal };
    }
    // Con el mazo agotado (última vuelta) no hay push: solo se puede tomar el descarte.
    return { type: wantsDiscard(view) || view.deckCount < 2 ? 'takeDiscard' : 'push' };
  }
  return { type: 'playTurn', msg: planTurn(view) };
}
