import { Client } from "@colyseus/sdk";

// Dirección del servidor. En producción se define en client/.env.production (VITE_SERVER_URL=wss://...).
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";
export const HTTP_URL = SERVER_URL.replace(/^ws/, "http"); // wss:// → https://
export const IS_REMOTE = !/^wss?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(SERVER_URL);
export const SERVER_CONFIGURED = !SERVER_URL.includes("CAMBIA-ESTO");
const KEEPALIVE_MS = Number(import.meta.env.VITE_KEEPALIVE_MS) || 4 * 60 * 1000;
const client = new Client(SERVER_URL);

// El plan gratuito de Render duerme el servidor tras ~15 min SIN peticiones HTTP (una conexión
// abierta no cuenta). Por eso: se le "toca la puerta" al abrir la página (lo despierta mientras
// escribes tu nombre) y mientras estás en una sala, cada 4 minutos (para que no se apague en plena partida).
export const wakeServer = () => fetch(`${HTTP_URL}/hi`, { mode: "no-cors", cache: "no-store" }).then(() => true, () => false);
let keepAlive = null;
const stopKeepAlive = () => { clearInterval(keepAlive); keepAlive = null; };
const startKeepAlive = () => { stopKeepAlive(); if (IS_REMOTE) keepAlive = setInterval(wakeServer, KEEPALIVE_MS); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Si pasa el tiempo, se descarta el intento; si llega tarde a conectar, se sale de esa sala fantasma.
function withTimeout(start, ms) {
  return new Promise((resolve, reject) => {
    let late = false;
    const t = setTimeout(() => { late = true; reject(new Error("timeout")); }, ms);
    start().then(
      (room) => { clearTimeout(t); late ? room.leave() : resolve(room); },
      (e) => { clearTimeout(t); if (!late) reject(e); }
    );
  });
}
// Respuestas definitivas del servidor (no tiene sentido reintentar): código inexistente, sala cerrada o llena.
const isDefinitive = (e) => /not found|locked|full|invalid/i.test(String(e?.message ?? e));

/**
 * Crea una sala ("create") o se une con su código de 4 dígitos ("join"). Devuelve la room de Colyseus.
 * token: el de tu cuenta en este dispositivo (el servidor lo verifica). entryFee / turnTime: solo al crear.
 * handlers: { onState(view), onEvent(ev), onAccount(account), onRejected(error), onLeave() }
 */
export async function connect({ mode, name, roomCode, token, entryFee = 0, turnTime = 0 }, handlers) {
  const opts = { name, ...(token ? { token } : {}) };
  const start = () => (mode === "create" ? client.create("push_gin", { ...opts, entryFee, turnTime }) : client.joinById(roomCode, opts));
  let room, tries = 0;
  for (;;) {
    try { room = await withTimeout(start, 40000); break; }
    catch (e) {
      // Servidor dormido (Render): se espera y se reintenta hasta ~4 veces antes de rendirse.
      if (isDefinitive(e) || !IS_REMOTE || ++tries >= 4) throw e;
      handlers.onWaking?.(tries);
      await sleep(6000);
    }
  }
  return wire(room, handlers);
}

// ---------- reconexión ----------
// Si se cae la conexión a media partida, el servidor te guarda el asiento RECONNECT_SECONDS. La librería reintenta
// sola (con espera creciente, hasta 5 s entre intentos: 17 intentos ≈ 61 s). Si recargas o cierras la página, al
// volver a abrirla se usa el token guardado aquí para volver a la misma partida.
export const RECONNECT_SECONDS = 60;
const RECONNECT_KEY = "pushgin:reconnect";
const saveReconnect = (room) => {
  try { localStorage.setItem(RECONNECT_KEY, JSON.stringify({ token: room.reconnectionToken, at: Date.now() })); } catch {}
};
const clearReconnect = () => { try { localStorage.removeItem(RECONNECT_KEY); } catch {} };
export function savedReconnect() {
  try {
    const r = JSON.parse(localStorage.getItem(RECONNECT_KEY));
    if (r?.token && Date.now() - r.at < RECONNECT_SECONDS * 1000) return r.token;
  } catch {}
  clearReconnect();
  return null;
}

// Vuelve a la partida de la que te desconectaste (recargaste o se cerró la página). Devuelve la room o null.
export async function resume(handlers) {
  const token = savedReconnect();
  if (!token) return null;
  try { return wire(await client.reconnect(token), handlers); }
  catch { clearReconnect(); return null; }
}

// handlers: además de los de connect, onDrop() (se perdió la conexión) y onReconnect() (volvió).
function wire(room, handlers) {
  room.reconnection.maxRetries = 17;
  startKeepAlive();
  saveReconnect(room);
  // Mientras sigas en la sala se renueva la marca de tiempo: si cierras la página, cuentan los 60 s desde ese momento.
  const touch = setInterval(() => saveReconnect(room), 5000);
  const onHide = () => saveReconnect(room);
  window.addEventListener("pagehide", onHide);
  room.onLeave(() => {
    stopKeepAlive(); clearInterval(touch); window.removeEventListener("pagehide", onHide); clearReconnect();
    handlers.onLeave();
  });
  room.onDrop(() => handlers.onDrop?.());
  room.onReconnect(() => { saveReconnect(room); room.send("requestState"); handlers.onReconnect?.(); });

  room.onMessage("state", (view) => handlers.onState(view));
  room.onMessage("event", (ev) => handlers.onEvent?.(ev));
  room.onMessage("account", (acc) => handlers.onAccount?.(acc));
  room.onMessage("rejected", ({ error }) => handlers.onRejected(error));

  // Importante: el mensaje de bienvenida llega antes de registrar los listeners,
  // así que se pide la vista explícitamente.
  room.send("requestState");
  return room;
}

// Acciones (el servidor valida todo; aquí solo se envían).
export const actions = {
  start: (room) => room.send("start"),
  nextRound: (room) => room.send("nextRound"),
  takeDiscard: (room) => room.send("takeDiscard"),
  push: (room) => room.send("push"),
  // Jugada completa del turno: { plant, melds, hooks, discard }. El servidor la aplica toda o nada.
  playTurn: (room, turn) => room.send("playTurn", turn),
  steal2: (room, meldId, index, cardId) => room.send("steal2", { meldId, index, cardId }),
};
