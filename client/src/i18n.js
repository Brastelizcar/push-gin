// Idioma de la interfaz: español (es) o inglés (en). El texto en ESPAÑOL es la clave: t("Ronda {n} de {total}", { n, total })
// devuelve el español tal cual, o su traducción de en.js. Si falta una traducción se muestra en español (la prueba
// client/test/i18n.test.js avisa si queda alguna sin traducir). Los errores que manda el servidor también llegan en
// español y se traducen aquí con la misma tabla.
import { EN } from "./en.js";

export const LANGS = ["es", "en"];
const KEY = "pushgin:lang";

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGS.includes(saved)) return saved;
  } catch {}
  const nav = typeof navigator !== "undefined" ? navigator.language ?? "es" : "es";
  return nav.toLowerCase().startsWith("en") ? "en" : "es";
}

let lang = initial();
if (typeof document !== "undefined") document.documentElement.lang = lang;

export const getLang = () => lang;
export function setLang(next) {
  if (!LANGS.includes(next)) return;
  lang = next;
  try { localStorage.setItem(KEY, next); } catch {}
  if (typeof document !== "undefined") document.documentElement.lang = next;
}

// Claves que terminan en {rest}: prefijos de mensajes del servidor que traen datos al final (ej. nombres).
const PREFIXES = Object.keys(EN).filter((k) => k.endsWith("{rest}")).map((k) => [k.slice(0, -6), EN[k]]);

// Traduce `text` y reemplaza {nombre} por vars.nombre.
export function t(text, vars) {
  let s = text;
  if (lang === "en" && typeof text === "string") {
    s = EN[text];
    if (s === undefined) {
      const p = PREFIXES.find(([es]) => text.startsWith(es));
      s = p ? p[1].replace("{rest}", text.slice(p[0].length)) : text;
    }
  }
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

// Números con separador de miles del idioma (1.000 / 1,000).
export const num = (n) => Number(n).toLocaleString(lang === "en" ? "en-US" : "es-CO");
