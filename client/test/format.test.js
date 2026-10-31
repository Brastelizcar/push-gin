import test from "node:test";
import assert from "node:assert/strict";
import { formatCountdown, isSyncCode } from "../src/format.js";

test("cuenta regresiva de las fichas gratis", () => {
  assert.equal(formatCountdown(0), "00:00:00");
  assert.equal(formatCountdown(-5000), "00:00:00");
  assert.equal(formatCountdown(1), "00:00:01");                     // redondea hacia arriba: nunca muestra 0 antes de tiempo
  assert.equal(formatCountdown((18 * 3600 + 22 * 60 + 39) * 1000), "18:22:39");
  assert.equal(formatCountdown(24 * 3600 * 1000), "24:00:00");
});

test("código de sincronización: 20 letras o números", () => {
  assert.equal(isSyncCode("x3UqFcGuT9x68vQGLPxB"), true);
  assert.equal(isSyncCode("x3UqFcGuT9x68vQGLPx"), false);
  assert.equal(isSyncCode("x3UqFcGuT9x68vQGLP-B"), false);
  assert.equal(isSyncCode(null), false);
});
