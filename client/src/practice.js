// Modo práctica: una partida contra bots que corre COMPLETA en el navegador (no necesita servidor).
// Usa la misma lógica que el servidor (Match) y una "sala local" con la misma forma que la de Colyseus
// (send / leave), así la mesa funciona igual que en línea.
import { Match } from "../../src/logic/match.js";
import { botMove } from "../../src/logic/bot.js";

export const BOT_NAMES = ["Rosa", "Tomás", "Lucía"];
const ME = "tú";
const BOT_DELAY = [700, 1300]; // ms que "piensa" cada bot (al azar dentro del rango)

/**
 * Empieza una partida de práctica. bots: 1 a 3. turnTime: segundos por turno (0 = sin límite).
 * handlers: los mismos que net.connect ({ onState, onEvent, onRejected, onLeave }).
 * Devuelve la sala local: { roomId, send(type, msg), leave() }.
 */
export function startPractice({ name, level = null, bots = 2, turnTime = 0, rng }, handlers) {
  const match = new Match({ turnTime, rng });
  match.addPlayer(ME, name, level);
  BOT_NAMES.slice(0, Math.max(1, Math.min(3, bots))).forEach((n, i) => match.addPlayer(`bot${i + 1}`, n));
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
      const wait = BOT_DELAY[0] + Math.random() * (BOT_DELAY[1] - BOT_DELAY[0]);
      botTimer = setTimeout(() => {
        const mv = botMove(match.viewFor(pid));
        const res = match.handle(pid, mv.type, mv.msg);
        // Un bot nunca debería equivocarse; si pasa, descarta para no trabar la partida.
        if (!res.ok) {
          console.warn("Bot rechazado:", res.error);
          const g = match.game;
          if (g.phase === "start") match.handle(pid, "takeDiscard");
          return emit(match.handle(pid, "discard", { cardId: g.hands[pid][0].id }).event);
        }
        emit(res.event);
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
  setTimeout(() => emit(), 0);
  return room;
}
