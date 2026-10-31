import "./style.css";
import { connect, actions, wakeServer, IS_REMOTE, SERVER_CONFIGURED } from "./net.js";
import { h, toast } from "./dom.js";
import { renderTable, handleRejected, playPushAnimation, notePush, notePlay, setTableHooks } from "./table.js";
import { loadAccount, createAccount, useSyncCode, claimChips, accountFromServer } from "./account.js";
import { welcomeScreen, mainMenu, privateMenu, waitingRoom, renderModal, tickCountdowns } from "./menus.js";
import { play } from "./sound.js";

const app = document.getElementById("app");

// ---------- estado de la aplicación ----------
let screen = "loading";          // loading | welcome | menu | private (sin sala) — con sala manda la fase de la vista
let account = null;              // tu cuenta (del servidor)
let offline = false;             // no se pudo cargar la cuenta
let modal = null;                // ventana abierta sobre el menú: settings | sync | rules | help
let room = null;
let view = null;
let busy = false;
let status = null;               // mensaje mientras se conecta / despierta el servidor
let fee = 0;                     // cuota elegida en "Juego privado"
let leaving = false;             // saliste tú de la sala (no mostrar "te desconectaste")

const setScreen = (s) => { screen = s; modal = null; render(); };

// ---------- cuenta ----------
async function refreshAccount() {
  offline = false;
  try {
    account = await loadAccount();
    if (!account && screen === "loading") screen = "welcome";
    else if (screen === "loading") screen = "menu";
  } catch {
    offline = true;
    if (screen === "loading") screen = "menu";
  }
  render();
}

async function withBusy(fn, slowMsg = "Despertando el servidor… la primera vez puede tardar hasta 1 minuto.") {
  busy = true; status = null; render();
  const slow = setTimeout(() => { status = slowMsg; render(); }, 3000);
  try { return await fn(); }
  catch (e) { toast(e.message ?? "Algo salió mal"); }
  finally { clearTimeout(slow); busy = false; status = null; render(); }
}

const onCreateAccount = (name) => withBusy(async () => { account = await createAccount(name); screen = "menu"; });
const onUseCode = (code) => withBusy(async () => { account = await useSyncCode(code); modal = null; screen = "menu"; toast(`Ahora juegas como ${account.name}`); });
const onClaim = () => withBusy(async () => {
  const r = await claimChips();
  account = r.account;
  toast(r.ok ? "¡Recibiste 300 fichas!" : "Todavía no puedes reclamar");
  if (r.ok) play("ok");
});

// ---------- salas ----------
async function join(opts) {
  if (!SERVER_CONFIGURED) return toast("Falta poner la dirección del servidor en client/.env.production");
  if (!account) return toast(offline ? "Sin conexión con el servidor" : "Primero crea tu cuenta");
  leaving = false;
  await withBusy(async () => {
    try {
      room = await connect({ ...opts, name: account.name, account: account.code }, {
        onWaking: (n) => { status = `El servidor sigue despertando… (intento ${n + 1} de 4)`; render(); },
        onState: (v) => {
          const myTurnNow = v.phase === "playing" && v.current === v.you && v.turnPhase === "start";
          const wasMyTurn = view?.phase === "playing" && view.current === view.you;
          view = v;
          if (myTurnNow && !wasMyTurn) play("turn");
          render();
        },
        onEvent,
        onAccount: (acc) => { account = accountFromServer(acc); render(); },
        onRejected: (error) => { toast(error); play("bad"); handleRejected(); render(); },
        onLeave: () => {
          if (!leaving) toast("Te desconectaste de la sala");
          room = null; view = null; screen = "menu"; render();
        },
      });
    } catch (e) {
      room = null; view = null;
      const msg = String(e?.message ?? e);
      throw new Error(/not found|locked|INVALID_ROOM_ID/i.test(msg) ? "Código no válido o la partida ya empezó"
        : /cuota|cuenta|sala/i.test(msg) ? msg : "No se pudo conectar al servidor");
    }
  }, "Conectando… si el servidor estaba dormido puede tardar hasta 1 minuto.");
}

function onEvent(ev) {
  if (!view) return;
  const name = (id) => (id === view.you ? "Tú" : view.players.find((p) => p.id === id)?.name ?? "alguien");
  const played = ev.type === "turn" && (ev.planted || ev.laid || ev.hooked);
  if (played && ev.by !== view.you) notePlay(ev.by); // anima sus cartas hacia la mesa
  if (played && ev.by === view.you) play("ok");
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
}

function leaveRoom() {
  leaving = true;
  room?.leave();
  room = null; view = null; screen = "menu";
  refreshAccount();
}

// La mesa avisa cuando el jugador quiere volver al menú al terminar la partida.
setTableHooks({ onExit: leaveRoom, play });

// ---------- render ----------
function render() {
  const inTable = room && view && view.phase !== "lobby";
  app.classList.toggle("wide", !!inTable);
  app.classList.toggle("menu", !inTable && screen !== "welcome");
  if (inTable) return renderTable(app, { view, room, rerender: render });
  if (room && view) return app.replaceChildren(waitingRoom({ view, onStart: () => actions.start(room), onLeave: leaveRoom }));

  let page;
  if (screen === "loading") page = h("div", { class: "hint" }, "Cargando…");
  else if (screen === "welcome") page = welcomeScreen({ busy, status, onCreate: onCreateAccount, onSync: () => { modal = "sync"; render(); } });
  else if (screen === "private") {
    page = privateMenu({
      account, fee, busy, status,
      onFee: (f) => { fee = f; render(); },
      onInvite: () => join({ mode: "create", entryFee: fee }),
      onJoin: (roomCode) => join({ mode: "join", roomCode }),
      onBack: () => setScreen("menu"),
      onSettings: () => { modal = "settings"; render(); },
    });
  } else {
    page = mainMenu({
      account, offline, onRetry: refreshAccount,
      onPrivate: () => setScreen("private"),
      onPractice: () => toast("El modo práctica llega en el siguiente lote"),
      onSettings: () => { modal = "settings"; render(); },
      onRules: () => { modal = "rules"; render(); },
      onClaim,
    });
  }
  const close = () => { modal = null; render(); };
  const overlay = modal && renderModal(modal, {
    account, onClose: close, onUseCode,
    onSync: () => { modal = "sync"; render(); },
    onRules: () => { modal = "rules"; render(); },
    onHelp: () => { modal = "help"; render(); },
  });
  app.replaceChildren(page, ...(overlay ? [overlay] : []));
  if (status && screen !== "welcome" && screen !== "private") app.append(h("div", { class: "hint wake" }, status));
}

// Escape cierra la ventana abierta (ajustes, sincronización, reglas…).
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal) { modal = null; render(); } });

// Contador de fichas gratis: se actualiza cada segundo; al llegar a cero aparece el botón de reclamar.
setInterval(() => tickCountdowns(() => { if (!room) render(); }), 1000);

if (IS_REMOTE) { status = "Despertando el servidor…"; wakeServer().then(() => { status = null; refreshAccount(); }); }
else refreshAccount();
render();
