// Tu cuenta. Este dispositivo guarda su TOKEN (el servidor solo guarda su hash) y lo envía en la cabecera
// Authorization. XP, nivel y fichas los decide el servidor: aquí solo se muestran.
import { HTTP_URL } from "./net.js";

const KEY = "pushgin:token";
export const savedToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const saveToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {} };
try { localStorage.removeItem("pushgin:code"); } catch {} // (formato anterior, ya no se usa)

async function call(path, { body, token = savedToken() } = {}) {
  let res;
  try {
    res = await fetch(`${HTTP_URL}/api${path}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  if (!savedToken()) return null;
  try { return withClock((await call("/account")).account); }
  catch (e) { if (e.status === 401) { saveToken(null); return null; } throw e; }
}
export async function createAccount(name) {
  const { account, token } = await call("/account", { body: { name }, token: null });
  saveToken(token);
  return withClock(account);
}
// Pide un código corto para entrar con esta cuenta en otro dispositivo (1 uso, vence a los 10 minutos).
export async function requestSyncCode() {
  const { code, expiresInMs } = await call("/sync/code", { body: {} });
  return { code, expiresAt: Date.now() + expiresInMs };
}
// Usa en ESTE dispositivo la cuenta del código (reemplaza la de aquí).
export async function redeemSyncCode(code) {
  const { account, token } = await call("/sync/redeem", { body: { code }, token: null });
  saveToken(token);
  return withClock(account);
}
export const renameAccount = async (name) => withClock((await call("/account/name", { body: { name } })).account);
export async function claimChips() {
  const r = await call("/chips/claim", { body: {} });
  return { ok: r.ok, account: withClock(r.account) };
}
export const accountFromServer = withClock; // cuenta actualizada que manda la sala al terminar la partida
