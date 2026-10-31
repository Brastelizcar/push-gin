import "./style.css";
import { connect, resume, savedReconnect, actions, wakeServer, IS_REMOTE, SERVER_CONFIGURED, RECONNECT_SECONDS } from "./net.js";
import { h, toast } from "./dom.js";
import { renderTable, handleRejected, playPushAnimation, notePush, notePlay, setTableHooks } from "./table.js";
import { loadAccount, createAccount, requestSyncCode, redeemSyncCode, claimChips, accountFromServer, savedToken } from "./account.js";
import { welcomeScreen, mainMenu, privateMenu, practiceMenu, waitingRoom, renderModal, tickCountdowns } from "./menus.js";
import { startPractice } from "./practice.js";
import { play } from "./sound.js";

const app = document.getElementById("app");

// ---------- estado de la aplicación ----------
let screen = "loading";          // loading | welcome | menu | private | practice (sin sala) — con sala manda la fase de la vista
let account = null;              // tu cuenta (del servidor)
let offline = false;             // no se pudo cargar la cuenta
let modal = null;                // ventana abierta sobre el menú: settings | sync | rules | help
let sync = null;                  // último código de sincronización pedido: { code, expiresAt }
let room = null;
let view = null;
let busy = false;
let status = null;               // mensaje mientras se conecta / despierta el servidor
let fee = 0;                     // cuota elegida en "Juego privado"
let turnTime = 60;               // segundos por turno elegidos (0 = sin límite)
let bots = 2;                    // rivales en práctica
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
const onRedeem = (code) => withBusy(async () => { account = await redeemSyncCode(code); modal = null; sync = null; screen = "menu"; toast(`Ahora juegas como ${account.name}`); });
const onRequestCode = () => withBusy(async () => { sync = await requestSyncCode(); });
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
      room = await connect({ ...opts, name: account.name, token: savedToken() }, {
        ...roomHandlers(),
        onWaking: (n) => { status = `El servidor sigue despertando… (intento ${n + 1} de 4)`; render(); },
      });
    } catch (e) {
      room = null; view = null;
      const msg = String(e?.message ?? e);
      throw new Error(/not found|locked|INVALID_ROOM_ID/i.test(msg) ? "Código no válido o la partida ya empezó"
        : /cuota|cuenta|sala/i.test(msg) ? msg : "No se pudo conectar al servidor");
    }
  }, "Conectando… si el servidor estaba dormido puede tardar hasta 1 minuto.");
}

// Lo mismo para una sala en línea y para la sala local de práctica.
function roomHandlers() {
  return {
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
    onDrop: () => toast(`Se perdió la conexión: reconectando… (tienes ${RECONNECT_SECONDS} s)`),
    onReconnect: () => { toast("¡Conectado de nuevo!"); play("ok"); },
  };
}

// Al abrir la página: si te desconectaste de una partida hace menos de 60 s, vuelves a ella.
async function tryResume() {
  if (!savedReconnect()) return;
  status = "Volviendo a tu partida…"; render();
  const r = await resume(roomHandlers());
  status = null;
  if (r) { room = r; leaving = false; toast("¡Volviste a tu partida!"); }
  render();
}

// Práctica contra bots. Con cuenta, se juega en el servidor (da la mitad del XP). Sin cuenta o sin conexión, corre en
// este navegador y no da XP.
function playPractice() {
  leaving = false;
  if (account && !offline && SERVER_CONFIGURED) return join({ mode: "practice", bots, turnTime });
  room = startPractice({ name: account?.name ?? "Tú", level: account?.level ?? null, bots, turnTime }, roomHandlers());
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
  else if (ev.type === "timeout") toast(ev.by === view.you ? "Se acabó tu tiempo: el turno pasó" : `A ${name(ev.by)} se le acabó el tiempo`);
  else if (ev.type === "steal") {
    toast(ev.by === view.you ? "Robaste un 2: este turno no puedes plantarte"
      : ev.victim === view.you ? `${name(ev.by)} te robó un 2`
      : `${name(ev.by)} le robó un 2 a ${name(ev.victim)}`);
  }
}

function leaveRoom() {
  leaving = true;
  const local = !!room?.practice;                 // práctica sin conexión (sala local)
  const wasPractice = local || !!view?.practice;
  room?.leave();
  room = null; view = null; screen = wasPractice ? "practice" : "menu";
  if (local) render(); else refreshAccount();
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
      account, fee, turnTime, busy, status,
      onFee: (f) => { fee = f; render(); },
      onTurnTime: (t) => { turnTime = t; render(); },
      onInvite: () => join({ mode: "create", entryFee: fee, turnTime }),
      onJoin: (roomCode) => join({ mode: "join", roomCode }),
      onBack: () => setScreen("menu"),
      onSettings: () => { modal = "settings"; render(); },
    });
  } else if (screen === "practice") {
    page = practiceMenu({
      account, bots, turnTime,
      onBots: (n) => { bots = n; render(); },
      onTurnTime: (t) => { turnTime = t; render(); },
      onPlay: playPractice,
      onBack: () => setScreen("menu"),
      onSettings: () => { modal = "settings"; render(); },
    });
  } else {
    page = mainMenu({
      account, offline, onRetry: refreshAccount,
      onPrivate: () => setScreen("private"),
      onPractice: () => setScreen("practice"),
      onSettings: () => { modal = "settings"; render(); },
      onRules: () => { modal = "rules"; render(); },
      onClaim,
    });
  }
  const close = () => { modal = null; render(); };
  const overlay = modal && renderModal(modal, {
    account, sync, busy, onClose: close, onRedeem, onRequestCode,
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

if (IS_REMOTE) { status = "Despertando el servidor…"; wakeServer().then(() => { status = null; refreshAccount().then(tryResume); }); }
else refreshAccount().then(tryResume);
render();
