// Cartas: { id, rank, suit }. El 2 es comodín.
export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

export const isWild = (card) => card.rank === '2';

// Valor de un rango en una escalera. El orden es A,2,3…K: el As solo vale 1 (no hay Q-K-A).
export function rankValues(rank) {
  if (rank === 'A') return [1];
  if (rank === 'J') return [11];
  if (rank === 'Q') return [12];
  if (rank === 'K') return [13];
  return [parseInt(rank, 10)];
}

export function cardPoints(card) {
  if (card.rank === 'A') return 15;
  if (card.rank === '2') return 20;
  if (['10', 'J', 'Q', 'K'].includes(card.rank)) return 10;
  return 5;
}

export function makeDeck(decks = 3) {
  const cards = [];
  for (let d = 0; d < decks; d++)
    for (const suit of SUITS)
      for (const rank of RANKS) cards.push({ id: `${d}-${rank}${suit}`, rank, suit });
  return cards;
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
