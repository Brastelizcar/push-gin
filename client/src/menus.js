// Menús: bienvenida, menú principal, ajustes, sincronización, reglas, juego privado y sala de espera.
// Estilo de la mesa (fieltro, madera y dorado); la disposición sigue las referencias de docs/referencias/.
import "./menus.css";
import { h, toast, fsButton, avatarImg, coinImg } from "./dom.js";
import { t, num, getLang, setLang } from "./i18n.js";
import { AVATAR_COUNT } from "../../src/logic/avatars.js";
import { BOT_NAMES, botAvatars } from "../../src/logic/bot.js";
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
      h("button", { "aria-label": t("Bajar {x}", { x: label }), disabled: i <= 0, onclick: () => onChange(list[i - 1]) }, "−"),
      h("button", { "aria-label": t("Subir {x}", { x: label }), disabled: i >= list.length - 1, onclick: () => onChange(list[i + 1]) }, "+")));
}
const showTime = (t) => (t ? h("span", {}, t, h("small", {}, "s")) : "∞");
const timeHint = (secs) => (secs ? t("Si se acaba el tiempo, el turno se juega solo (se descarta la carta que tomaste).") : t("Sin límite de tiempo por turno."));

const coin = () => coinImg();
const frame = (cls, ...content) =>
  h("div", { class: `table-frame menu-frame ${cls}` }, h("div", { class: "menu-felt" }, ...content));

// ---------- avatar con estrella de nivel ----------
// n: número de avatar (1 a 8); sin él, la inicial del nombre. onClick: el avatar se puede tocar (para cambiarlo).
export function avatar(name, level, size = "", n = null, onClick = null) {
  return h(onClick ? "button" : "div", {
    class: `m-avatar ${size}${n ? " with-img" : ""}${onClick ? " pickable" : ""}`,
    ...(onClick && { onclick: onClick, title: t("Cambiar avatar"), "aria-label": t("Cambiar avatar") }),
  },
    n ? avatarImg(n, name) : h("span", { class: "m-avatar-letter" }, (name || "?")[0].toUpperCase()),
    level ? h("span", { class: "m-level", title: t("Nivel {n}", { n: level }) }, level) : null);
}

// ---------- botón de idioma (ref. docs/referencias/btonidioma.png y btonidioma2.png) ----------
// Muestra el idioma actual con su bandera (español: Colombia); al tocarlo cambia al otro y se redibuja todo.
const LANG_INFO = { es: { flag: "co", label: "ESPAÑOL" }, en: { flag: "en", label: "ENGLISH" } };
export function langButton(onChange, extraClass = "") {
  const cur = LANG_INFO[getLang()];
  return h("button", {
    class: `m-lang-btn ${extraClass}`, title: t("Cambiar idioma"), "aria-label": t("Cambiar idioma"),
    onclick: () => { setLang(getLang() === "es" ? "en" : "es"); onChange?.(); },
  },
    h("img", { class: "m-lang-flag", src: `${import.meta.env.BASE_URL}flags/${cur.flag}.svg`, alt: "", draggable: "false" }),
    h("span", {}, cur.label));
}

// ---------- bienvenida (primera vez en este dispositivo) ----------
export function welcomeScreen({ busy, status, onCreate, onSync, onLang }) {
  const name = h("input", { placeholder: t("Tu nombre"), maxlength: "16", autocomplete: "off" });
  const create = () => { const n = name.value.trim(); if (!n) { toast("Escribe tu nombre"); return name.focus(); } onCreate(n); };
  name.addEventListener("keydown", (e) => e.key === "Enter" && create());
  return frame("narrow",
    langButton(onLang, "lang-corner"),
    fsButton("fs-corner"),
    h("h1", {}, "Push Gin"),
    h("div", { class: "tagline" }, t("De 3 a 4 jugadores · 5 rondas")),
    h("div", {}, h("label", {}, t("¿Cómo te llamas?")), name),
    h("button", { class: "primary", disabled: busy, onclick: create }, t("Empezar")),
    h("div", { class: "divider" }, "o"),
    h("button", { disabled: busy, onclick: () => onSync() }, t("Ya tengo un código de otro dispositivo")),
    status ? h("div", { class: "hint wake" }, status) : null);
}

