// Agrupación de la mano para los botones 789 / 777. Funciones puras (se prueban sin navegador).
// Con 3 barajas hay cartas idénticas (dos 5♠): NUNCA van en el mismo grupo, porque un trío
// necesita palos distintos y un consecutivo no repite número.
const VAL = (r) => ({ A: 1, J: 11, Q: 12, K: 13 }[r] ?? parseInt(r, 10));
const SUITS = ["♠", "♥", "♦", "♣"];
const bySuitOrder = (a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
const byRankThenSuit = (a, b) => VAL(a.rank) - VAL(b.rank) || bySuitOrder(a, b);

// Deja los grupos de 2+ cartas primero y junta todas las sueltas en un solo bloque final.
function finish(groups) {
  const multi = groups.filter((g) => g.length > 1);
  const tail = groups.filter((g) => g.length === 1).flat().sort(byRankThenSuit);
  return tail.length ? [...multi, tail] : multi;
}

// 777: mismo número, palos distintos.
export function groupSets(cards) {
  const byRank = {};
  cards.forEach((c) => (byRank[c.rank] ??= []).push(c));
  const groups = [];
  for (const list of Object.values(byRank)) {
    const bySuit = {};
    list.forEach((c) => (bySuit[c.suit] ??= []).push(c));
    const cols = Object.values(bySuit);
    const n = Math.max(...cols.map((l) => l.length));
    // el grupo i toma la i-ésima copia de cada palo → ningún grupo repite palo
    for (let i = 0; i < n; i++) groups.push(cols.map((l) => l[i]).filter(Boolean).sort(bySuitOrder));
  }
  groups.sort((a, b) => b.length - a.length || VAL(a[0].rank) - VAL(b[0].rank));
  return finish(groups);
}

// 789: seguidas del mismo palo. El orden es A,2,3…K (el As solo va al principio).
export function groupRuns(cards) {
  const bySuit = {};
  cards.forEach((c) => (bySuit[c.suit] ??= []).push(c));
  const groups = [];
  for (const suit of SUITS) {
    const list = (bySuit[suit] ?? []).sort((a, b) => VAL(a.rank) - VAL(b.rank));
    // capas: la 2ª copia de un mismo número (ej. otro 5♠) va a otra capa
    const layers = [];
    const seen = {};
    for (const c of list) {
      const k = (seen[c.rank] = (seen[c.rank] ?? -1) + 1);
      (layers[k] ??= []).push(c);
    }
    for (const layer of layers) {
      const runs = [];
      let run = [];
      for (const c of layer) {
        if (run.length && VAL(c.rank) === VAL(run.at(-1).rank) + 1) run.push(c);
        else { if (run.length) runs.push(run); run = [c]; }
      }
      if (run.length) runs.push(run);
      groups.push(...runs);
    }
  }
  groups.sort((a, b) => b.length - a.length || SUITS.indexOf(a[0].suit) - SUITS.indexOf(b[0].suit) || VAL(a[0].rank) - VAL(b[0].rank));
  return finish(groups);
}
