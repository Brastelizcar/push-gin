// Menús: bienvenida, menú principal, ajustes, sincronización, reglas, juego privado y sala de espera.
// Estilo de la mesa (fieltro, madera y dorado); la disposición sigue las referencias de docs/referencias/.
import "./menus.css";
import { h, toast, fsButton, avatarImg, coinImg } from "./dom.js";
import { AVATAR_COUNT } from "../../src/logic/avatars.js";
import { BOT_NAMES, BOT_AVATARS } from "../../src/logic/bot.js";
import { formatCountdown, normalizeSyncCode, formatSyncCode, suitColor } from "./format.js";
import { settings, setSetting } from "./settings.js";
import { ENTRY_FEES, DAILY_CHIPS, CLAIM_INTERVAL_MS } from "../../src/logic/progress.js";
import { TURN_TIMES, TABLE_MIN, TABLE_MAX, botsRange } from "../../src/logic/match.js";

// Selector − / + de un valor dentro de una lista (cuota, tiempo de turno, rivales).
function stepper(list, value, label, show, onChange) {
  const i = list.indexOf(value);
  return h("div", { class: "m-stepper" },
    h("div", { class: "m-step-val" }, show(value)),
    h("div", { class: "m-step-lbl" }, label),
    h("div", { class: "m-step-btns" },
      h("button", { "aria-label": `Bajar ${label}`, disabled: i <= 0, onclick: () => onChange(list[i - 1]) }, "−"),
      h("button", { "aria-label": `Subir ${label}`, disabled: i >= list.length - 1, onclick: () => onChange(list[i + 1]) }, "+")));
}
const showTime = (t) => (t ? h("span", {}, t, h("small", {}, "s")) : "∞");
const timeHint = (t) => (t ? `Si se acaba el tiempo, el turno se juega solo (se descarta la carta que tomaste).` : "Sin límite de tiempo por turno.");

const coin = () => coinImg();
const frame = (cls, ...content) =>
  h("div", { class: `table-frame menu-frame ${cls}` }, h("div", { class: "menu-felt" }, ...content));

// ---------- avatar con estrella de nivel ----------
// n: número de avatar (1 a 8); sin él, la inicial del nombre. onClick: el avatar se puede tocar (para cambiarlo).
export function avatar(name, level, size = "", n = null, onClick = null) {
  return h(onClick ? "button" : "div", {
    class: `m-avatar ${size}${n ? " with-img" : ""}${onClick ? " pickable" : ""}`,
    ...(onClick && { onclick: onClick, title: "Cambiar avatar", "aria-label": "Cambiar avatar" }),
  },
    n ? avatarImg(n, name) : h("span", { class: "m-avatar-letter" }, (name || "?")[0].toUpperCase()),
    level ? h("span", { class: "m-level", title: `Nivel ${level}` }, level) : null);
}

// ---------- bienvenida (primera vez en este dispositivo) ----------
export function welcomeScreen({ busy, status, onCreate, onSync }) {
  const name = h("input", { placeholder: "Tu nombre", maxlength: "16", autocomplete: "off" });
  const create = () => { const n = name.value.trim(); if (!n) { toast("Escribe tu nombre"); return name.focus(); } onCreate(n); };
  name.addEventListener("keydown", (e) => e.key === "Enter" && create());
  return frame("narrow",
    fsButton("fs-corner"),
    h("h1", {}, "Push Gin"),
    h("div", { class: "tagline" }, "De 3 a 4 jugadores · 5 rondas"),
    h("div", {}, h("label", {}, "¿Cómo te llamas?"), name),
    h("button", { class: "primary", disabled: busy, onclick: create }, "Empezar"),
    h("div", { class: "divider" }, "o"),
    h("button", { disabled: busy, onclick: () => onSync() }, "Ya tengo un código de otro dispositivo"),
    status ? h("div", { class: "hint wake" }, status) : null);
}

