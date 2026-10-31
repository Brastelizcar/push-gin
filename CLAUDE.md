# Push Gin — guía para trabajar en este repositorio

Juego de cartas multijugador (2 a 4) en el navegador. Todo el texto de la interfaz y los comentarios van en **español**.

## Estructura
- `src/logic/` — lógica PURA del juego (sin red ni DOM). La usan el servidor y el cliente.
  - `cards.js` cartas, baraja (3 barajas), puntos · `melds.js` tríos/cuartetos/consecutivos, enganche, robo de 2
  - `rounds.js` requisitos de las 5 rondas · `game.js` clase `Round` (estado y turnos de una ronda)
  - `turn.js` jugada completa de un turno, validada de una vez (`resolveTurn`) · `plan.js` ayudas para agrupar cartas
  - `match.js` la PARTIDA (jugadores, 5 rondas, vistas privadas, temporizador). La usan la sala del servidor y la práctica
  - `bot.js` jugador automático (solo ve su propia vista) · `progress.js` XP, niveles y fichas
- `test/` — pruebas de la lógica (`npm test` en la raíz, `node --test`).
- `server/` — servidor Colyseus 0.18 (`PushGinRoom`). Pruebas con mocha (`cd server && npm test`).
- `client/` — Vite + JS sin framework. `table.js` es la mesa; `main.js` las pantallas. Pruebas puras en `client/test` (`cd client && npm test`).
- `docs/` — reglas (`reglas-push-gin.md`), especificación de UI de cartas, mockup de estilo y `docs/referencias/` (imágenes de disposición de menús).

## Reglas del juego (decididas; no cambiarlas sin preguntar)
- 3 barajas, 10 cartas por jugador, 1 carta boca arriba en el descarte. 5 rondas:
  1) 3 tríos · 2) trío + consecutivo de 5 · 3) 2 consecutivos de 6 · 4) 4 tríos · 5) cuarteto + consecutivo de 8.
- Orden A,2,3…K. El As solo vale 1: no hay Q-K-A ni K-A-2.
- **El 2 es número y comodín.** Como número forma tríos de 2s y va en su lugar (A-2-3). Como comodín vale el número
  de la POSICIÓN donde se coloca (las cartas viajan con `ordered:true`). Un 2 que hace de sí mismo no se puede robar.
- Cada plante necesita ≥1 carta que no sea 2 (salvo tríos/cuartetos de 2s).
- Turno: (robar 2s opcional, solo si no te has plantado) → tomar el descarte o hacer **push** (carta ciega + descarte
  viejo van a la MANO del siguiente; tú robas una) → plantarte / bajar / enganchar → **descartar** (obligatorio).
- Enganchar y bajar solo **después de tomar carta**. Robar 2s solo **antes** de tomar carta; si robas, no te plantas ese turno.
- **No se planta y engancha en el mismo turno:** primero te plantas; enganchas desde tu próximo turno (bajar extra sí).
- Plantarse exige EXACTAMENTE el requisito de la ronda. Tras jugar debes conservar ≥1 carta para descartar:
  se gana descartando la última carta. Puntos de lo que queda en mano: A=15, 2=20, 10/J/Q/K=10, 3–9=5. Gana el menor total.
- Quién empieza la ronda: jugador `roundIndex % nJugadores` (provisional).
- Mazo agotado: push exige ≥2 cartas en el mazo; si tras un descarte quedan <2, se juega **una vuelta más** (cada
  jugador un turno, solo tomando el descarte; `Round.finalTurnsLeft`) y luego la ronda termina sin ganador y todos
  cuentan su mano (si alguien se queda sin cartas en esa vuelta, gana la ronda).
- Abandonar a media partida: pierdes la cuota y el XP (`Match.left`, `gameRewards(..., left)`); tus turnos se juegan
  solos. Si queda un solo jugador, la partida termina y él gana.
- Conexión caída a media partida: se guarda el asiento **60 s** (`onDrop` + `allowReconnection`, `Match.drop/rejoin`).
  La librería reintenta sola y, si recargas la página, `net.resume()` vuelve con el token guardado. La partida espera;
  si no vuelve a tiempo, cuenta como abandonar. En la sala de espera no se guarda el cupo.
- Temporizador (opcional, 30–120 s): si se acaba, el turno se juega solo (toma el descarte y lo devuelve, o descarta
  la carta que tomó).

## Jugada validada (Lote 2)
- En la fase `main` el cliente arma TODA su jugada localmente (grupos a la mesa, enganches, carta a descartar) y la
  envía con un solo mensaje `playTurn` `{ plant?, melds?, hooks?, discard }`. `Round.playTurn` la aplica de forma
  ATÓMICA: si algo es inválido no cambia nada y el turno no pasa. El servidor avisa a todos con el evento `"turn"`.
- Robar 2s, tomar el descarte y push siguen siendo mensajes inmediatos (fase `start`).
- Pruebas manuales: en desarrollo, `client.create("push_gin", { name, seed })` reparte con semilla (`seededRng`).

## Convenciones
- El servidor es la autoridad: el cliente valida para dar feedback, el servidor valida otra vez.
- Las vistas son personalizadas (`#viewFor`): nunca enviar manos ajenas durante la ronda.
- DOM con `h()` de `client/src/dom.js` (textContent, nunca innerHTML).
- Estilo visual: fieltro verde, madera y dorado (variables CSS de `client/src/style.css`, mockup
  `docs/mockups/push-gin-vista-general-v6.html`). Las imágenes de `docs/referencias/` son solo referencia de DISPOSICIÓN.
- Toda función nueva lleva pruebas. Antes de cada commit: las tres suites (raíz, client, server) deben pasar.
- Secretos solo en variables de entorno; nunca en el repositorio.

## Estado
- Lote 1 (juego completo multijugador): hecho.
- Lote 2 (jugada validada): hecho. Grupos válidos de la mano (tramos entre espacios) se marcan y se arrastran
  enteros desde su primera o última carta; ✓ valida con `buildTurn` (client/src/staging.js) antes de enviar.
- Lote 3 (cuentas y menús): hecho. Ver "Cuentas" abajo.
- Lote 4 (práctica con bots, temporizador): hecho. La práctica corre en el navegador (`client/src/practice.js`, una
  "sala local" con la misma forma que la de Colyseus); el tiempo de turno se elige en Juego privado y en Práctica.

## Cuentas (Lote 3)
- `src/logic/progress.js`: XP por puesto (100/50/30/10), nivel N→N+1 = 100×N XP, pozo de cuotas, fichas gratis (300 / 24 h).
- Base de datos: PostgreSQL en **Neon** (variable `DATABASE_URL`); sin ella, `MemoryStore` (local/pruebas). Misma interfaz.
- **Token + hash:** cada dispositivo tiene su token (32 bytes); la tabla `sessions` guarda solo `sha256(token)`.
  El token va en `Authorization: Bearer`, nunca en la URL. La sala lo recibe en la opción `token` (`onAuth`).
- **Sincronización:** `POST /api/sync/code` da un código corto (8 caracteres, `src/logic/sync.js`) de UN solo uso que
  vence a los 10 minutos (hora de la base de datos); se guarda solo su hash. `POST /api/sync/redeem` lo canjea de forma
  atómica y entrega un token NUEVO. Canjes limitados por IP.
- **XP y fichas los decide siempre el servidor:** premios de la partida, cuota (a todos o a nadie) y fichas gratis.
  Ninguna ruta acepta esos valores del cliente; la práctica (en el navegador) no da nada.
- Cliente: `account.js` (API), `menus.js`/`menus.css`, `settings.js`, `sound.js`.