// ---------- barra superior (menú principal y juego privado) ----------
function topBar(account, { onSettings, offline, onRetry, onAvatar }) {
  if (!account) {
    return h("div", { class: "m-top" },
      h("div", { class: "m-offline" }, offline ? t("Sin conexión con el servidor") : t("Cargando tu cuenta…"),
        offline ? h("button", { class: "m-small", onclick: onRetry }, t("Reintentar")) : null),
      h("button", { class: "m-gear", title: t("Ajustes"), "aria-label": t("Ajustes"), onclick: onSettings }, "⚙"));
  }
  const pct = Math.min(100, (account.into / account.needed) * 100);
  return h("div", { class: "m-top" },
    h("div", { class: "m-who" }, avatar(account.name, account.level, "", account.avatar, onAvatar)),
    h("div", { class: "m-profile" },
      h("div", { class: "m-name" }, account.name),
      h("div", { class: "m-xp", title: t("Nivel {n}: {into} de {needed} XP para subir", { n: account.level, into: num(account.into), needed: num(account.needed) }) },
        h("div", { class: "m-xp-nums" }, h("b", {}, num(account.into)), h("span", {}, ` / ${num(account.needed)} XP`)),
        h("div", { class: "m-xp-bar" }, h("div", { class: "m-xp-fill", style: `width:${pct}%` })))),
    h("div", { class: "m-box m-chips", title: t("Tus fichas") }, coinImg("m-box-icon"), h("b", {}, num(account.chips))),
    h("div", { class: "m-top-btns" },
      fsButton("m-fs"),
      h("button", { class: "m-gear", title: t("Ajustes"), "aria-label": t("Ajustes"), onclick: onSettings }, "⚙")));
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
  // Se recoge con el botón o tocando la ficha: salta, gira en el aire y vuelve a caer; luego se reclaman.
  const ready = account && (account.claim?.canClaim || account.claimAt <= Date.now());
  const claim = () => coinJump(onClaim);
  const claimBar = h("div", { class: "m-claim" + (ready ? " ready" : "") },
    h("div", { class: "m-brand" }, "Push Gin"),
    account ? h(ready ? "button" : "div", {
      class: "m-claim-coin", ...(ready && { onclick: claim, title: t("Recoger {n} fichas", { n: DAILY_CHIPS }), "aria-label": t("Recoger {n} fichas", { n: DAILY_CHIPS }) }),
    }, coinImg("m-claim-img")) : null,
    !account ? null : ready
      ? h("button", { class: "m-claim-btn", onclick: claim }, t("Recoger {n} fichas", { n: DAILY_CHIPS }))
      : h("div", { class: "m-claim-info" },
          h("span", { class: "m-claim-lbl" }, t("Fichas gratis en:")),
          h("span", { class: "m-claim-time", "data-countdown": account.claimAt }, formatCountdown(account.claimAt - Date.now())),
          h("div", { class: "m-claim-track" }, h("div", { class: "m-claim-fill", "data-claim-at": account.claimAt, style: `width:${claimPct(account.claimAt)}%` }))));
  return frame("wide-menu",
    topBar(account, { onSettings, offline, onRetry, onAvatar }),
    h("div", { class: "m-modes" },
      mode("private", t("Juego privado"), privArt, onPrivate),
      mode("practice", t("Práctica"), practArt, onPractice)),
    h("div", { class: "m-bottom m-main-bottom" },
      claimBar,
      h("button", { class: "m-help", title: t("Reglas del juego"), "aria-label": t("Reglas del juego"), onclick: onRules }, "?")));
}

