import "./style.css";
import { connect, actions, wakeServer, IS_REMOTE, SERVER_CONFIGURED } from "./net.js";
import { h, toast, fsButton } from "./dom.js";
import { renderTable, handleRejected, playPushAnimation, notePush, notePlay } from "./table.js";

const app = document.getElementById("app");

let room = null;
let view = null;
let busy = false;
let status = null;                 // mensaje bajo los botones mientras se conecta
let serverReady = !IS_REMOTE;      // en internet, el servidor gratuito puede estar dormido al abrir la página
if (IS_REMOTE) wakeServer().then(() => { serverReady = true; if (!room) renderEntry(); });
const onRejectedHook = () => { handleRejected(); render(); };

// ---------- utilidades ----------
const frame = (...content) =>
  h("div", { class: "table-frame" }, h("div", { class: "felt" }, fsButton("fs-corner"), ...content));

// ---------- pantallas ----------
function renderEntry() {
  const saved = localStorage.getItem("pushgin:name") ?? "";
  const nameInput = h("input", { id: "name", placeholder: "Tu nombre", maxlength: "16", value: saved, autocomplete: "off" });
  const codeInput = h("input", { id: "code", placeholder: "Código de 4 dígitos", inputmode: "numeric", maxlength: "4", autocomplete: "off" });
  codeInput.addEventListener("input", () => (codeInput.value = codeInput.value.replace(/\D/g, "")));

  const getName = () => {
    const n = nameInput.value.trim();
    if (!n) { toast("Escribe tu nombre"); nameInput.focus(); return null; }
    localStorage.setItem("pushgin:name", n);
    return n;
  };
  const create = () => { const name = getName(); if (name) join({ mode: "create", name }); };
  const joinWithCode = () => {
    const name = getName(); if (!name) return;
    if (!/^\d{4}$/.test(codeInput.value)) { toast("El código tiene 4 dígitos"); codeInput.focus(); return; }
    join({ mode: "join", name, code: codeInput.value });
  };

  app.replaceChildren(
    frame(
      h("h1", {}, "Push Gin"),
      h("div", { class: "tagline" }, "De 2 a 4 jugadores · 5 rondas"),
      h("div", {}, h("label", { for: "name" }, "Tu nombre"), nameInput),
      h("button", { class: "primary", onclick: create, disabled: busy }, "Crear sala"),
      h("div", { class: "divider" }, "o únete a una"),
      h("div", {}, h("label", { for: "code" }, "Código de sala"), codeInput),
      h("button", { onclick: joinWithCode, disabled: busy }, "Unirme"),
      (status ?? (serverReady ? null : "Despertando el servidor… la primera vez puede tardar hasta 1 minuto."))
        ? h("div", { class: "hint wake" }, status ?? "Despertando el servidor… la primera vez puede tardar hasta 1 minuto.") : null
    )
  );
}

function renderLobby() {
  const isHost = view.host === view.you;
  const canStart = isHost && view.players.length >= 2;
  const list = view.players.map((p) =>
    h("div", { class: "p-row" + (p.id === view.you ? " me" : "") },
      h("div", { class: "avatar" }, (p.name || "?")[0].toUpperCase()),
      h("div", { class: "p-name" }, p.name, p.id === view.you ? " (tú)" : ""),
      p.id === view.host ? h("span", { class: "badge" }, "Anfitrión") : null
    )
  );
  app.replaceChildren(
    frame(
      h("h1", {}, "Sala de espera"),
      h("div", { class: "code-box" },
        h("div", { class: "lbl" }, "Código de sala"),
        h("div", { class: "code" }, room.roomId)),
      h("div", { class: "hint" }, "Comparte este código con los otros jugadores"),
      h("div", { class: "players" }, list),
      isHost ? h("button", { class: "primary", disabled: !canStart, onclick: () => actions.start(room) }, "Empezar partida") : null,
      h("div", { class: "hint" },
        isHost
          ? (view.players.length < 2 ? "Esperando al menos un jugador más…" : `Jugadores: ${view.players.length} de 4`)
          : "Esperando a que el anfitrión empiece…")
    )
  );
}

function render() {
  const inGame = room && view && view.phase !== "lobby";
  app.classList.toggle("wide", !!inGame);
  if (!room || !view) return renderEntry();
  if (view.phase === "lobby") return renderLobby();
  renderTable(app, { view, room, rerender: render });
}

// ---------- conexión ----------
async function join(opts) {
  if (!SERVER_CONFIGURED) return toast("Falta poner la dirección del servidor en client/.env.production");
  busy = true; status = null; renderEntry();
  // Si tarda, el servidor estaba dormido: se le explica al jugador en vez de dejarlo esperando sin saber.
  const slow = setTimeout(() => { status = "Despertando el servidor… puede tardar hasta 1 minuto, no cierres la página."; if (!room) renderEntry(); }, 4000);
  try {
    room = await connect(opts, {
      onWaking: (n) => { status = `El servidor sigue despertando… (intento ${n + 1} de 4)`; renderEntry(); },
      onState: (v) => { view = v; render(); },
      onEvent: (ev) => {
        if (!view) return;
        const name = (id) => (id === view.you ? "Tú" : view.players.find((p) => p.id === id)?.name ?? "alguien");
        const played = ev.type === "turn" && (ev.planted || ev.laid || ev.hooked);
        if (played && ev.by !== view.you) notePlay(ev.by); // anima sus cartas hacia la mesa
        if (ev.type === "push") {
          toast(`${name(ev.by)} hizo push: ${ev.to === view.you ? "recibes" : name(ev.to) + " recibe"} 2 cartas`);
          notePush({ by: ev.by, to: ev.to, anim: playPushAnimation({ card: view.discardTop, toPid: ev.to, me: view.you }) });
        } else if (ev.type === "turn" && ev.planted) toast(ev.by === view.you ? "¡Te plantaste!" : `${name(ev.by)} se plantó`);
        else if (played && ev.by !== view.you) toast(`${name(ev.by)} ${ev.laid ? "bajó una combinación" : "enganchó en la mesa"}`);
        else if (ev.type === "steal") {
          toast(ev.by === view.you ? "Robaste un 2: este turno no puedes plantarte"
            : ev.victim === view.you ? `${name(ev.by)} te robó un 2`
            : `${name(ev.by)} le robó un 2 a ${name(ev.victim)}`);
        }
      },
      onRejected: (error) => { toast(error); onRejectedHook(); },
      onLeave: () => { room = null; view = null; toast("Te desconectaste de la sala"); render(); },
    });
  } catch (e) {
    room = null; view = null;
    const msg = String(e?.message ?? e);
    toast(/not found|locked|INVALID_ROOM_ID/i.test(msg) ? "Código no válido o sala ya iniciada" : "No se pudo conectar al servidor");
  } finally {
    clearTimeout(slow);
    busy = false; status = null;
    if (!room) renderEntry();
  }
}

render();