// ---------- barra superior (menú principal y juego privado) ----------
function topBar(account, { onSettings, offline, onRetry, onAvatar }) {
  if (!account) {
    return h("div", { class: "m-top" },
      h("div", { class: "m-offline" }, offline ? "Sin conexión con el servidor" : "Cargando tu cuenta…",
        offline ? h("button", { class: "m-small", onclick: onRetry }, "Reintentar") : null),
      h("button", { class: "m-gear", title: "Ajustes", "aria-label": "Ajustes", onclick: onSettings }, "⚙"));
  }
  const pct = Math.min(100, (account.into / account.needed) * 100);
  return h("div", { class: "m-top" },
    h("div", { class: "m-who" }, avatar(account.name, account.level, "", account.avatar, onAvatar)),
    h("div", { class: "m-profile" },
      h("div", { class: "m-name" }, account.name),
      h("div", { class: "m-xp", title: `Nivel ${account.level}: ${account.into} de ${account.needed} XP para subir` },
        h("div", { class: "m-xp-nums" }, h("b", {}, account.into.toLocaleString("es")), h("span", {}, ` / ${account.needed.toLocaleString("es")} XP`)),
        h("div", { class: "m-xp-bar" }, h("div", { class: "m-xp-fill", style: `width:${pct}%` })))),
    h("div", { class: "m-box m-chips", title: "Tus fichas" }, coinImg("m-box-icon"), h("b", {}, account.chips.toLocaleString("es"))),
    h("div", { class: "m-top-btns" },
      fsButton("m-fs"),
      h("button", { class: "m-gear", title: "Ajustes", "aria-label": "Ajustes", onclick: onSettings }, "⚙")));
}

// ---------- menú principal ----------
export function mainMenu({ account, offline, onRetry, onPrivate, onPractice, onSettings, onRules, onClaim, onAvatar }) {
  const mode = (cls, title, art, onclick) =>
    h("button", { class: `m-mode ${cls}`, onclick }, h("div", { class: "m-mode-art" }, art), h("div", { class: "m-mode-title" }, title));
  const mini = (rank, suit, extra = "") =>
    h("div", { class: `m-card ${suitColor(suit)} ${extra}` }, h("span", {}, rank), h("small", {}, suit));
  const privArt = [h("div", { class: "m-friends" }, h("span", { class: "m-face a" }), h("span", { class: "m-face b" })), h("div", { class: "m-stack" }, coin(), coin(), coin())];
  const practArt = [mini("7", "♣", "tilt-l"), mini("7", "♥"), mini("7", "♠", "tilt-r")];

  // Barra de fichas gratis: la ficha está apagada mientras corre el tiempo y se vuelve dorada cuando ya se puede recoger.
  const ready = account && (account.claim?.canClaim || account.claimAt <= Date.now());
  const claimBar = h("div", { class: "m-claim" + (ready ? " ready" : "") },
    h("div", { class: "m-brand" }, "Push Gin"),
    account ? h("div", { class: "m-claim-coin" }, coinImg("m-claim-img")) : null,
    !account ? null : ready
      ? h("button", { class: "m-claim-btn", onclick: onClaim }, `Recoger ${DAILY_CHIPS} fichas`)
      : h("div", { class: "m-claim-info" },
          h("span", { class: "m-claim-lbl" }, "Fichas gratis en:"),
          h("span", { class: "m-claim-time", "data-countdown": account.claimAt }, formatCountdown(account.claimAt - Date.now())),
          h("div", { class: "m-claim-track" }, h("div", { class: "m-claim-fill", "data-claim-at": account.claimAt, style: `width:${claimPct(account.claimAt)}%` }))));
  return frame("wide-menu",
    topBar(account, { onSettings, offline, onRetry, onAvatar }),
    h("div", { class: "m-modes" },
      mode("private", "Juego privado", privArt, onPrivate),
      mode("practice", "Práctica", practArt, onPractice)),
    h("div", { class: "m-bottom m-main-bottom" },
      claimBar,
      h("button", { class: "m-help", title: "Reglas del juego", "aria-label": "Reglas del juego", onclick: onRules }, "?")));
}

// ---------- ventanas (sobre el menú) ----------
function modal(title, onClose, ...content) {
  const back = h("div", { class: "m-modal-back", onclick: (e) => e.target === back && onClose() },
    h("div", { class: "m-modal", role: "dialog", "aria-label": title },
      h("div", { class: "m-modal-head" }, h("h2", {}, title),
        h("button", { class: "m-close", "aria-label": "Cerrar", onclick: onClose }, "✕")),
      h("div", { class: "m-modal-body" }, ...content)));
  return back;
}

