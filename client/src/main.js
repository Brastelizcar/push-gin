import "./style.css";
import { connect, resume, savedReconnect, actions, wakeServer, IS_REMOTE, SERVER_CONFIGURED, RECONNECT_SECONDS } from "./net.js";
import { h, toast } from "./dom.js";
import { t } from "./i18n.js";
import { renderTable, handleRejected, playPushAnimation, notePush, notePlay, noteCleared, setTableHooks, stageInfo } from "./table.js";
import { loadAccount, createAccount, requestSyncCode, redeemSyncCode, claimChips, accountFromServer, savedToken, setAvatar } from "./account.js";
import { welcomeScreen, mainMenu, privateMenu, practiceMenu, waitingRoom, renderModal, tickCountdowns } from "./menus.js";
import { startPractice } from "./practice.js";
import { tutorialSetup, resetTutorial, coach } from "./tutorial.js";
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
let bots = 2;                    // rivales en práctica (2 o 3: mínimo 3 en la mesa)
let lobbyBots = null;            // bots que pide el anfitrión en la sala de espera (null = los mínimos)
let leaving = false;             // saliste tú de la sala (no mostrar "te desconectaste")
let tutorial = false;            // la sala abierta es el tutorial (ronda guiada en este navegador)

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

async function withBusy(fn, slowMsg = t("Despertando el servidor… la primera vez puede tardar hasta 1 minuto.")) {
  busy = true; status = null; render();
  const slow = setTimeout(() => { status = slowMsg; render(); }, 3000);
  try { return await fn(); }
  catch (e) { toast(e.message ? t(e.message) : t("Algo salió mal")); }
  finally { clearTimeout(slow); busy = false; status = null; render(); }
}

// Al crear la cuenta se va directo al tutorial (se puede saltar).
const onCreateAccount = (name) => withBusy(async () => { account = await createAccount(name); screen = "menu"; startTutorial(); });
const onRedeem = (code) => withBusy(async () => { account = await redeemSyncCode(code); modal = null; sync = null; screen = "menu"; toast(t("Ahora juegas como {name}", { name: account.name })); });
const onRequestCode = () => withBusy(async () => { sync = await requestSyncCode(); });
const onPickAvatar = (n) => withBusy(async () => { account = await setAvatar(n); modal = null; play("ok"); });
const onClaim = () => withBusy(async () => {
  const r = await claimChips();
  account = r.account;
  toast(r.ok ? t("¡Recibiste 300 fichas!") : t("Todavía no puedes reclamar"));
  if (r.ok) play("ok");
});

// ---------- salas ----------
async function join(opts) {
  if (!SERVER_CONFIGURED) return toast("Falta poner la dirección del servidor en client/.env.production");
  if (!account) return toast(offline ? t("Sin conexión con el servidor") : t("Primero crea tu cuenta"));
  leaving = false;
  await withBusy(async () => {
    try {
      room = await connect({ ...opts, name: account.name, token: savedToken() }, {
        ...roomHandlers(),
        onWaking: (n) => { status = t("El servidor sigue despertando… (intento {n} de 4)", { n: n + 1 }); render(); },
      });
    } catch (e) {
      room = null; view = null;
      const msg = String(e?.message ?? e);
      throw new Error(/not found|locked|INVALID_ROOM_ID/i.test(msg) ? t("Código no válido o la partida ya empezó")
        : /cuota|cuenta|sala/i.test(msg) ? msg : t("No se pudo conectar al servidor"));
    }
  }, t("Conectando… si el servidor estaba dormido puede tardar hasta 1 minuto."));
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
    onRejected: (error) => { toast(t(error)); play("bad"); handleRejected(); render(); },
    onLeave: () => {
      if (!leaving) toast("Te desconectaste de la sala");
      room = null; view = null; screen = "menu"; render();
    },
    onDrop: () => toast(t("Se perdió la conexión: reconectando… (tienes {s} s)", { s: RECONNECT_SECONDS })),
    onReconnect: () => { toast("¡Conectado de nuevo!"); play("ok"); },
  };
}

// Al abrir la página: si te desconectaste de una partida hace menos de 60 s, vuelves a ella.
async function tryResume() {
  if (!savedReconnect()) return;
  status = t("Volviendo a tu partida…"); render();
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
  room = startPractice({ name: account?.name ?? t("Tú"), level: account?.level ?? null, avatar: account?.avatar ?? null, bots, turnTime }, roomHandlers());
}

// Tutorial: una ronda guiada contra 2 bots, en este navegador y con un reparto preparado (tutorial.js).
function startTutorial() {
  leaving = false; tutorial = true; modal = null;
  resetTutorial();
  room = startPractice({ name: account?.name ?? t("Tú"), level: account?.level ?? null, avatar: account?.avatar ?? null,
    bots: 2, turnTime: 0, setup: tutorialSetup, noPush: true }, roomHandlers());
}
function endTutorial() {
  tutorial = false; leaving = true;
  room?.leave();
  room = null; view = null; modal = null; screen = "menu";
  render();
}

