// Construye DOM con textContent (nunca innerHTML): los nombres vienen de otros jugadores.
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
export function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---------- pantalla completa ----------
// (En iPhone/Safari la API no existe: el botón no se muestra. Ahí sirve "Añadir a pantalla de inicio".)
export function fsButton(extraClass = "") {
  if (!document.fullscreenEnabled) return null;
  const btn = h("button", { class: `fs-btn ${extraClass}`, title: "Pantalla completa", "aria-label": "Pantalla completa" }, "⛶");
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
document.addEventListener("fullscreenchange", () => {
  const on = !!document.fullscreenElement;
  document.querySelectorAll(".fs-btn").forEach((b) => (b.textContent = on ? "🗗" : "⛶"));
});

// ---------- tamaño de las cartas (S / M / L), se recuerda en el navegador ----------
const SIZES = { S: 0.85, M: 1, L: 1.18 };
let sizeKey = "M";
try { const k = localStorage.getItem("pushgin:size"); if (k in SIZES) sizeKey = k; } catch {}
const applySize = () => document.documentElement.style.setProperty("--ui-scale", SIZES[sizeKey]);
applySize();
export function sizeButton(onChange) {
  const btn = h("button", { class: "fs-btn size-btn", "aria-label": "Tamaño de las cartas" }, "Aa");
  const label = () => (btn.title = `Tamaño de las cartas: ${sizeKey === "S" ? "pequeño" : sizeKey === "M" ? "mediano" : "grande"} (toca para cambiar)`);
  label();
  btn.addEventListener("click", () => {
    sizeKey = sizeKey === "S" ? "M" : sizeKey === "M" ? "L" : "S";
    try { localStorage.setItem("pushgin:size", sizeKey); } catch {}
    applySize(); label(); toast(`Cartas ${sizeKey === "S" ? "pequeñas" : sizeKey === "M" ? "medianas" : "grandes"}`);
    onChange?.();
  });
  return btn;
}
