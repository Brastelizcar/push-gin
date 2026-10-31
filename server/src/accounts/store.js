// Cuentas de jugador: nombre, XP, fichas y última reclamación de fichas gratis.
//
// Seguridad:
//  · Cada dispositivo tiene su propio TOKEN (32 bytes al azar). El cliente lo guarda; la base de datos solo guarda su
//    HASH (SHA-256), así que una copia de la base de datos no permite entrar a ninguna cuenta.
//  · Sincronizar: un dispositivo con sesión pide un CÓDIGO CORTO (8 caracteres) que sirve una sola vez y vence a los
//    10 minutos; también se guarda solo su hash. Al canjearlo, el otro dispositivo recibe un token NUEVO.
//  · XP y fichas los decide SIEMPRE el servidor (premios de la partida, cuotas y fichas gratis con el reloj de la base
//    de datos). No existe ninguna ruta en la que el cliente diga cuánta XP o cuántas fichas tiene.
//
// Dos implementaciones con la MISMA interfaz:
//   · PgStore     → PostgreSQL (Neon u otro). Se usa si existe la variable de entorno DATABASE_URL.
//   · MemoryStore → en memoria (desarrollo local y pruebas). Se pierde al reiniciar el servidor.
import { randomBytes, randomInt, createHash } from "node:crypto";
import { DAILY_CHIPS, claimStatus, levelInfo } from "../../../src/logic/progress.js";
import { SYNC_ALPHABET, SYNC_CODE_LENGTH, SYNC_CODE_TTL_MS, normalizeSyncCode } from "../../../src/logic/sync.js";

export const hash = (s) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");            // 43 caracteres
export const isToken = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);
const newId = () => randomBytes(12).toString("base64url");
export function newSyncCode() {
  let s = "";
  for (let i = 0; i < SYNC_CODE_LENGTH; i++) s += SYNC_ALPHABET[randomInt(SYNC_ALPHABET.length)];
  return s;
}
export const cleanName = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 16);

// Lo que ve el propio jugador de su cuenta (sin ids internos ni secretos).
export function publicAccount(acc, now = Date.now()) {
  return {
    name: acc.name, xp: acc.xp, chips: acc.chips,
    ...levelInfo(acc.xp),
    claim: claimStatus(acc.lastClaimAt, now),
  };
}

