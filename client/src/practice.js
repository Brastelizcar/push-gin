// Práctica SIN conexión: una partida contra bots que corre COMPLETA en el navegador (no necesita servidor) y no da
// XP. Con cuenta y servidor, la práctica se juega en el servidor (sala con `practice`) y da la mitad del XP.
// Usa la misma lógica que el servidor (Match) y una "sala local" con la misma forma que la de Colyseus
// (send / leave), así la mesa funciona igual que en línea.
import { Match, TABLE_MIN, TABLE_MAX } from "../../src/logic/match.js";
import { botMove, BOT_NAMES, botAvatars, liveOfTurn, BOT_SHOW_MS } from "../../src/logic/bot.js";

export { BOT_NAMES };
export const ME = "tú";
const BOT_DELAY = [1500, 2400]; // ms que "piensa" cada bot antes de cada movimiento (al azar dentro del rango)

/**
 * Empieza una partida de práctica. bots: 2 o 3 (mínimo 3 en la mesa). turnTime: segundos por turno (0 = sin límite).
 * handlers: los mismos que net.connect ({ onState, onEvent, onRejected, onLeave }).
 * Devuelve la sala local: { roomId, send(type, msg), leave() }.
 */
// botDelay: [mín, máx] ms que piensa cada bot · botShow: ms que se ve su jugada antes de terminar (las pruebas los acortan).
// setup(match): se llama al empezar la partida, antes de mostrarla (el tutorial prepara ahí un reparto fijo).
// noPush: los bots nunca hacen push, siempre toman el descarte (el tutorial: así no te pasan cartas).
export function startPractice({ name, level = null, avatar = null, bots = 2, turnTime = 0, rng, botDelay = BOT_DELAY, botShow = BOT_SHOW_MS, setup, noPush = false }, handlers) {
  const match = new Match({ turnTime, rng });
  match.addPlayer(ME, name, level, avatar);
  const nBots = Math.max(TABLE_MIN - 1, Math.min(TABLE_MAX - 1, bots));
  const avatars = botAvatars(nBots, [...match.avatars.values()]);
  BOT_NAMES.slice(0, nBots).forEach((n, i) => match.addPlayer(`bot${i + 1}`, n, null, avatars[i]));
  let closed = false;
  let botTimer = null, turnTimer = null;

  const emit = (event) => {
    if (closed) return;
    if (event) handlers.onEvent?.(event);
    handlers.onState(match.viewFor(ME));
    schedule();
  };

  // Después de cada cambio: si le toca a un bot, juega tras una pausa; y se programa el fin del turno.
  function schedule() {
    clearTimeout(botTimer); clearTimeout(turnTimer);
    if (closed) return;
    if (match.phase === "roundOver") return;               // espera a que pulses "Siguiente ronda"
    if (match.phase !== "playing") return;
    const pid = match.game.currentPlayer;
    if (pid !== ME) {
      const wait = botDelay[0] + Math.random() * (botDelay[1] - botDelay[0]);
      const play = (mv) => {
        if (closed || match.phase !== "playing" || match.game.currentPlayer !== pid) return;
        const res = match.handle(pid, mv.type, mv.msg);
        // Un bot nunca debería equivocarse; si pasa, descarta para no trabar la partida.
        if (!res.ok) {
          console.warn("Bot rechazado:", res.error);
          const g = match.game;
          if (g.phase === "start") match.handle(pid, "takeDiscard");
          return emit(match.handle(pid, "discard", { cardId: g.hands[pid][0].id }).event);
        }
        emit(res.event);
      };
      botTimer = setTimeout(() => {
        let mv = botMove(match.viewFor(pid));
        if (noPush && mv.type === "push") mv = { type: "takeDiscard" };
        // Si va a bajar o enganchar, primero se ve su jugada en vivo y un momento después termina el turno.
        const live = mv.type === "playTurn" ? liveOfTurn(mv.msg) : null;
        if (live && match.setLive(pid, live).ok) {
          handlers.onState(match.viewFor(ME));
          botTimer = setTimeout(() => play(mv), botShow);
        } else play(mv);
      }, wait);
    } else if (match.deadline != null) {
      turnTimer = setTimeout(() => { const ev = match.timeoutTurn(); ev ? emit(ev) : schedule(); }, Math.max(0, match.deadline - Date.now()) + 30);
    }
  }

  const room = {
    roomId: "práctica",
    practice: true,
    send(type, msg) {
      if (closed || type === "requestState") return closed ? undefined : handlers.onState(match.viewFor(ME));
      if (type === "stage") return;                 // la jugada en vivo es para otras personas: aquí solo hay bots
      // Igual que en red: la respuesta llega "después" (el cliente nunca cambia el estado por su cuenta).
      setTimeout(() => {
        if (closed) return;
        const res = match.handle(ME, type, msg);
        if (!res.ok) return handlers.onRejected(res.error);
        emit(res.event);
      }, 0);
    },
    leave() {
      if (closed) return;
      closed = true;
      clearTimeout(botTimer); clearTimeout(turnTimer);
      handlers.onLeave?.();
    },
    match, // (pruebas)
  };

  match.handle(ME, "start");
  setup?.(match);
  setTimeout(() => emit(), 0);
  return room;
}