// ---------- ventanas (sobre el menú) ----------
function modal(title, onClose, ...content) {
  const back = h("div", { class: "m-modal-back", onclick: (e) => e.target === back && onClose() },
    h("div", { class: "m-modal", role: "dialog", "aria-label": title },
      h("div", { class: "m-modal-head" }, h("h2", {}, title),
        h("button", { class: "m-close", "aria-label": t("Cerrar"), onclick: onClose }, "✕")),
      h("div", { class: "m-modal-body" }, ...content)));
  return back;
}

function toggle(label, key) {
  const on = settings()[key];
  const btn = h("button", { class: "m-toggle" + (on ? " on" : ""), role: "switch", "aria-checked": String(on), "aria-label": label },
    h("span", { class: "off-lbl" }, t("Apagado")), h("span", { class: "on-lbl" }, t("Encendido")));
  btn.addEventListener("click", () => {
    const v = !settings()[key];
    setSetting(key, v);
    btn.classList.toggle("on", v);
    btn.setAttribute("aria-checked", String(v));
  });
  return h("div", { class: "m-row" }, h("span", {}, label), btn);
}

export function settingsModal({ onClose, onSync, onRules, onHelp, onLang, onTutorial }) {
  return modal(t("Ajustes"), onClose,
    toggle(t("Sonidos"), "sounds"),
    toggle(t("Resaltar último movimiento"), "highlightLast"),
    h("div", { class: "m-row" }, h("span", {}, t("Idioma")), langButton(onLang)),
    h("div", { class: "m-links" },
      onTutorial ? h("button", { class: "m-pill", onclick: onTutorial }, t("Tutorial")) : null,
      h("button", { class: "m-pill", onclick: onSync }, t("Sincronización")),
      h("button", { class: "m-pill", onclick: onRules }, t("Reglas del juego")),
      h("button", { class: "m-pill round", title: t("Cómo se juega en la mesa"), "aria-label": t("Ayuda"), onclick: onHelp }, "?")));
}

// Compartir: menú nativo del teléfono si existe; si no, copiar al portapapeles.
export async function share(text, what) {
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    toast(t("{x} copiado", { x: what }));
  } catch (e) {
    if (e?.name !== "AbortError") toast(t("No se pudo copiar. {x}: {text}", { x: what, text }));
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
    h("p", { class: "m-text small" }, t("Escribe el código que generaste en tu otro dispositivo.")),
    h("div", { class: "m-join-row" }, input, h("button", { class: "primary", disabled: busy, onclick: redeem }, t("Usar"))),
    account ? h("div", { class: "hint" }, t("La cuenta de este dispositivo se reemplaza por la del código.")) : null);

  const live = sync && sync.expiresAt > Date.now();
  const shareBox = account && h("div", { class: "m-sync-share" },
    live
      ? [h("p", { class: "m-text" }, t("Ingresa este código en tu otro dispositivo:")),
         h("div", { class: "m-code-row" },
           h("span", { class: "m-code big" }, formatSyncCode(sync.code)),
           h("button", { class: "m-pill gold", onclick: () => share(formatSyncCode(sync.code), t("Código")) }, t("Compartir código"))),
         h("p", { class: "m-text small" }, t("Sirve una sola vez y vence en "),
           h("b", { "data-sync-ends": sync.expiresAt }, formatCountdown(sync.expiresAt - Date.now(), { short: true })), ".")]
      : [h("p", { class: "m-text" }, t("Para jugar con tu cuenta en otro dispositivo, genera un código y escríbelo allá.")),
         h("p", { class: "m-text small" }, t("El código sirve una sola vez y vence a los 10 minutos.")),
         h("button", { class: "m-pill gold wide", disabled: busy, onclick: onRequestCode }, sync ? t("Generar otro código") : t("Generar código"))]);

  return modal(t("Sincronización"), onClose,
    shareBox,
    account ? h("button", { class: "m-pill wide", onclick: () => { enter.classList.remove("hidden"); input.focus(); } }, t("Ingresar código")) : null,
    enter);
}

