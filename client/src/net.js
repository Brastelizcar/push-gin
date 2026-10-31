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
 * account: código de sincronización de tu cuenta (el servidor la verifica). entryFee: cuota (solo al crear).
 * handlers: { onState(view), onEvent(ev), onAccount(account), onRejected(error), onLeave() }
 */
export async function connect({ mode, name, roomCode, account, entryFee = 0 }, handlers) {
  const opts = { name, ...(account ? { code: account } : {}) };
  const start = () => (mode === "create" ? client.create("push_gin", { ...opts, entryFee }) : client.joinById(roomCode, opts));
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
  startKeepAlive();
  room.onLeave(stopKeepAlive);

  room.onMessage("state", (view) => handlers.onState(view));
  room.onMessage("event", (ev) => handlers.onEvent?.(ev));
  room.onMessage("account", (acc) => handlers.onAccount?.(acc));
  room.onMessage("rejected", ({ error }) => handlers.onRejected(error));
  room.onLeave(() => handlers.onLeave());

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
