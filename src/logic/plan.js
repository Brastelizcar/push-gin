// Ayudas para la interfaz: a partir de las cartas que el jugador SELECCIONÓ, averigua cómo
// agruparlas (plantarse / bajar combinaciones / enganchar). Funciones puras; el servidor
// sigue siendo quien valida de verdad (esto solo evita tener que armar los grupos a mano).
import { buildSet, buildRun, extendMeld } from './melds.js';

// ¿Forman un consecutivo? Primero respetando el ORDEN en que el jugador las tiene (así un 2 vale por la
// posición donde lo puso); si no, acomodándolas solas. Devuelve { meld, ordered } o null.
function asRun(group) {
  const ordered = buildRun(group, { ordered: true });
  if (ordered) return { meld: ordered, ordered: true };
  const auto = buildRun(group);
  return auto ? { meld: auto, ordered: false } : null;
}

function* combinations(arr, k, start = 0) {
  if (k === 0) { yield []; return; }
  for (let i = start; i <= arr.length - k; i++)
    for (const rest of combinations(arr, k - 1, i + 1)) yield [arr[i], ...rest];
}
const without = (arr, used) => arr.filter((c) => !used.includes(c));

// Plantarse: reparte TODAS las cartas dadas en los grupos que pide la ronda.
// requirement: [{ kind:'set'|'run', size }]. Devuelve [{ cards }] o null.
export function findPlantGroups(cards, requirement) {
  const total = requirement.reduce((s, r) => s + r.size, 0);
  if (cards.length !== total) return null;
  const solve = (rem, reqs) => {
    if (!rem.length) return reqs.length ? null : [];
    if (!reqs.length) return null;
    const [first, ...rest] = rem;
    const tried = new Set();
    for (let ri = 0; ri < reqs.length; ri++) {
      const req = reqs[ri], key = `${req.kind}${req.size}`;
      if (tried.has(key)) continue;
      tried.add(key);
      for (const combo of combinations(rest, req.size - 1)) {
        const group = [first, ...combo];
        const hit = req.kind === 'set' ? (buildSet(group) && { ordered: false }) : asRun(group);
        if (!hit) continue;
        const sub = solve(without(rest, combo), reqs.filter((_, i) => i !== ri));
        if (sub) return [{ cards: group, ordered: hit.ordered }, ...sub];
      }
    }
    return null;
  };
  return solve(cards, requirement);
}

// Ya plantado: reparte TODAS las cartas dadas en tríos/cuartetos/consecutivos válidos. Devuelve [{cards}] o null.
export function findFreeMelds(cards) {
  if (cards.length < 3 || cards.length > 14) return null;
  const solve = (rem) => {
    if (!rem.length) return [];
    const [first, ...rest] = rem;
    for (let size = 3; size <= Math.min(rem.length, 13); size++)
      for (const combo of combinations(rest, size - 1)) {
        const group = [first, ...combo];
        const hit = (size <= 4 && buildSet(group) && { ordered: false }) || asRun(group);
        if (!hit) continue;
        const sub = solve(without(rest, combo));
        if (sub) return [{ cards: group, ordered: hit.ordered }, ...sub];
      }
    return null;
  };
  return solve(cards);
}

// Enganchar: ¿se pueden agregar TODAS estas cartas a este plante (en algún orden)?
// Devuelve [{ card, end }] en el orden en que hay que enviarlas, o null.
export function planHooks(meld, cards) {
  let m = meld;
  const left = [...cards], out = [];
  let progress = true;
  while (left.length && progress) {
    progress = false;
    for (let i = 0; i < left.length && !progress; i++)
      for (const end of m.kind === 'run' ? ['high', 'low'] : [undefined]) {
        const next = extendMeld(m, left[i], end);
        if (!next) continue;
        out.push({ card: left[i], end });
        m = next; left.splice(i, 1); progress = true;
        break;
      }
  }
  return left.length ? null : out;
}
