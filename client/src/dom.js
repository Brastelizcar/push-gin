// Construye DOM con textContent (nunca innerHTML): los nombres vienen de otros jugadores.
import { t } from "./i18n.js";
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

let toastTimer;
// Los avisos se traducen solos (sirve para los errores que manda el servidor, que llegan en español).
export function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = t(msg);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---------- pantalla completa ----------
// (En iPhone/Safari la API no existe: el botón no se muestra. Ahí sirve "Añadir a pantalla de inicio".)
export function fsButton(extraClass = "") {
  if (!document.fullscreenEnabled) return null;
  const btn = h("button", { class: `fs-btn ${extraClass}`, title: t("Pantalla completa"), "aria-label": t("Pantalla completa") }, "⛶");
  btn.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen();
        // En móvil Android, al entrar a pantalla completa se puede fijar horizontal (si el navegador lo permite).
        try { await screen.orientation.lock("landscape"); } catch {}
      }
    } catch { toast("Tu navegador no permite pantalla completa"); }
  });
  return btn;
}
// (el botón ☰ del menú usa el mismo estilo .fs-btn: no se toca)
if (typeof document !== "undefined") document.addEventListener("fullscreenchange", () => {
  const on = !!document.fullscreenElement;
  document.querySelectorAll(".fs-btn:not(.menu-btn)").forEach((b) => (b.textContent = on ? "🗗" : "⛶"));
});


// Imagen de un avatar (1 a 10, en client/public/avatars): retrato redondo con fondo vino tinto, sin aro.
// ASSETS_V va en la dirección: súbelo cada vez que cambies una imagen, para que el navegador no muestre la vieja
// (GitHub Pages deja guardadas las imágenes 10 minutos).
export const ASSETS_V = 2;
export const avatarSrc = (n) => `${import.meta.env.BASE_URL}avatars/avatar-${n}.webp?v=${ASSETS_V}`;
export const avatarImg = (n, alt = "") => h("img", { class: "avatar-img", src: avatarSrc(n), alt, draggable: "false" });

// La ficha (moneda) del juego: client/public/coin.webp (de docs/referencias/ICONO MONEDA.png).
export const coinImg = (cls = "chip-coin") =>
  h("img", { class: cls, src: `${import.meta.env.BASE_URL}coin.webp?v=${ASSETS_V}`, alt: "", "aria-hidden": "true", draggable: "false" });