function toggle(label, key) {
  const on = settings()[key];
  const btn = h("button", { class: "m-toggle" + (on ? " on" : ""), role: "switch", "aria-checked": String(on), "aria-label": label },
    h("span", { class: "off-lbl" }, "Apagado"), h("span", { class: "on-lbl" }, "Encendido"));
  btn.addEventListener("click", () => {
    const v = !settings()[key];
    setSetting(key, v);
    btn.classList.toggle("on", v);
    btn.setAttribute("aria-checked", String(v));
  });
  return h("div", { class: "m-row" }, h("span", {}, label), btn);
}

export function settingsModal({ onClose, onSync, onRules, onHelp }) {
  return modal("Ajustes", onClose,
    toggle("Sonidos", "sounds"),
    toggle("Resaltar último movimiento", "highlightLast"),
    h("div", { class: "m-row" }, h("span", {}, "Idioma"), h("span", { class: "m-lang" }, "Español")),
    h("div", { class: "m-links" },
      h("button", { class: "m-pill", onclick: onSync }, "Sincronización"),
      h("button", { class: "m-pill", onclick: onRules }, "Reglas del juego"),
      h("button", { class: "m-pill round", title: "Cómo se juega en la mesa", "aria-label": "Ayuda", onclick: onHelp }, "?")));
}

// Compartir: menú nativo del teléfono si existe; si no, copiar al portapapeles.
export async function share(text, what) {
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    toast(`${what} copiado`);
  } catch (e) {
    if (e?.name !== "AbortError") toast(`No se pudo copiar. ${what}: ${text}`);
  }
}

// Sincronización: en el dispositivo que ya tiene la cuenta se GENERA un código corto (1 uso, 10 minutos);
// en el otro se INGRESA. sync: { code, expiresAt } del último código pedido (o null).
export function syncModal({ account, sync, busy, onRequestCode, onRedeem, onClose }) {
  const input = h("input", { placeholder: "ABCD-EFGH", maxlength: "9", autocomplete: "off", spellcheck: "false", class: "m-sync-input" });
  input.addEventListener("input", () => {
    const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    input.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
  });
  const redeem = () => {
    const c = normalizeSyncCode(input.value);
    if (!c) return toast("El código tiene 8 letras y números (ej. ABCD-EFGH)");
    onRedeem(c);
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && redeem());
  const enter = h("div", { class: "m-sync-enter" + (account ? " hidden" : "") },
    h("p", { class: "m-text small" }, "Escribe el código que generaste en tu otro dispositivo."),
    h("div", { class: "m-join-row" }, input, h("button", { class: "primary", disabled: busy, onclick: redeem }, "Usar")),
    account ? h("div", { class: "hint" }, "La cuenta de este dispositivo se reemplaza por la del código.") : null);

  const live = sync && sync.expiresAt > Date.now();
  const shareBox = account && h("div", { class: "m-sync-share" },
    live
      ? [h("p", { class: "m-text" }, "Ingresa este código en tu otro dispositivo:"),
         h("div", { class: "m-code-row" },
           h("span", { class: "m-code big" }, formatSyncCode(sync.code)),
           h("button", { class: "m-pill gold", onclick: () => share(formatSyncCode(sync.code), "Código") }, "Compartir código")),
         h("p", { class: "m-text small" }, "Sirve una sola vez y vence en ",
           h("b", { "data-sync-ends": sync.expiresAt }, formatCountdown(sync.expiresAt - Date.now(), { short: true })), ".")]
      : [h("p", { class: "m-text" }, "Para jugar con tu cuenta en otro dispositivo, genera un código y escríbelo allá."),
         h("p", { class: "m-text small" }, "El código sirve una sola vez y vence a los 10 minutos."),
         h("button", { class: "m-pill gold wide", disabled: busy, onclick: onRequestCode }, sync ? "Generar otro código" : "Generar código")]);

  return modal("Sincronización", onClose,
    shareBox,
    account ? h("button", { class: "m-pill wide", onclick: () => { enter.classList.remove("hidden"); input.focus(); } }, "Ingresar código") : null,
    enter);
}

