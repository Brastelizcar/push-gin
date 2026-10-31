// Utilidades puras de formato (se prueban sin navegador).
export const isSyncCode = (s) => typeof s === "string" && /^[A-Za-z0-9]{20}$/.test(s);

// "05:03:09"
export function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
