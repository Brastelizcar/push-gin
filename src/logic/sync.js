// Código corto de sincronización: para usar tu cuenta en otro dispositivo. Lo genera el servidor, sirve UNA sola vez
// y vence a los 10 minutos. Sin letras que se confundan (0/O, 1/I/L), para dictarlo o copiarlo a mano.
export const SYNC_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SYNC_CODE_LENGTH = 8;
export const SYNC_CODE_TTL_MS = 10 * 60 * 1000;

// Acepta minúsculas, espacios y guiones ("abcd-efgh"). Devuelve "ABCDEFGH" o null si no tiene la forma correcta.
export function normalizeSyncCode(input) {
  if (typeof input !== 'string') return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== SYNC_CODE_LENGTH) return null;
  return [...s].every((ch) => SYNC_ALPHABET.includes(ch)) ? s : null;
}

// "ABCDEFGH" → "ABCD-EFGH"
export const formatSyncCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;
