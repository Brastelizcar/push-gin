import assert from "assert";
import { newDb } from "pg-mem";
import { MemoryStore, PgStore, publicAccount, isSyncCode, newSyncCode } from "../src/accounts/store.js";

// Las mismas pruebas para las dos implementaciones (la de PostgreSQL corre sobre pg-mem, una base en memoria).
const makers = {
  MemoryStore: async () => new MemoryStore(),
  PgStore: async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const s = new PgStore(new Pool());
    await s.init();
    return s;
  },
};

for (const [label, make] of Object.entries(makers)) {
  describe(`cuentas (${label})`, () => {
    let s;
    beforeEach(async () => (s = await make()));

    it("crea una cuenta con código de sincronización y la encuentra por ese código", async () => {
      const a = await s.create("  Ana   María  ");
      assert.equal(a.name, "Ana María");
      assert.ok(isSyncCode(a.code));
      assert.equal(a.xp, 0);
      assert.equal(a.chips, 0);
      assert.deepEqual(await s.byCode(a.code), a);
      assert.equal(await s.byCode(newSyncCode()), null);
    });

    it("renombra (y no acepta nombres vacíos)", async () => {
      const a = await s.create("Ana");
      assert.equal((await s.rename(a.id, "Luisa")).name, "Luisa");
      assert.equal((await s.rename(a.id, "   ")).name, "Luisa");
    });

    it("fichas gratis: 300 al reclamar y no otra vez antes de 24 h", async () => {
      const a = await s.create("Ana");
      const r1 = await s.claim(a.id);
      assert.equal(r1.ok, true);
      assert.equal(r1.account.chips, 300);
      const r2 = await s.claim(a.id);
      assert.equal(r2.ok, false);
      assert.ok(r2.msLeft > 23 * 3600 * 1000);
      assert.equal(r2.account.chips, 300);
    });

    it("cuota de entrada: se cobra a todos o a nadie", async () => {
      const a = await s.create("Ana"), b = await s.create("Luis");
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

    it("premios: suma XP y fichas", async () => {
      const a = await s.create("Ana");
      await s.reward([{ id: a.id, xp: 100, chips: 250 }]);
      await s.reward([{ id: a.id, xp: 50, chips: 0 }]);
      const acc = await s.byId(a.id);
      assert.equal(acc.xp, 150);
      assert.equal(acc.chips, 250);
      const pub = publicAccount(acc);
      assert.equal(pub.level, 2);
      assert.equal(pub.into, 50);
      assert.equal(pub.claim.canClaim, true);
      assert.equal(pub.id, undefined);                   // el id interno no se expone
    });
  });
}

describe("cuentas: reloj del servidor (MemoryStore con reloj controlado)", () => {
  it("se puede reclamar otra vez exactamente a las 24 h", async () => {
    let t = 1_000_000;
    const s = new MemoryStore({ now: () => t });
    const a = await s.create("Ana");
    await s.claim(a.id);
    t += 24 * 3600 * 1000 - 1;
    assert.equal((await s.claim(a.id)).ok, false);
    t += 1;
    assert.equal((await s.claim(a.id)).account.chips, 600);
  });
});
