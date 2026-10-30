// Plantes (melds). Dos tipos:
//   set: { kind:'set', rank, cards:[...] }            (trío = 3, cuarteto = 4)
//   run: { kind:'run', suit, slots:[{card, value}] }  (value 1..14, ascendente)
import { isWild, rankValues } from './cards.js';

// Mínimo de cartas naturales (no-2) por plante. Regla no definida aún: ver preguntas abiertas.
export const MIN_NATURALS = 1;
export const MAX_RUN_LENGTH = 13;

const split = (cards) => ({
  naturals: cards.filter((c) => !isWild(c)),
  wilds: cards.filter(isWild),
});

export function buildSet(cards) {
  if (cards.length < 3 || cards.length > 4) return null;
  const { naturals } = split(cards);
  if (naturals.length === 0) {                       // todo son 2: el 2 también es un número (trío/cuarteto de 2s)
    if (new Set(cards.map((c) => c.suit)).size !== cards.length) return null;
    return { kind: 'set', rank: '2', cards: [...cards] };
  }
  const rank = naturals[0].rank;                     // con otro número, los 2 hacen de comodín (valen ese número)
  if (!naturals.every((c) => c.rank === rank)) return null;
  if (new Set(naturals.map((c) => c.suit)).size !== naturals.length) return null; // palos distintos
  return { kind: 'set', rank, cards: [...cards] };
}

// Asigna a cada natural un valor distinto dentro de [s, e].
function assignValues(naturals, s, e) {
  const used = new Set();
  const out = new Map();
  const go = (i) => {
    if (i === naturals.length) return true;
    for (const v of rankValues(naturals[i].rank)) {
      if (v < s || v > e || used.has(v)) continue;
      used.add(v); out.set(naturals[i].id, v);
      if (go(i + 1)) return true;
      used.delete(v); out.delete(naturals[i].id);
    }
    return false;
  };
  return go(0) ? out : null;
}

// El 2 vale por el número de la posición donde se coloca.
//  · ordered:true → las cartas vienen EN ORDEN ascendente (A,2,3…K) y cada 2 vale lo que le toca por su
//    posición (ej. 5♥ 6♥ 2 → el 2 es un 7; 2 5♥ 6♥ → el 2 es un 4).
//  · sin ordered → se acomodan solas; `start` (opcional) fija el valor de la primera posición cuando es
//    ambiguo; sin start, se usa la más baja.
export function buildRun(cards, { start, ordered } = {}) {
  const n = cards.length;
  if (n < 3 || n > MAX_RUN_LENGTH) return null;
  const { naturals, wilds } = split(cards);
  if (naturals.length < MIN_NATURALS) return null;
  const suit = naturals[0].suit;
  if (!naturals.every((c) => c.suit === suit)) return null;

  if (ordered) {
    const k = cards.findIndex((c) => !isWild(c));
    const s = rankValues(cards[k].rank)[0] - k;
    if (s < 1 || s + n - 1 > 13) return null;
    for (let i = 0; i < n; i++) if (!isWild(cards[i]) && rankValues(cards[i].rank)[0] !== s + i) return null;
    return { kind: 'run', suit, slots: cards.map((card, i) => ({ card, value: s + i })) };
  }

  const starts = start !== undefined ? [start] : Array.from({ length: 13 - n + 1 }, (_, i) => i + 1);
  for (const s of starts) {
    if (s < 1 || s + n - 1 > 13) continue;
    const m = assignValues(naturals, s, s + n - 1);
    if (!m) continue;
    const pool = [...wilds];
    const slots = [];
    for (let v = s; v < s + n; v++) {
      const nat = naturals.find((c) => m.get(c.id) === v);
      slots.push({ card: nat ?? pool.shift(), value: v });
    }
    return { kind: 'run', suit, slots };
  }
  return null;
}

export const meldCards = (m) => (m.kind === 'set' ? m.cards : m.slots.map((s) => s.card));

// Enganche: solo EXTIENDE. Set → hasta cuarteto. Run → por cualquiera de los extremos.
export function extendMeld(meld, card, end) {
  if (meld.kind === 'set') {
    if (meld.cards.length >= 4) return null;
    if (meld.rank === '2') {                         // set de 2s: solo 2s y de palo nuevo
      if (card.rank !== '2' || meld.cards.some((c) => c.suit === card.suit)) return null;
    } else if (!isWild(card)) {
      if (card.rank !== meld.rank) return null;
      if (meld.cards.some((c) => !isWild(c) && c.suit === card.suit)) return null;
    }
    return { ...meld, cards: [...meld.cards, card] };
  }
  if (meld.slots.length >= MAX_RUN_LENGTH) return null;
  const fits = (v) =>
    v >= 1 && v <= 13 && (isWild(card) || (card.suit === meld.suit && rankValues(card.rank).includes(v)));
  const low = meld.slots[0].value - 1;
  const high = meld.slots.at(-1).value + 1;
  const ends = end ? [end] : ['high', 'low'];
  for (const e of ends) {
    if (e === 'high' && fits(high)) return { ...meld, slots: [...meld.slots, { card, value: high }] };
    if (e === 'low' && fits(low)) return { ...meld, slots: [{ card, value: low }, ...meld.slots] };
  }
  return null;
}

// Robo de un 2: reemplaza el comodín en `index` por una carta natural que encaje exacto.
// Devuelve { meld, stolen } o null.
export function stealTwo(meld, index, card) {
  if (isWild(card)) return null;
  if (meld.kind === 'set') {
    const wild = meld.cards[index];
    if (!wild || !isWild(wild) || card.rank !== meld.rank) return null;
    const others = meld.cards.filter((_, i) => i !== index);
    if (others.some((c) => !isWild(c) && c.suit === card.suit)) return null;
    return { meld: { ...meld, cards: meld.cards.map((c, i) => (i === index ? card : c)) }, stolen: wild };
  }
  const slot = meld.slots[index];
  if (!slot || !isWild(slot.card)) return null;
  if (card.suit !== meld.suit || !rankValues(card.rank).includes(slot.value)) return null;
  const slots = meld.slots.map((s, i) => (i === index ? { card, value: s.value } : s));
  return { meld: { ...meld, slots }, stolen: slot.card };
}