export function rulesModal({ onClose }) {
  const sec = (t, ...items) => h("div", { class: "m-rules-sec" }, h("h3", {}, t), h("ul", {}, items.map((i) => h("li", {}, i))));
  return modal(t("Reglas del juego"), onClose,
    h("div", { class: "m-rules" },
      sec(t("Objetivo"), t("Quedarte sin cartas. Se juegan 5 rondas y gana quien sume MENOS puntos.")),
      sec(t("Rondas (para plantarte)"), t("1: tres tríos"), t("2: un trío y un consecutivo de 5"), t("3: dos consecutivos de 6"),
        t("4: cuatro tríos"), t("5: un cuarteto y un consecutivo de 8"),
        t("Es lo mínimo: un grupo puede ser más grande (un cuarteto en lugar de un trío) y puedes bajar grupos de más.")),
      sec(t("Combinaciones"), t("Trío / cuarteto: mismo número, de cualquier palo. Puede tener más de 4 cartas."),
        t("Consecutivo: seguidas y del mismo palo. Orden A, K, Q, J, 10 … 3 (el As solo va junto a la K: no hay K-A-3)."),
        t("El 2 es solo comodín (se ve como una P con los 4 palos): vale lo que pida el lugar donde lo pones. Cada grupo necesita al menos una carta que no sea comodín.")),
      sec(t("Tu turno"), t("Toma el descarte, o haz «push»: la carta del mazo y el descarte van a la mano del siguiente y tú robas una."),
        t("Si ya te plantaste puedes bajar combinaciones y enganchar en plantes de la mesa (en el turno en que te plantas no se engancha)."),
        t("Si se acaba el mazo se juega una vuelta más tomando el descarte; luego todos suman su mano."),
        t("Un consecutivo completo (del 3 al As) sale de la mesa."),
        t("Siempre terminas descartando una carta. Ganas la ronda al descartar la última.")),
      sec(t("Robo del 2"), t("Antes de tomar carta, si aún no te plantaste, puedes cambiar un 2 de un plante ajeno (de un jugador ya plantado) por la carta que va en su lugar. Puedes robar todos los que quieras en el mismo turno, siempre que tengas la carta de cada uno. Ese turno ya no te puedes plantar.")),
      sec(t("Puntos en contra"), t("A = 15 · 2 = 20 · 10, J, Q, K = 10 · 3 a 9 = 5")),
      sec(t("Experiencia y fichas"), t("Al terminar una partida: 1.º 100 XP, 2.º 50, 3.º 30, 4.º 10 (contra bots, la mitad). Del nivel N al N+1 hacen falta 100×N XP."),
        t("Cada 24 horas puedes reclamar {n} fichas gratis. En juego privado con cuota, el ganador se lleva el pozo.", { n: DAILY_CHIPS }))));
}

export function helpModal({ onClose }) {
  return modal(t("Cómo se juega en la mesa"), onClose,
    h("div", { class: "m-rules" },
      h("ul", {},
        h("li", {}, t("Ordena tu mano con 789 (consecutivos) o 777 (tríos), o arrastrando cartas. «Espacio» separa grupos.")),
        h("li", {}, t("Arrastra una carta para moverla. Para llevar un grupo entero (trío, cuarteto o consecutivo con las cartas juntas), mantén presionada su primera o última carta y arrástralo.")),
        h("li", {}, t("Suelta una carta sobre un plante para engancharla. Toca un grupo sin confirmar para devolverlo.")),
        h("li", {}, t("Arrastra al descarte la carta con la que terminas y pulsa ✓. Si la jugada no vale, ✓ te dice por qué y el turno no pasa.")))));
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
          stepper(TURN_TIMES, turnTime, t("Tiempo de turnos"), showTime, onTurnTime),
          stepper(ENTRY_FEES, fee, t("Cuota de entrada"), (f) => (f ? num(f) : t("Gratis")), onFee)),
        h("div", { class: "hint" }, fee
          ? t("Cada jugador paga {n} fichas al empezar; el ganador se lleva el pozo.", { n: num(fee) }) + (tooPoor ? " " + t("No te alcanzan las fichas.") : "")
          : t("Partida sin fichas: solo se gana experiencia."))),
      h("div", { class: "m-panel" },
        h("h3", { class: "m-panel-title" }, t("Unirse con código")),
        h("p", { class: "m-text small" }, t("¿Un amigo ya creó la sala? Escribe el código de 4 dígitos que te compartió.")),
        h("div", { class: "m-join-row" }, code, h("button", { class: "m-pill gold", disabled: busy, onclick: join }, t("Unirse"))))),
    h("div", { class: "m-bottom" },
      h("button", { class: "m-back", "aria-label": t("Volver"), onclick: onBack }, "‹"),
      h("button", { class: "m-invite", disabled: busy || tooPoor, onclick: onInvite }, t("Invitar")),
      h("div", { class: "m-screen-title" }, t("Juego privado"))),
    status ? h("div", { class: "hint wake m-status" }, status) : null);
}

