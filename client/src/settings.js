// Ajustes de este dispositivo (se guardan en el navegador).
const KEY = "pushgin:settings";
const DEFAULTS = { sounds: true, highlightLast: true };

let current = { ...DEFAULTS };
try { current = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch {}

export const settings = () => current;
export function setSetting(key, value) {
  current = { ...current, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch {}
  apply();
}
// "Resaltar último movimiento" se aplica con una clase en <body> (ver .no-highlight en menus.css).
function apply() {
  if (typeof document !== "undefined") document.body.classList.toggle("no-highlight", !current.highlightLast);
}
apply();
