// Tu cuenta: el código de sincronización se guarda en este navegador y viaja en la cabecera Authorization.
// El servidor guarda nombre, XP, fichas y decide cuándo puedes reclamar las fichas gratis.
import { HTTP_URL } from "./net.js";
export { isSyncCode, formatCountdown } from "./format.js";

const KEY = "pushgin:code";
export const savedCode = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const saveCode = (code) => { try { code ? localStorage.setItem(KEY, code) : localStorage.removeItem(KEY); } catch {} };

async function call(path, { body, code = savedCode() } = {}) {
  let res;
  try {
    res = await fetch(`${HTTP_URL}/api${path}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...(code ? { Authorization: `Bearer ${code}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error("No se pudo conectar con el servidor"), { offline: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? "Error del servidor"), { status: res.status });
  return data;
}

// Momento local en que se podrán reclamar las fichas (el servidor manda cuánto falta; aquí solo se cuenta hacia atrás).
const withClock = (account) => ({ ...account, claimAt: Date.now() + (account.claim?.msLeft ?? 0) });

export async function loadAccount() {
  if (!savedCode()) return null;
  try { return withClock((await call("/account")).account); }
  catch (e) { if (e.status === 401) { saveCode(null); return null; } throw e; }
}
export async function createAccount(name) {
  const { account } = await call("/account", { body: { name }, code: null });
  saveCode(account.code);
  return withClock(account);
}
// Sincronización: usar en este dispositivo la cuenta de otro (reemplaza la de aquí).
export async function useSyncCode(code) {
  const { account } = await call("/account", { code });
  saveCode(account.code);
  return withClock(account);
}
export const renameAccount = async (name) => withClock((await call("/account/name", { body: { name } })).account);
export async function claimChips() {
  const r = await call("/chips/claim", { body: {} });
  return { ok: r.ok, account: withClock(r.account) };
}
export const accountFromServer = withClock; // cuenta actualizada que manda la sala al terminar la partida
