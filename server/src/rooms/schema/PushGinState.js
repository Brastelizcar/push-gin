import { schema, t } from "@colyseus/schema";

// Solo información PÚBLICA y liviana. Las manos y el resto del juego NO viajan por aquí:
// cada jugador recibe su propia vista privada con el mensaje "state" (ver PushGinRoom).
export const PushGinState = schema({
  phase: t.string().default("lobby"), // lobby | playing | roundOver | finished
});