export class MemoryStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.rows = new Map();       // id -> cuenta
    this.sessions = new Map();   // hash(token) -> id
    this.codes = new Map();      // hash(código) -> { id, expiresAt, usedAt }
  }
  async init() {}
  #copy(r) { return r ? { ...r } : null; }
  #session(id) { const token = newToken(); this.sessions.set(hash(token), id); return token; }

  async create(name) {
    const acc = { id: newId(), name: cleanName(name) || "Jugador", xp: 0, chips: 0, lastClaimAt: null };
    this.rows.set(acc.id, acc);
    return { account: this.#copy(acc), token: this.#session(acc.id) };
  }
  async byToken(token) {
    if (!isToken(token)) return null;
    return this.#copy(this.rows.get(this.sessions.get(hash(token))));
  }
  async byId(id) { return this.#copy(this.rows.get(id)); }
  async rename(id, name) { const r = this.rows.get(id); if (r) r.name = cleanName(name) || r.name; return this.#copy(r); }

  // Un código nuevo anula los anteriores sin usar de esa cuenta.
  async createSyncCode(id) {
    for (const [k, c] of this.codes) if (c.id === id && !c.usedAt) this.codes.delete(k);
    const code = newSyncCode(), now = this.now();
    this.codes.set(hash(code), { id, expiresAt: now + SYNC_CODE_TTL_MS, usedAt: null });
    return { code, expiresInMs: SYNC_CODE_TTL_MS };
  }
  async redeemSyncCode(input) {
    const code = normalizeSyncCode(input);
    const c = code && this.codes.get(hash(code));
    if (!c || c.usedAt || this.now() >= c.expiresAt) return null;
    c.usedAt = this.now();
    return { account: this.#copy(this.rows.get(c.id)), token: this.#session(c.id) };
  }

  async claim(id) {
    const r = this.rows.get(id);
    const now = this.now();
    const st = claimStatus(r.lastClaimAt, now);
    if (!st.canClaim) return { ok: false, msLeft: st.msLeft, account: this.#copy(r), now };
    r.chips += DAILY_CHIPS; r.lastClaimAt = now;
    return { ok: true, account: this.#copy(r), now };
  }
  // Cobra la cuota a TODOS o a nadie.
  async chargeFee(ids, fee) {
    if (fee <= 0) return true;
    const rows = ids.map((id) => this.rows.get(id));
    if (rows.some((r) => !r || r.chips < fee)) return false;
    rows.forEach((r) => (r.chips -= fee));
    return true;
  }
  async reward(list) { for (const { id, xp, chips } of list) { const r = this.rows.get(id); if (r) { r.xp += xp; r.chips += chips; } } }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  xp            INTEGER NOT NULL DEFAULT 0,
  chips         INTEGER NOT NULL DEFAULT 0 CHECK (chips >= 0),
  last_claim_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_codes (
  code_hash     TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ
);`;

const fromRow = (r) => r && ({
  id: r.id, name: r.name, xp: Number(r.xp), chips: Number(r.chips),
  lastClaimAt: r.last_claim_at ? new Date(r.last_claim_at).getTime() : null,
});

export class PgStore {
  // pool: un Pool de "pg" (o compatible). Las consultas usan parámetros ($1…): nunca se concatena texto del cliente.
  constructor(pool) { this.pool = pool; }
  async init() { await this.pool.query(SCHEMA); }
  async #session(id) {
    const token = newToken();
    await this.pool.query("INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)", [hash(token), id]);
    return token;
  }
  async create(name) {
    const { rows } = await this.pool.query(
      "INSERT INTO accounts (id, name) VALUES ($1, $2) RETURNING *", [newId(), cleanName(name) || "Jugador"]);
    const account = fromRow(rows[0]);
    return { account, token: await this.#session(account.id) };
  }
  async byToken(token) {
    if (!isToken(token)) return null;
    const { rows } = await this.pool.query(
      "SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1", [hash(token)]);
    return fromRow(rows[0]);
  }
  async byId(id) { return fromRow((await this.pool.query("SELECT * FROM accounts WHERE id = $1", [id])).rows[0]); }
  async rename(id, name) {
    const n = cleanName(name);
    if (!n) return this.byId(id);
    return fromRow((await this.pool.query("UPDATE accounts SET name = $2 WHERE id = $1 RETURNING *", [id, n])).rows[0]);
  }

  // El vencimiento se calcula con la hora de la base de datos.
  async createSyncCode(id) {
    await this.pool.query("DELETE FROM sync_codes WHERE account_id = $1 AND used_at IS NULL", [id]);
    await this.pool.query("DELETE FROM sync_codes WHERE expires_at < now() - interval '1 day'"); // limpieza
    const code = newSyncCode();
    await this.pool.query(
      "INSERT INTO sync_codes (code_hash, account_id, expires_at) VALUES ($1, $2, now() + interval '10 minutes')",
      [hash(code), id]);                                               // 10 min = SYNC_CODE_TTL_MS
    return { code, expiresInMs: SYNC_CODE_TTL_MS };
  }
  // Atómico: una sola sentencia marca el código como usado solo si no estaba usado ni vencido.
  async redeemSyncCode(input) {
    const code = normalizeSyncCode(input);
    if (!code) return null;
    const { rows } = await this.pool.query(
      `UPDATE sync_codes SET used_at = now()
        WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING account_id`, [hash(code)]);
    if (!rows[0]) return null;
    const id = rows[0].account_id;
    return { account: await this.byId(id), token: await this.#session(id) };
  }

  // Atómico: la condición de las 24 h se evalúa dentro del UPDATE, con la hora de la base de datos.
  async claim(id) {
    const { rows } = await this.pool.query(
      `UPDATE accounts SET chips = chips + $2::int, last_claim_at = now()
        WHERE id = $1 AND (last_claim_at IS NULL OR last_claim_at <= now() - interval '24 hours')
        RETURNING *, now() AS db_now`,
      [id, DAILY_CHIPS]);  // 24 h = CLAIM_INTERVAL_MS
    if (rows[0]) return { ok: true, account: fromRow(rows[0]), now: new Date(rows[0].db_now).getTime() };
    const cur = (await this.pool.query("SELECT *, now() AS db_now FROM accounts WHERE id = $1", [id])).rows[0];
    const now = new Date(cur.db_now).getTime();
    return { ok: false, account: fromRow(cur), now, msLeft: claimStatus(fromRow(cur).lastClaimAt, now).msLeft };
  }
  async chargeFee(ids, fee) {
    if (fee <= 0) return true;
    // Una sola sentencia (atómica): solo descuenta si TODOS tienen fichas suficientes.
    const list = ids.map((_, i) => `$${i + 2}`).join(", ");   // $2, $3, …: los ids van como parámetros
    const r = await this.pool.query(
      `UPDATE accounts SET chips = chips - $1::int
        WHERE id IN (${list})
          AND NOT EXISTS (SELECT 1 FROM accounts WHERE id IN (${list}) AND chips < $1::int)
        RETURNING id`,
      [fee, ...ids]);
    if (r.rowCount === ids.length) return true;
    // Alguna cuenta no existe (no debería pasar): se devuelve lo cobrado a las demás.
    await this.reward(r.rows.map(({ id }) => ({ id, xp: 0, chips: fee })));
    return false;
  }
  async reward(list) {
    for (const { id, xp, chips } of list)
      await this.pool.query("UPDATE accounts SET xp = xp + $2::int, chips = chips + $3::int WHERE id = $1", [id, xp, chips]);
  }
}

// ---------- instancia única del servidor ----------
let store = null;
let starting = null;
async function createStore() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon exige SSL con certificado válido. DATABASE_SSL=no-verify solo si tu proveedor usa un certificado propio.
      ssl: process.env.DATABASE_SSL === "false" ? false
        : { rejectUnauthorized: process.env.DATABASE_SSL !== "no-verify" },
      max: 5,
      idleTimeoutMillis: 30_000,   // suelta conexiones inactivas (Neon apaga el cómputo tras 5 min sin uso)
    });
    pool.on("error", (e) => console.error("Base de datos:", e.message)); // una conexión que Neon cierra no tumba el servidor
    return new PgStore(pool);
  }
  if (process.env.NODE_ENV === "production") console.warn("⚠️  Sin DATABASE_URL: las cuentas se guardan en memoria y se pierden al reiniciar.");
  return new MemoryStore();
}
// Devuelve la instancia única (la crea e inicializa la primera vez).
export async function initStore() {
  if (store) return store;
  starting ??= createStore()
    .then(async (s) => { await s.init(); store = s; return s; })
    .catch((e) => { starting = null; throw e; });   // si la base de datos no respondía, el siguiente intento reintenta
  return starting;
}
export const setStore = (s) => { store = s; starting = null; }; // para pruebas
