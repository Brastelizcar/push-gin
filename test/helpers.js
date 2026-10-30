let n = 0;
export const c = (s) => ({ id: `t${n++}-${s}`, rank: s.slice(0, -1), suit: s.slice(-1) });
export const cs = (...list) => list.map(c);
export const ids = (cards) => cards.map((x) => x.id);