export function rulesModal({ onClose }) {
  const sec = (t, ...items) => h("div", { class: "m-rules-sec" }, h("h3", {}, t), h("ul", {}, items.map((i) => h("li", {}, i))));
  return modal("Reglas del juego", onClose,
    h("div", { class: "m-rules" },
      sec("Objetivo", "Quedarte sin cartas. Se juegan 5 rondas y gana quien sume MENOS puntos."),
      sec("Rondas (para plantarte)", "1: tres tríos", "2: un trío y un consecutivo de 5", "3: dos consecutivos de 6",
        "4: cuatro tríos", "5: un cuarteto y un consecutivo de 8"),
      sec("Combinaciones", "Trío / cuarteto: mismo número, palos distintos.",
        "Consecutivo: seguidas y del mismo palo. Orden A, 2, 3 … K (el As solo va al principio).",
        "El 2 es comodín y también un número: vale lo que pida el lugar donde lo pones."),
      sec("Tu turno", "Toma el descarte, o haz «push»: la carta del mazo y el descarte van a la mano del siguiente y tú robas una.",
        "Si ya te plantaste puedes bajar combinaciones y enganchar en plantes de la mesa (en el turno en que te plantas no se engancha).",
        "Si se acaba el mazo se juega una vuelta más tomando el descarte; luego todos suman su mano.",
        "Un cuarteto o un consecutivo de la A a la K completo sale de la mesa.",
        "Siempre terminas descartando una carta. Ganas la ronda al descartar la última."),
      sec("Robo del 2", "Antes de tomar carta, si aún no te plantaste, puedes cambiar un 2 de un plante ajeno por la carta que va en su lugar. Ese turno ya no te puedes plantar."),
      sec("Puntos en contra", "A = 15 · 2 = 20 · 10, J, Q, K = 10 · 3 a 9 = 5"),
      sec("Experiencia y fichas", "Al terminar una partida: 1.º 100 XP, 2.º 50, 3.º 30, 4.º 10 (contra bots, la mitad). Del nivel N al N+1 hacen falta 100×N XP.",
        `Cada 24 horas puedes reclamar ${DAILY_CHIPS} fichas gratis. En juego privado con cuota, el ganador se lleva el pozo.`)));
}

export function helpModal({ onClose }) {
  return modal("Cómo se juega en la mesa", onClose,
    h("div", { class: "m-rules" },
      h("ul", {},
        h("li", {}, "Ordena tu mano con 789 (consecutivos) o 777 (tríos), o arrastrando cartas. «Espacio» separa grupos."),
        h("li", {}, "Arrastra una carta para moverla. Para llevar un grupo entero (trío, cuarteto o consecutivo con las cartas juntas), mantén presionada su primera o última carta y arrástralo."),
        h("li", {}, "Suelta una carta sobre un plante para engancharla. Toca un grupo sin confirmar para devolverlo."),
        h("li", {}, "Arrastra al descarte la carta con la que terminas y pulsa ✓. Si la jugada no vale, ✓ te dice por qué y el turno no pasa."))));
}

// ---------- juego privado ----------
export function privateMenu({ account, fee, turnTime, busy, status, onFee, onTurnTime, onInvite, onJoin, onBack, onSettings }) {
  const code = h("input", { placeholder: "0000", inputmode: "numeric", maxlength: "4", autocomplete: "off", class: "m-room-code" });
  code.addEventListener("input", () => (code.value = code.value.replace(/\D/g, "")));
  const join = () => /^\d{4}$/.test(code.value) ? onJoin(code.value) : (toast("El código de sala tiene 4 dígitos"), code.focus());
  code.addEventListener("keydown", (e) => e.key === "Enter" && join());
  const tooPoor = account && fee > account.chips;
  return frame("wide-menu",
    topBar(account, { onSettings }),
    h("div", { class: "m-private" },
      h("div", { class: "m-panel" },
        h("div", { class: "m-steppers" },
          stepper(TURN_TIMES, turnTime, "Tiempo de turnos", showTime, onTurnTime),
          stepper(ENTRY_FEES, fee, "Cuota de entrada", (f) => (f ? f.toLocaleString("es") : "Gratis"), onFee)),
        h("div", { class: "hint" }, fee
          ? `Cada jugador paga ${fee} fichas al empezar; el ganador se lleva el pozo.${tooPoor ? " No te alcanzan las fichas." : ""}`
          : "Partida sin fichas: solo se gana experiencia.")),
      h("div", { class: "m-panel" },
        h("h3", { class: "m-panel-title" }, "Unirse con código"),
        h("p", { class: "m-text small" }, "¿Un amigo ya creó la sala? Escribe el código de 4 dígitos que te compartió."),
        h("div", { class: "m-join-row" }, code, h("button", { class: "m-pill gold", disabled: busy, onclick: join }, "Unirse")))),
    h("div", { class: "m-bottom" },
      h("button", { class: "m-back", "aria-label": "Volver", onclick: onBack }, "‹"),
      h("button", { class: "m-invite", disabled: busy || tooPoor, onclick: onInvite }, "Invitar"),
      h("div", { class: "m-screen-title" }, "Juego privado")),
    status ? h("div", { class: "hint wake m-status" }, status) : null);
}

