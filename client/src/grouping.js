// Agrupación de la mano para los botones 789 / 777. Funciones puras (se prueban sin navegador).
// Con 3 barajas hay cartas idénticas (dos 5♠): en un trío pueden ir juntas (el palo no importa), pero un
// consecutivo no repite número. Los 2 son comodines: no entran en ningún grupo y quedan con las sueltas.
const VAL = (r) => ({ A: 14, J: 11, Q: 12, K: 13 }[r] ?? parseInt(r, 10));
const isWild = (c) => c.rank === "2";
const SUITS = ["♠", "♥", "♦", "♣"];
const bySuitOrder = (a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
const byRankThenSuit = (a, b) => VAL(a.rank) - VAL(b.rank) || bySuitOrder(a, b);

// Deja los grupos de 2+ cartas primero y junta todas las sueltas en un solo bloque final.
function finish(groups) {
  const multi = groups.filter((g) => g.length > 1);
  const tail = groups.filter((g) => g.length === 1).flat().sort(byRankThenSuit);
  return tail.length ? [...multi, tail] : multi;
}

// 777: todas las cartas del mismo número juntas (de cualquier palo).
export function groupSets(cards) {
  const byRank = {};
  cards.filter((c) => !isWild(c)).forEach((c) => (byRank[c.rank] ??= []).push(c));
  const groups = Object.values(byRank).map((list) => list.sort(bySuitOrder));
  groups.sort((a, b) => b.length - a.length || VAL(a[0].rank) - VAL(b[0].rank));
  return finish([...groups, ...cards.filter(isWild).map((c) => [c])]);
}

// 789: seguidas del mismo palo, de mayor a menor: A,K,Q…3 (el As solo va junto a la K).
export function groupRuns(cards) {
  const bySuit = {};
  cards.filter((c) => !isWild(c)).forEach((c) => (bySuit[c.suit] ??= []).push(c));
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
      groups.push(...runs.map((r) => r.reverse()));
    }
  }
  groups.sort((a, b) => b.length - a.length || SUITS.indexOf(a[0].suit) - SUITS.indexOf(b[0].suit) || VAL(b[0].rank) - VAL(a[0].rank));
  return finish([...groups, ...cards.filter(isWild).map((c) => [c])]);
}
