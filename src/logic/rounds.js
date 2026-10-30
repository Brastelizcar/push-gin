import { buildSet, buildRun } from './melds.js';

const S = (size) => ({ kind: 'set', size });
const R = (size) => ({ kind: 'run', size });

export const TOTAL_ROUNDS = 5;
export const ROUND_REQUIREMENTS = [
  [S(3), S(3), S(3)], // 1: 3 tríos
  [S(3), R(5)],       // 2: trío + consecutivo de 5
  [R(6), R(6)],       // 3: 2 consecutivos de 6
  [S(3), S(3), S(3), S(3)], // 4: 4 tríos
  [S(4), R(8)],       // 5: cuarteto + consecutivo de 8
];

function interpretations(group) {
  const out = [];
  const s = buildSet(group.cards);
  if (s) out.push({ req: { kind: 'set', size: group.cards.length }, meld: s });
  const r = buildRun(group.cards, { start: group.start });
  if (r) out.push({ req: { kind: 'run', size: group.cards.length }, meld: r });
  return out;
}

// groups: [{ cards, start? }]. Devuelve los plantes (en el orden de groups) o null
// si los grupos NO cumplen exactamente el requisito de la ronda.
export function matchPlant(groups, roundIndex) {
  const reqs = ROUND_REQUIREMENTS[roundIndex];
  if (!reqs || groups.length !== reqs.length) return null;
  const opts = groups.map(interpretations);
  const used = reqs.map(() => false);
  const chosen = [];
  const go = (i) => {
    if (i === groups.length) return true;
    for (const o of opts[i])
      for (let j = 0; j < reqs.length; j++) {
        if (used[j] || reqs[j].kind !== o.req.kind || reqs[j].size !== o.req.size) continue;
        used[j] = true; chosen[i] = o.meld;
        if (go(i + 1)) return true;
        used[j] = false;
      }
    return false;
  };
  return go(0) ? chosen : null;
}