// ---------- práctica contra la máquina ----------
export function practiceMenu({ account, bots, turnTime, onBots, onTurnTime, onPlay, onBack, onSettings }) {
  return frame("wide-menu",
    topBar(account, { onSettings }),
    h("div", { class: "m-private" },
      h("div", { class: "m-panel" },
        h("div", { class: "m-steppers" },
          stepper([TABLE_MIN - 1, TABLE_MAX - 1], bots, "Rivales", String, onBots),
          stepper(TURN_TIMES, turnTime, "Tiempo de turnos", showTime, onTurnTime)),
        h("div", { class: "hint" }, timeHint(turnTime))),
      h("div", { class: "m-panel" },
        h("h3", { class: "m-panel-title" }, "Práctica"),
        h("p", { class: "m-text small" }, account
          ? "Juega contra la máquina: ganas la MITAD de la experiencia (1.º 50 XP, 2.º 25, 3.º 15, 4.º 5). No se juegan fichas."
          : "Juega contra la máquina para aprender las rondas. Sin cuenta (o sin internet) no da experiencia."),
        h("div", { class: "m-rivals" }, BOT_NAMES.slice(0, bots).map((n, i) =>
          h("div", { class: "m-rival" }, avatar(n, null, "", BOT_AVATARS[i]), h("span", {}, n)))))),
    h("div", { class: "m-bottom" },
      h("button", { class: "m-back", "aria-label": "Volver", onclick: onBack }, "‹"),
      h("button", { class: "m-invite", onclick: onPlay }, "Jugar"),
      h("div", { class: "m-screen-title" }, "Práctica")));
}

// ---------- sala de espera ----------
// Mínimo 3 en la mesa y máximo 4: con 2 personas entra 1 bot obligatorio y el anfitrión puede pedir 2 (para ser 4).
// `bots`: lo que eligió el anfitrión (se ajusta si entra o sale alguien).
export function waitingRoom({ view, bots, onBots, onStart, onLeave }) {
  const isHost = view.host === view.you;
  const humans = view.players.length;
  const range = botsRange(humans);
  const nBots = Math.max(range.min, Math.min(range.max, bots ?? range.min));
  const canStart = isHost && humans >= 2;
  const botList = isHost && humans >= 2 ? BOT_NAMES.slice(0, nBots) : [];
  const botChoice = isHost && humans >= 2 && range.max > range.min
    ? h("div", { class: "m-steppers m-wait-bots" },
        stepper(Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i), nBots, nBots === 1 ? "Bot" : "Bots", String, onBots))
    : null;
  return frame("wide-menu waiting",
    h("div", { class: "m-wait" },
      h("div", { class: "m-wait-head" }, h("h2", {}, "Preparando la partida")),
      h("div", { class: "m-wait-body" },
        h("div", { class: "m-wait-info" },
          h("span", {}, "Cuota de entrada: ", h("b", { class: "gold" }, view.entryFee ? view.entryFee.toLocaleString("es") : "gratis"), view.entryFee ? coin() : null),
          h("span", {}, "Turno: ", h("b", { class: "gold" }, view.turnTime ? `${view.turnTime} s` : "sin límite")),
          h("span", { class: "m-wait-code", title: "Código de la sala" }, view.code),
          h("button", { class: "m-pill gold", onclick: () => share(`Únete a mi partida de Push Gin con el código ${view.code}`, "Código") }, "Compartir código")),
        h("p", { class: "m-text" }, humans < 2 ? "Esperando a que tus amigos se unan al juego."
          : `Jugadores: ${humans}${botList.length ? ` + ${botList.length} ${botList.length === 1 ? "bot" : "bots"}` : ""} de ${TABLE_MAX}` +
            (range.min ? ` · Mínimo ${TABLE_MIN} en la mesa: los bots la completan.` : "")),
        h("div", { class: "m-wait-players" },
          view.players.map((p) => h("div", { class: "m-wait-p" + (p.id === view.you ? " me" : "") },
            avatar(p.name, p.level, "small", p.avatar),
            h("span", { class: "m-wait-name" }, p.name, p.id === view.you ? " (tú)" : ""),
            p.id === view.host ? h("span", { class: "badge" }, "Anfitrión") : null)),
          botList.map((n, i) => h("div", { class: "m-wait-p bot" },
            avatar(n, null, "small", BOT_AVATARS[i]), h("span", { class: "m-wait-name" }, n), h("span", { class: "badge" }, "Bot")))),
        botChoice,
        h("div", { class: "m-wait-btns" },
          isHost
            ? h("button", { class: "m-btn green", disabled: !canStart, onclick: () => onStart(nBots) }, "Comenzar")
            : h("div", { class: "hint" }, "Esperando a que el anfitrión comience…"),
          h("button", { class: "m-btn red", onclick: onLeave }, "Dejar")))));
}

