// Avatares de los jugadores: imágenes client/public/avatars/avatar-1.webp … avatar-8.webp (con su aro dorado).
export const AVATAR_COUNT = 8;
export const isAvatar = (n) => Number.isInteger(n) && n >= 1 && n <= AVATAR_COUNT;
export const randomAvatar = (rng = Math.random) => 1 + Math.floor(rng() * AVATAR_COUNT);

// Avatar fijo a partir de un texto (invitados o cuentas antiguas sin avatar): siempre el mismo para el mismo id.
export function avatarFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return 1 + (h % AVATAR_COUNT);
}
