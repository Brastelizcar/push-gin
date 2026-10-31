import test from "node:test";
import assert from "node:assert/strict";
import { formatCountdown, normalizeSyncCode, formatSyncCode } from "../src/format.js";

test("cuenta regresiva de las fichas gratis", () => {
  assert.equal(formatCountdown(0), "00:00:00");
  assert.equal(formatCountdown(-5000), "00:00:00");
  assert.equal(formatCountdown(1), "00:00:01");                     // redondea hacia arriba: nunca muestra 0 antes de tiempo
  assert.equal(formatCountdown((18 * 3600 + 22 * 60 + 39) * 1000), "18:22:39");
  assert.equal(formatCountdown(24 * 3600 * 1000), "24:00:00");
});

test("cuenta regresiva corta del código de sincronización (10 minutos)", () => {
  assert.equal(formatCountdown(600_000, { short: true }), "10:00");
  assert.equal(formatCountdown(59_500, { short: true }), "01:00");
  assert.equal(formatCountdown(3_600_000, { short: true }), "01:00:00");
});

test("el código de sincronización se acepta escrito como sea", () => {
  assert.equal(normalizeSyncCode("abcd-efgh"), "ABCDEFGH");
  assert.equal(normalizeSyncCode("x3UqFcGuT9x68vQGLPxB"), null);   // el formato largo anterior ya no sirve
  assert.equal(formatSyncCode("ABCDEFGH"), "ABCD-EFGH");
});
