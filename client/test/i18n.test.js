import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { EN } from "../src/en.js";
import { t, setLang, getLang } from "../src/i18n.js";

const root = new URL("../../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");
const jsIn = (dir) => readdirSync(new URL(dir, root), { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => `${dir}/${f.replaceAll("\\", "/")}`);
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;

// Todos los textos que la interfaz puede mostrar: t("…") y toast("…") del cliente, y los errores del servidor.
function allKeys() {
  const keys = new Set();
  for (const f of jsIn("client/src").filter((f) => !f.endsWith("en.js"))) {
    const s = read(f);
    for (const re of [String.raw`\bt\(\s*` + STR, String.raw`\btoast\(\s*` + STR]) for (const m of s.matchAll(new RegExp(re, "g"))) keys.add(m[1]);
    for (const re of [String.raw`\b(?:t|toast)\(\s*[\w.>=!\s()?]+\?\s*` + STR + String.raw`\s*:\s*` + STR])
      for (const m of s.matchAll(new RegExp(re, "g"))) { keys.add(m[1]); keys.add(m[2]); }
    for (const m of s.matchAll(/\bt\(\[([^\]]*)\]/g)) for (const k of m[1].matchAll(new RegExp(STR, "g"))) keys.add(k[1]);
  }
  for (const f of [...jsIn("src/logic"), ...jsIn("server/src")]) {
    const s = read(f);
    for (const re of [/fail\(\s*'([^']*)'/g, /#reject\(client, "([^"]*)"/g, /json\(\{ error: "([^"]*)"/g, /new Error\("([^"]*)"/g])
      for (const m of s.matchAll(re)) keys.add(m[1]);
    for (const m of s.matchAll(/fail\(phase === 'start' \? '([^']*)' : '([^']*)'/g)) { keys.add(m[1]); keys.add(m[2]); }
  }
  for (const k of ["timeout", "Mazo vacío (no debería pasar con 3 barajas)", "Se juega de 2 a 4 jugadores"]) keys.delete(k);
  return [...keys];
}

test("i18n: todo texto visible tiene traducción al inglés", () => {
  const keys = allKeys();
  assert.ok(keys.length > 300, `se esperaban más de 300 textos y se encontraron ${keys.length}`);
  const missing = keys.filter((k) => !(k in EN));
  assert.deepEqual(missing, [], "faltan en client/src/en.js");
});

test("i18n: las traducciones usan los mismos {marcadores} que el español", () => {
  const marks = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const [es, en] of Object.entries(EN)) assert.equal(marks(en), marks(es), `marcadores distintos en "${es}"`);
});

test("i18n: t() traduce, reemplaza datos y deja igual lo desconocido", () => {
  const before = getLang();
  setLang("es");
  assert.equal(t("Ronda {n} de {total}", { n: 2, total: 5 }), "Ronda 2 de 5");
  setLang("en");
  assert.equal(t("Ronda {n} de {total}", { n: 2, total: 5 }), "Round 2 of 5");
  assert.equal(t("No es tu turno"), "It's not your turn");                         // error del servidor
  assert.equal(t("No tienen fichas suficientes para la cuota: Ana, Luis"), "Not enough chips for the entry fee: Ana, Luis");
  assert.equal(t("Rosa"), "Rosa");                                                  // nombres: sin cambios
  assert.equal(t(t("Ajustes")), "Settings");                                        // traducir dos veces no rompe
  setLang("xx");                                                                    // idioma desconocido: se ignora
  assert.equal(getLang(), "en");
  setLang(before);
});