// ---------- práctica contra la máquina ----------
export function practiceMenu({ account, bots, turnTime, onBots, onTurnTime, onPlay, onBack, onSettings }) {
  return frame("wide-menu",
    topBar(account, { onSettings }),
    h("div", { class: "m-private" },
      h("div", { class: "m-panel" },
        h("div", { class: "m-steppers" },
          stepper([TABLE_MIN - 1, TABLE_MAX - 1], bots, t("Rivales"), String, onBots),
          stepper(TURN_TIMES, turnTime, t("Tiempo de turnos"), showTime, onTurnTime)),
        h("div", { class: "hint" }, timeHint(turnTime))),
      h("div", { class: "m-panel" },
        h("h3", { class: "m-panel-title" }, t("Práctica")),
        h("p", { class: "m-text small" }, account
          ? t("Juega contra la máquina: ganas la MITAD de la experiencia (1.º 50 XP, 2.º 25, 3.º 15, 4.º 5). No se juegan fichas.")
          : t("Juega contra la máquina para aprender las rondas. Sin cuenta (o sin internet) no da experiencia.")),
        h("div", { class: "m-rivals" }, BOT_NAMES.slice(0, bots).map((n, i) =>
          h("div", { class: "m-rival" }, avatar(n, null, "", botAvatars(bots, account?.avatar ? [account.avatar] : [])[i]), h("span", {}, n)))))),
    h("div", { class: "m-bottom" },
      h("button", { class: "m-back", "aria-label": t("Volver"), onclick: onBack }, "‹"),
      h("button", { class: "m-invite", onclick: onPlay }, t("Jugar")),
      h("div", { class: "m-screen-title" }, t("Práctica"))));
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
        stepper(Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i), nBots, nBots === 1 ? t("Bot") : t("Bots"), String, onBots))
    : null;
  return frame("wide-menu waiting",
    h("div", { class: "m-wait" },
      h("div", { class: "m-wait-head" }, h("h2", {}, t("Preparando la partida"))),
      h("div", { class: "m-wait-body" },
        h("div", { class: "m-wait-info" },
          h("span", {}, t("Cuota de entrada: "), h("b", { class: "gold" }, view.entryFee ? num(view.entryFee) : t("gratis")), view.entryFee ? coin() : null),
          h("span", {}, t("Turno: "), h("b", { class: "gold" }, view.turnTime ? `${view.turnTime} s` : t("sin límite"))),
          h("span", { class: "m-wait-code", title: t("Código de la sala") }, view.code),
          h("button", { class: "m-pill gold", onclick: () => share(t("Únete a mi partida de Push Gin con el código {code}", { code: view.code }), t("Código")) }, t("Compartir código"))),
        h("p", { class: "m-text" }, humans < 2 ? t("Esperando a que tus amigos se unan al juego.")
          : t("Jugadores: {n}", { n: humans }) + (botList.length ? ` + ${botList.length} ${botList.length === 1 ? "bot" : "bots"}` : "") + t(" de {max}", { max: TABLE_MAX }) +
            (range.min ? " · " + t("Mínimo {min} en la mesa: los bots la completan.", { min: TABLE_MIN }) : "")),
        h("div", { class: "m-wait-players" },
          view.players.map((p) => h("div", { class: "m-wait-p" + (p.id === view.you ? " me" : "") },
            avatar(p.name, p.level, "small", p.avatar),
            h("span", { class: "m-wait-name" }, p.name, p.id === view.you ? t(" (tú)") : ""),
            p.id === view.host ? h("span", { class: "badge" }, t("Anfitrión")) : null)),
          botList.map((n, i) => h("div", { class: "m-wait-p bot" },
            avatar(n, null, "small", botAvatars(nBots, view.players.map((p) => p.avatar))[i]), h("span", { class: "m-wait-name" }, n), h("span", { class: "badge" }, t("Bot"))))),
        botChoice,
        h("div", { class: "m-wait-btns" },
          isHost
            ? h("button", { class: "m-btn green", disabled: !canStart, onclick: () => onStart(nBots) }, t("Comenzar"))
            : h("div", { class: "hint" }, t("Esperando a que el anfitrión comience…")),
          h("button", { class: "m-btn red", onclick: onLeave }, t("Dejar"))))));
}

