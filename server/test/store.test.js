import assert from "assert";
import { newDb } from "pg-mem";
import { MemoryStore, PgStore, publicAccount, hash, isToken } from "../src/accounts/store.js";
import { formatSyncCode, normalizeSyncCode } from "../../src/logic/sync.js";

// Las mismas pruebas para las dos implementaciones (la de PostgreSQL corre sobre pg-mem, una base en memoria).
// `expire(code)` simula que pasaron los 10 minutos.
const makers = {
  MemoryStore: async () => {
    let t = 1_000_000;
    const s = new MemoryStore({ now: () => t });
    s.expire = async () => { t += 10 * 60 * 1000; };
    return s;
  },
  PgStore: async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const s = new PgStore(pool);
    await s.init();
    s.raw = pool;
    s.expire = async (code) => pool.query("UPDATE sync_codes SET expires_at = now() - interval '1 second' WHERE code_hash = $1", [hash(code)]);
    return s;
  },
};

for (const [label, make] of Object.entries(makers)) {
  describe(`cuentas (${label})`, () => {
    let s;
    beforeEach(async () => (s = await make()));

    it("crear cuenta da un token; con el token se encuentra la cuenta", async () => {
      const { account: a, token } = await s.create("  Ana   María  ");
      assert.equal(a.name, "Ana María");
      assert.ok(isToken(token));
      assert.equal(a.xp, 0);
      assert.equal(a.chips, 0);
      assert.deepEqual(await s.byToken(token), a);
      assert.equal(await s.byToken("x".repeat(43)), null);
      assert.equal(await s.byToken("corto"), null);
    });

    it("renombra (y no acepta nombres vacíos)", async () => {
      const { account: a } = await s.create("Ana");
      assert.equal((await s.rename(a.id, "Luisa")).name, "Luisa");
      assert.equal((await s.rename(a.id, "   ")).name, "Luisa");
    });

    it("sincronización: el código corto da un token NUEVO para el otro dispositivo y sirve una sola vez", async () => {
      const { account: a, token: t1 } = await s.create("Ana");
      const { code, expiresInMs } = await s.createSyncCode(a.id);
      assert.equal(expiresInMs, 600_000);
      assert.equal(normalizeSyncCode(code), code);
      const r = await s.redeemSyncCode(formatSyncCode(code).toLowerCase()); // se acepta escrito como sea
      assert.equal(r.account.id, a.id);
      assert.notEqual(r.token, t1);
      assert.equal((await s.byToken(r.token)).id, a.id);                  // los dos dispositivos siguen entrando
      assert.equal((await s.byToken(t1)).id, a.id);
      assert.equal(await s.redeemSyncCode(code), null);                   // segundo uso: no
    });

    it("sincronización: vence a los 10 minutos, y pedir otro código anula el anterior", async () => {
      const { account: a } = await s.create("Ana");
      const c1 = (await s.createSyncCode(a.id)).code;
      const c2 = (await s.createSyncCode(a.id)).code;
      assert.equal(await s.redeemSyncCode(c1), null);                     // anulado por el nuevo
      await s.expire(c2);
      assert.equal(await s.redeemSyncCode(c2), null);                     // vencido
      assert.equal(await s.redeemSyncCode("no-sirve"), null);
    });

    it("fichas gratis: 300 al reclamar y no otra vez antes de 24 h", async () => {
      const { account: a } = await s.create("Ana");
      const r1 = await s.claim(a.id);
      assert.equal(r1.ok, true);
      assert.equal(r1.account.chips, 300);
      const r2 = await s.claim(a.id);
      assert.equal(r2.ok, false);
      assert.ok(r2.msLeft > 23 * 3600 * 1000);
      assert.equal(r2.account.chips, 300);
    });

    it("cuota de entrada: se cobra a todos o a nadie", async () => {
      const { account: a } = await s.create("Ana"), { account: b } = await s.create("Luis");
      await s.claim(a.id);                               // Ana 300, Luis 0
      assert.equal(await s.chargeFee([a.id, b.id], 100), false);
      assert.equal((await s.byId(a.id)).chips, 300);     // a Ana no se le cobró
      await s.claim(b.id);
      assert.equal(await s.chargeFee([a.id, b.id], 100), true);
      assert.equal((await s.byId(a.id)).chips, 200);
      assert.equal((await s.byId(b.id)).chips, 200);
      assert.equal(await s.chargeFee([a.id], 0), true);  // sin cuota, siempre vale
      assert.equal(await s.chargeFee([a.id, "no-existe"], 100), false); // cuenta inexistente: no se cobra a nadie
      assert.equal((await s.byId(a.id)).chips, 200);
    });

    it("premios: suma XP y fichas; la vista pública no expone ids ni secretos", async () => {
      const { account: a } = await s.create("Ana");
      await s.reward([{ id: a.id, xp: 100, chips: 250 }]);
      await s.reward([{ id: a.id, xp: 50, chips: 0 }]);
      const acc = await s.byId(a.id);
      assert.equal(acc.xp, 150);
      assert.equal(acc.chips, 250);
      const pub = publicAccount(acc);
      assert.equal(pub.level, 2);
      assert.equal(pub.into, 50);
      assert.deepEqual(Object.keys(pub).sort(), ["chips", "claim", "into", "level", "name", "needed", "xp"]);
    });
  });
}

describe("cuentas (PgStore): la base de datos guarda solo hashes", () => {
  it("ni el token ni el código de sincronización quedan guardados en claro", async () => {
    const s = await makers.PgStore();
    const { account, token } = await s.create("Ana");
    const { code } = await s.createSyncCode(account.id);
    const dump = JSON.stringify([
      (await s.raw.query("SELECT * FROM accounts")).rows,
      (await s.raw.query("SELECT * FROM sessions")).rows,
      (await s.raw.query("SELECT * FROM sync_codes")).rows,
    ]);
    assert.ok(!dump.includes(token));
    assert.ok(!dump.includes(code));
    assert.ok(dump.includes(hash(token)));
    assert.ok(dump.includes(hash(code)));
  });
});

describe("cuentas: reloj del servidor (MemoryStore con reloj controlado)", () => {
  it("se puede reclamar otra vez exactamente a las 24 h", async () => {
    let t = 1_000_000;
    const s = new MemoryStore({ now: () => t });
    const { account: a } = await s.create("Ana");
    await s.claim(a.id);
    t += 24 * 3600 * 1000 - 1;
    assert.equal((await s.claim(a.id)).ok, false);
    t += 1;
    assert.equal((await s.claim(a.id)).account.chips, 600);
  });

  it("el código de sincronización todavía sirve 1 ms antes de vencer", async () => {
    let t = 0;
    const s = new MemoryStore({ now: () => t });
    const { account: a } = await s.create("Ana");
    const { code } = await s.createSyncCode(a.id);
    t += 10 * 60 * 1000 - 1;
    assert.ok(await s.redeemSyncCode(code));
  });
});
