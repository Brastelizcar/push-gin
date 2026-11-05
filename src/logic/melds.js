// Plantes (melds). Dos tipos:
//   set: { kind:'set', rank, cards:[...] }            (3 o más cartas del mismo número, de cualquier palo)
//   run: { kind:'run', suit, slots:[{card, value}] }  (mismo palo, value 3..14 ascendente: 3…K, A)
// El 2 es SOLO comodín: en un set vale el número del set; en un consecutivo, el de la posición donde se coloca.
import { isWild, rankValues, RUN_LOW, RUN_HIGH } from './cards.js';

// Mínimo de cartas naturales (no-2) por plante.
export const MIN_NATURALS = 1;
export const MAX_RUN_LENGTH = RUN_HIGH - RUN_LOW + 1;   // 3…A = 12 cartas

const split = (cards) => ({
  naturals: cards.filter((c) => !isWild(c)),
  wilds: cards.filter(isWild),
});

// Trío, cuarteto o más: mismo número, el palo no importa (con 3 barajas puede repetirse). Sin máximo de cartas.
export function buildSet(cards) {
  if (cards.length < 3) return null;
  const { naturals } = split(cards);
  if (naturals.length < MIN_NATURALS) return null;
  const rank = naturals[0].rank;
  if (!naturals.every((c) => c.rank === rank)) return null;
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

// Cartas EN ORDEN (ascendente) → plante con cada 2 valiendo lo de su posición, o null.
function orderedRun(cards, suit) {
  const n = cards.length;
  const k = cards.findIndex((c) => !isWild(c));
  const s = rankValues(cards[k].rank)[0] - k;
  if (s < RUN_LOW || s + n - 1 > RUN_HIGH) return null;
  for (let i = 0; i < n; i++) if (!isWild(cards[i]) && rankValues(cards[i].rank)[0] !== s + i) return null;
  return { kind: 'run', suit, slots: cards.map((card, i) => ({ card, value: s + i })) };
}

// Consecutivo: mismo palo, números seguidos de 3 a A. El 2 vale por el número de la posición donde se coloca.
//  · ordered:true → las cartas vienen EN ORDEN, ascendente (3,4…K,A) o descendente (A,K…3), y cada 2 vale lo que le
//    toca por su posición (ej. 5♥ 6♥ 2 → el 2 es un 7; 2 5♥ 6♥ → el 2 es un 4). Si valen los dos sentidos, gana el
//    ascendente.
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
    const up = orderedRun(cards, suit);
    if (up) return up;
    const down = orderedRun([...cards].reverse(), suit);
    return down;
  }

  const last = RUN_HIGH - n + 1;
  const starts = start !== undefined ? [start] : Array.from({ length: last - RUN_LOW + 1 }, (_, i) => RUN_LOW + i);
  for (const s of starts) {
    if (s < RUN_LOW || s > last) continue;
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

// Plante COMPLETO: un consecutivo de 3 a A (12 cartas). Al completarse sale de la mesa. Los grupos del mismo número
// nunca se completan: siguen creciendo en la mesa.
export const isCompleteMeld = (m) => m.kind === 'run' && m.slots.length === MAX_RUN_LENGTH;

// Enganche: solo EXTIENDE. Set → cualquier carta del mismo número (o un 2), sin límite. Run → por cualquiera de los
// extremos.
export function extendMeld(meld, card, end) {
  if (meld.kind === 'set') {
    if (!isWild(card) && card.rank !== meld.rank) return null;
    return { ...meld, cards: [...meld.cards, card] };
  }
  if (meld.slots.length >= MAX_RUN_LENGTH) return null;
  const fits = (v) =>
    v >= RUN_LOW && v <= RUN_HIGH && (isWild(card) || (card.suit === meld.suit && rankValues(card.rank).includes(v)));
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
    return { meld: { ...meld, cards: meld.cards.map((c, i) => (i === index ? card : c)) }, stolen: wild };
  }
  const slot = meld.slots[index];
  if (!slot || !isWild(slot.card)) return null;
  if (card.suit !== meld.suit || !rankValues(card.rank).includes(slot.value)) return null;
  const slots = meld.slots.map((s, i) => (i === index ? { card, value: s.value } : s));
  return { meld: { ...meld, slots }, stolen: slot.card };
}