// Menú dentro de la partida: ajustes (sonido), reglas, ayuda y volver al menú de inicio.
// inGame: la partida sigue en curso (salir cuenta como abandonar).
export function gameMenuModal({ onClose, onSettings, onRules, onHelp, onExit, inGame, practiceLocal }) {
  const warn = inGame && !practiceLocal
    ? h("p", { class: "m-text small m-warn" }, t("Si sales con la partida en curso, la abandonas: pierdes la cuota y la experiencia."))
    : null;
  return modal(t("Menú"), onClose,
    h("div", { class: "m-game-menu" },
      h("button", { class: "m-pill wide", onclick: onSettings }, t("Ajustes de sonido")),
      h("button", { class: "m-pill wide", onclick: onRules }, t("Reglas del juego")),
      h("button", { class: "m-pill wide", onclick: onHelp }, t("Cómo se juega en la mesa")),
      warn,
      h("button", { class: "m-btn red wide", onclick: onExit }, inGame ? t("Salir al menú de inicio") : t("Volver al menú de inicio"))));
}

// Elegir avatar: los 10 disponibles (2 filas de 5); el tuyo marcado.
export function avatarModal({ account, busy, onPickAvatar, onClose }) {
  return modal(t("Tu avatar"), onClose,
    h("div", { class: "m-avatars" },
      Array.from({ length: AVATAR_COUNT }, (_, i) => i + 1).map((n) =>
        h("button", {
          class: "m-avatar-pick" + (account?.avatar === n ? " current" : ""), disabled: busy,
          "aria-label": t("Avatar {n}", { n }), onclick: () => onPickAvatar(n),
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
// La ficha de las fichas gratis salta, gira en el aire y vuelve a caer (con un pequeño rebote); al terminar, reclama.
let jumping = false;
function coinJump(onClaim) {
  const img = document.querySelector(".m-claim-img");
  if (jumping) return;
  if (!img || matchMedia("(prefers-reduced-motion: reduce)").matches) return onClaim();
  jumping = true;
  img.animate([
    { transform: "translateY(0) rotateY(0deg) scale(1)", easing: "cubic-bezier(.2,.7,.4,1)" },
    { transform: "translateY(-90px) rotateY(540deg) scale(1.15)", offset: 0.45, easing: "cubic-bezier(.6,0,.9,.5)" },
    { transform: "translateY(0) rotateY(1080deg) scale(1)", offset: 0.82, easing: "ease-out" },
    { transform: "translateY(-12px) rotateY(1080deg) scale(1)", offset: 0.91, easing: "ease-in" },
    { transform: "translateY(0) rotateY(1080deg) scale(1)" },
  ], { duration: 1200 }).finished.catch(() => {}).finally(() => { jumping = false; onClaim(); });
}

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
