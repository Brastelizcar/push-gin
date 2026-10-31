// Cuentas de jugador: nombre, XP, fichas y última reclamación de fichas gratis.
// Dos implementaciones con la MISMA interfaz:
//   · PgStore     → PostgreSQL (Supabase u otro). Se usa si existe la variable de entorno DATABASE_URL.
//   · MemoryStore → en memoria (desarrollo local y pruebas). Se pierde al reiniciar el servidor.
// El reloj de las fichas gratis es SIEMPRE el del servidor/base de datos, nunca el del cliente.
import { randomBytes } from "node:crypto";
import { DAILY_CHIPS, claimStatus, levelInfo } from "../../../src/logic/progress.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
// Código de sincronización: 20 caracteres al azar (≈119 bits). Es la llave de la cuenta.
export function newSyncCode() {
  return [...randomBytes(20)].map((b) => ALPHABET[b % 62]).join("");
}
export const isSyncCode = (s) => typeof s === "string" && /^[A-Za-z0-9]{20}$/.test(s);
export const cleanName = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 16);

// Lo que ve el propio jugador de su cuenta.
export function publicAccount(acc, now = Date.now()) {
  return {
    name: acc.name, code: acc.code, xp: acc.xp, chips: acc.chips,
    ...levelInfo(acc.xp),
    claim: claimStatus(acc.lastClaimAt, now),
  };
}

export class MemoryStore {
  constructor({ now = () => Date.now() } = {}) { this.now = now; this.rows = new Map(); }
  async init() {}
  #copy(r) { return r ? { ...r } : null; }
  async create(name) {
    const acc = { id: newSyncCode(), code: newSyncCode(), name: cleanName(name) || "Jugador", xp: 0, chips: 0, lastClaimAt: null };
    this.rows.set(acc.id, acc);
    return this.#copy(acc);
  }
  async byCode(code) { return this.#copy([...this.rows.values()].find((r) => r.code === code)); }
  async byId(id) { return this.#copy(this.rows.get(id)); }
  async rename(id, name) { const r = this.rows.get(id); if (r) r.name = cleanName(name) || r.name; return this.#copy(r); }
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
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  xp            INTEGER NOT NULL DEFAULT 0,
  chips         INTEGER NOT NULL DEFAULT 0 CHECK (chips >= 0),
  last_claim_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

const fromRow = (r) => r && ({
  id: r.id, code: r.code, name: r.name, xp: Number(r.xp), chips: Number(r.chips),
  lastClaimAt: r.last_claim_at ? new Date(r.last_claim_at).getTime() : null,
});

export class PgStore {
  // pool: un Pool de "pg" (o compatible). Las consultas usan parámetros ($1…): nunca se concatena texto del cliente.
  constructor(pool) { this.pool = pool; }
  async init() { await this.pool.query(SCHEMA); }
  async create(name) {
    const { rows } = await this.pool.query(
      "INSERT INTO accounts (id, code, name) VALUES ($1, $2, $3) RETURNING *",
      [newSyncCode(), newSyncCode(), cleanName(name) || "Jugador"]);
    return fromRow(rows[0]);
  }
  async byCode(code) { return fromRow((await this.pool.query("SELECT * FROM accounts WHERE code = $1", [code])).rows[0]); }
  async byId(id) { return fromRow((await this.pool.query("SELECT * FROM accounts WHERE id = $1", [id])).rows[0]); }
  async rename(id, name) {
    const n = cleanName(name);
    if (!n) return this.byId(id);
    return fromRow((await this.pool.query("UPDATE accounts SET name = $2 WHERE id = $1 RETURNING *", [id, n])).rows[0]);
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
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }, // Supabase exige SSL
      max: 5,
    });
    return new PgStore(pool);
  }
  if (process.env.NODE_ENV === "production") console.warn("⚠️  Sin DATABASE_URL: las cuentas se guardan en memoria y se pierden al reiniciar.");
  return new MemoryStore();
}
// Devuelve la instancia única (la crea e inicializa la primera vez).
export async function initStore() {
  if (store) return store;
  starting ??= createStore().then(async (s) => { await s.init(); store = s; return s; });
  return starting;
}
export const setStore = (s) => { store = s; starting = null; }; // para pruebas
