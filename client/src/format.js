// Utilidades puras de formato (se prueban sin navegador).
export { normalizeSyncCode, formatSyncCode } from "../../src/logic/sync.js";

// "05:03:09" (o "09:41" si no hay horas y se pide corto)
export function formatCountdown(ms, { short = false } = {}) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return short && !hh ? `${pad(mm)}:${pad(ss)}` : `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}