// Menú dentro de la partida: ajustes (sonido), reglas, ayuda y volver al menú de inicio.
// inGame: la partida sigue en curso (salir cuenta como abandonar).
export function gameMenuModal({ onClose, onSettings, onRules, onHelp, onExit, inGame, practiceLocal }) {
  const warn = inGame && !practiceLocal
    ? h("p", { class: "m-text small m-warn" }, "Si sales con la partida en curso, la abandonas: pierdes la cuota y la experiencia.")
    : null;
  return modal("Menú", onClose,
    h("div", { class: "m-game-menu" },
      h("button", { class: "m-pill wide", onclick: onSettings }, "Ajustes de sonido"),
      h("button", { class: "m-pill wide", onclick: onRules }, "Reglas del juego"),
      h("button", { class: "m-pill wide", onclick: onHelp }, "Cómo se juega en la mesa"),
      warn,
      h("button", { class: "m-btn red wide", onclick: onExit }, inGame ? "Salir al menú de inicio" : "Volver al menú de inicio")));
}

// Elegir avatar: los 8 disponibles; el tuyo marcado.
export function avatarModal({ account, busy, onPickAvatar, onClose }) {
  return modal("Tu avatar", onClose,
    h("div", { class: "m-avatars" },
      Array.from({ length: AVATAR_COUNT }, (_, i) => i + 1).map((n) =>
        h("button", {
          class: "m-avatar-pick" + (account?.avatar === n ? " current" : ""), disabled: busy,
          "aria-label": `Avatar ${n}`, onclick: () => onPickAvatar(n),
        }, avatarImg(n)))));
}

// Ventanas que pueden abrirse sobre cualquier menú.
export function renderModal(kind, props) {
  if (kind === "avatar") return avatarModal(props);
  if (kind === "game") return gameMenuModal(props);
  if (kind === "settings") return settingsModal(props);
  if (kind === "sync") return syncModal(props);
  if (kind === "rules") return rulesModal(props);
  if (kind === "help") return helpModal(props);
  return null;
}

// Actualiza cada segundo los contadores ("Fichas gratis en", vencimiento del código) sin redibujar el menú.
// onDone se llama cuando alguno llega a cero (para mostrar el botón de reclamar o "generar otro código").
// Cuánto ha avanzado la espera de las fichas gratis (0 a 100).
const claimPct = (claimAt) => Math.max(0, Math.min(100, 100 - ((claimAt - Date.now()) / CLAIM_INTERVAL_MS) * 100));

export function tickCountdowns(onDone) {
  for (const el of document.querySelectorAll("[data-claim-at]")) el.style.width = `${claimPct(Number(el.dataset.claimAt))}%`;
  for (const el of document.querySelectorAll("[data-countdown]")) {
    const left = Number(el.dataset.countdown) - Date.now();
    el.textContent = formatCountdown(left);
    if (left <= 0) onDone?.();
  }
  for (const el of document.querySelectorAll("[data-sync-ends]")) {
    const left = Number(el.dataset.syncEnds) - Date.now();
    el.textContent = formatCountdown(left, { short: true });
    if (left <= 0) onDone?.();
  }
}