function onEvent(ev) {
  if (!view) return;
  const name = (id) => (id === view.you ? t("Tú") : view.players.find((p) => p.id === id)?.name ?? t("alguien"));
  const played = ev.type === "turn" && (ev.planted || ev.laid || ev.hooked);
  if (played && ev.by !== view.you) notePlay(ev.by); // anima sus cartas hacia la mesa
  if (played && ev.by === view.you) play("ok");
  if (ev.type === "push") {
    toast(ev.by === view.you ? t("Hiciste push: {to} recibe 2 cartas", { to: name(ev.to) })
      : ev.to === view.you ? t("{by} hizo push: recibes 2 cartas", { by: name(ev.by) })
      : t("{by} hizo push: {to} recibe 2 cartas", { by: name(ev.by), to: name(ev.to) }));
    notePush({ by: ev.by, to: ev.to, card: view.discardTop, anim: playPushAnimation({ card: view.discardTop, toPid: ev.to, me: view.you }) });
  } else if (ev.type === "turn" && ev.planted) toast(ev.by === view.you ? t("¡Te plantaste!") : t("{name} se plantó", { name: name(ev.by) }));
  else if (played && ev.by !== view.you) toast(t(ev.laid ? "{name} bajó una combinación" : "{name} enganchó en la mesa", { name: name(ev.by) }));
  if (ev.cleared?.length) {                      // consecutivo de 3 a A: sale de la mesa (con animación)
    noteCleared(ev.cleared);
    const what = ev.cleared.map(() => t("un consecutivo de 3 a A")).join(t(" y "));
    setTimeout(() => toast(t("¡Se completó {what}: sale de la mesa!", { what })), 900);
  }
  else if (ev.type === "timeout") toast(ev.by === view.you ? t("Se acabó tu tiempo: el turno pasó") : t("A {name} se le acabó el tiempo", { name: name(ev.by) }));
  else if (ev.type === "steal") {
    toast(ev.by === view.you ? t("Robaste un 2: este turno no puedes plantarte")
      : ev.victim === view.you ? t("{name} te robó un 2", { name: name(ev.by) })
      : t("{name} le robó un 2 a {victim}", { name: name(ev.by), victim: name(ev.victim) }));
  }
}

function leaveRoom() {
  if (tutorial) return endTutorial();
  leaving = true;
  const local = !!room?.practice;                 // práctica sin conexión (sala local)
  const wasPractice = local || !!view?.practice;
  room?.leave();
  room = null; view = null; lobbyBots = null; screen = wasPractice ? "practice" : "menu";
  if (local) render(); else refreshAccount();
}

// La mesa avisa cuando el jugador quiere volver al menú al terminar la partida.
setTableHooks({ onExit: leaveRoom, play, onMenu: () => { modal = "game"; render(); } });

// ---------- render ----------
function render() {
  const rotate = document.querySelector(".rotate-warning");          // (está en index.html)
  if (rotate) rotate.textContent = t("Gira tu dispositivo para jugar 🔄");
  const inTable = room && view && view.phase !== "lobby";
  app.classList.toggle("wide", !!inTable);
  app.classList.toggle("menu", !inTable && screen !== "welcome");
  if (inTable) {
    renderTable(app, { view, room, rerender: render, onSkip: tutorial ? endTutorial : null });
    if (tutorial) {
      app.querySelector(".coach")?.remove();          // (si la mesa no se redibujó porque arrastras una carta)
      const c = coach(view, stageInfo(), { onFinish: endTutorial, rerender: render });
      if (c.center) app.querySelector(".overlay")?.remove();   // el entrenador explica la tabla de fin de ronda
      app.append(c.el);
    }
    const over = modalOverlay();
    if (over) app.append(over);
    return;
  }
  if (room && view) return app.replaceChildren(waitingRoom({ view, bots: lobbyBots, onBots: (n) => { lobbyBots = n; render(); }, onStart: (n) => actions.start(room, n), onLeave: leaveRoom }));

  let page;
  if (screen === "loading") page = h("div", { class: "hint" }, t("Cargando…"));
  else if (screen === "welcome") page = welcomeScreen({ busy, status, onCreate: onCreateAccount, onSync: () => { modal = "sync"; render(); }, onLang: render });
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
      onAvatar: () => { modal = "avatar"; render(); },
      onClaim,
    });
  }
  const overlay = modalOverlay();
  app.replaceChildren(page, ...(overlay ? [overlay] : []));
  if (status && screen !== "welcome" && screen !== "private") app.append(h("div", { class: "hint wake" }, status));
}

// Ventana abierta (ajustes, sincronización, reglas, ayuda o el menú de la partida), o null.
function modalOverlay() {
  if (!modal) return null;
  const close = () => { modal = null; render(); };
  return renderModal(modal, {
    account, sync, busy, onClose: close, onRedeem, onRequestCode, onPickAvatar, onLang: render,
    onTutorial: room ? null : startTutorial,                 // el tutorial se puede repetir desde Ajustes (fuera de partida)
    onSync: () => { modal = "sync"; render(); },
    onSettings: () => { modal = "settings"; render(); },
    onRules: () => { modal = "rules"; render(); },
    onHelp: () => { modal = "help"; render(); },
    inGame: !!view && (view.phase === "playing" || view.phase === "roundOver"),
    practiceLocal: !!room?.practice,
    onExit: () => { modal = null; leaveRoom(); },
  });
}

// Escape cierra la ventana abierta (ajustes, sincronización, reglas…).
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal) { modal = null; render(); } });

// Contador de fichas gratis: se actualiza cada segundo; al llegar a cero aparece el botón de reclamar.
setInterval(() => tickCountdowns(() => { if (!room) render(); }), 1000);

if (IS_REMOTE) { status = t("Despertando el servidor…"); wakeServer().then(() => { status = null; refreshAccount().then(tryResume); }); }
else refreshAccount().then(tryResume);
render();
