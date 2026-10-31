// Progreso del jugador: experiencia (XP), nivel y fichas. Funciones puras (el servidor guarda los datos).

// XP al terminar una partida según el puesto (1.º, 2.º, 3.º, 4.º).
export const XP_BY_PLACE = [100, 50, 30, 10];
export const DAILY_CHIPS = 300;                    // fichas gratis
export const CLAIM_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const ENTRY_FEES = [0, 100, 200, 300, 500, 1000]; // cuotas de entrada permitidas en juego privado

// Pasar del nivel N al N+1 cuesta 100×N XP. XP total para LLEGAR al nivel L: 100·(1+2+…+(L-1)).
export const xpToReach = (level) => (100 * (level - 1) * level) / 2;

// { level, into, needed }: nivel actual, XP dentro de ese nivel y XP que pide el siguiente.
export function levelInfo(xp) {
  let level = 1;
  while (xp >= xpToReach(level + 1)) level++;
  return { level, into: xp - xpToReach(level), needed: 100 * level };
}

// Puestos de la partida: menor total gana. Los empatados comparten el mejor puesto.
// totals: { id: puntos }. Devuelve { id: puesto (0 = primero) }.
export function placements(totals) {
  const ids = Object.keys(totals);
  return Object.fromEntries(ids.map((id) => [id, ids.filter((o) => totals[o] < totals[id]).length]));
}

// Premios al final: XP según el puesto y el pozo de cuotas para el/los ganadores (repartido; el sobrante,
// al primero en el orden). order: ids en orden de asiento. Devuelve { id: { place, xp, chips } }.
export function gameRewards(order, totals, fee = 0) {
  const place = placements(totals);
  const winners = order.filter((id) => place[id] === 0);
  const pot = fee * order.length;
  const share = Math.floor(pot / winners.length);
  const extra = pot - share * winners.length;
  return Object.fromEntries(order.map((id) => [id, {
    place: place[id],
    xp: XP_BY_PLACE[place[id]] ?? 0,
    chips: (place[id] === 0 ? share + (id === winners[0] ? extra : 0) : 0) - fee, // ganancia neta de la partida
  }]));
}

// ¿Puede reclamar las fichas gratis? lastClaimAt/now en milisegundos (los decide el SERVIDOR).
export function claimStatus(lastClaimAt, now) {
  if (lastClaimAt == null) return { canClaim: true, msLeft: 0 };
  const msLeft = Math.max(0, lastClaimAt + CLAIM_INTERVAL_MS - now);
  return { canClaim: msLeft === 0, msLeft };
}
