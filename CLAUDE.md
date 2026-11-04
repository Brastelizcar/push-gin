# Push Gin — guía para trabajar en este repositorio

Juego de cartas multijugador (3 a 4 en la mesa; si faltan, completan bots) en el navegador. Todo el texto de la interfaz y los comentarios van en **español**.

## Estructura
- `src/logic/` — lógica PURA del juego (sin red ni DOM). La usan el servidor y el cliente.
  - `cards.js` cartas, baraja (3 barajas), puntos · `melds.js` tríos/cuartetos/consecutivos, enganche, robo de 2
  - `rounds.js` requisitos de las 5 rondas · `game.js` clase `Round` (estado y turnos de una ronda)
  - `turn.js` jugada completa de un turno, validada de una vez (`resolveTurn`) · `plan.js` ayudas para agrupar cartas
  - `match.js` la PARTIDA (jugadores, 5 rondas, vistas privadas, temporizador). La usan la sala del servidor y la práctica
  - `bot.js` jugador automático (solo ve su propia vista; nombres y avatares de los bots) · `progress.js` XP, niveles y fichas
  - `avatars.js` los 8 avatares (`client/public/avatars/avatar-N.webp`, recortados de `docs/referencias/avatares*.png`
    por dentro del aro dorado y con el fondo verde pasado a vino tinto, para que no se pierdan en el fieltro)
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
- **Plante completo sale de la mesa:** un cuarteto, o un consecutivo de A a K (13 cartas), desaparece al completarse
  (`isCompleteMeld`, `Round._commit`; evento `turn` con `cleared`). Incluye plantarse con un cuarteto (ronda 5).
- Plantarse exige EXACTAMENTE el requisito de la ronda. Tras jugar debes conservar ≥1 carta para descartar:
  se gana descartando la última carta. Puntos de lo que queda en mano: A=15, 2=20, 10/J/Q/K=10, 3–9=5. Gana el menor total.
- **Jugadores: mínimo 3 y máximo 4 en la mesa** (`TABLE_MIN`/`TABLE_MAX`, `botsRange` en match.js). En juego privado,
  con 2 personas entra 1 bot obligatorio y el anfitrión puede pedir 2 (para ser 4); con 3 puede sumar 1. Los bots no
  pagan cuota ni ganan premios (`gameRewards(..., { bots })`); el pozo es cuota × personas y, si gana un bot, no es de
  nadie. Práctica: 2 o 3 bots. (La lógica acepta 2 jugadores: las pruebas bajan `room.minPlayers` a 2.)
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
- Lote 2 (jugada validada): hecho. Todo se juega ARRASTRANDO (no hay selección de cartas ni botón «A la mesa»).
  Mantener presionada la 1.ª o última carta de un grupo de cartas JUNTAS (`groupAt` en client/src/staging.js) lo toma
  entero (también de a dos: un dúo o un consecutivo de 2, `pairShape`); al soltarlo en la mano quedan juntas pero sueltas (sin agrupación fija). La mesa muestra los plantes sin
  nombres. ✓ valida con `buildTurn` antes de enviar.
- Mano = CUADRÍCULA (`client/src/handgrid.js`, `ui.cells`: id o null por casilla). Cada carta en su casilla; las
  vacías son los espacios (no hay botón Espacio). Soltar en una casilla vacía la ocupa; sobre otra carta, la empuja
  hasta el siguiente hueco. 789/777 dejan una casilla vacía entre grupos. Las cartas que llegan ocupan la PRIMERA
  casilla vacía (también los espacios entre grupos). SIEMPRE 2 filas de alto fijo (`--hwmax`): si no caben, solo las
  cartas se achican. Tu jugada sin confirmar se ve en su propia fila, debajo de los plantes de la mesa.
  Fin de ronda: la tabla va de menor a mayor total.
- Mesa (UI): cartas de 4 colores (`suitColor`: ♥ rojo, ♠ negro, ♦ azul, ♣ verde), número grande al centro y palo
  pequeño en la esquina (también la del descarte). Riel: «Pozo» (cuota × personas, solo con cuota).
  Botón ☰: menú de la partida (ajustes de sonido, reglas, ayuda, salir al menú de inicio = abandonar).
  Disposición (ref. `docs/referencias/diposicion del tablero.png`, solo disposición): columna de jugadores a la izquierda
  (avatar, nombre, cartas, puntos; tú abajo; repartidos con el mismo espacio entre ellos), mesa grande con las cartas de cada plante lado a lado, tu mano en un
  atril de madera y el riel a la derecha. El jugador EN TURNO lleva un aro dorado alrededor del avatar que se va
  vaciando: es su reloj (`--t` 1→0); su asiento no lleva marco. Botón «Terminar turno» dorado. Avisos (toast) justo encima de la mano. Sin botón de tamaño de cartas.
- Animaciones: reparto y tu carta tras un push (`flyFromDeck`), tomar el descarte (`flyCard`), push en dos tiempos
  (si te lo hacen a ti, las 2 cartas vuelan del descarte a tus casillas), jugadas a la mesa (`applyFlights`,
  `detectRemotePlay`), lo que hacen los demás con el descarte (`detectRemoteDiscard` + `flyBetween`) y el plante
  completo que sale de la mesa (`noteCleared`/`startClearing`: se voltean una a una y se apagan; la mesa le guarda
  el lugar con un hueco hasta que desaparecen; luego los demás plantes se deslizan a su lugar nuevo, `slideMelds`). Bots: 1,5–2,4 s por movimiento.
- Lote 3 (cuentas y menús): hecho. Ver "Cuentas" abajo.
- Lote 4 (práctica con bots, temporizador): hecho. **Con cuenta**, la práctica se juega en el SERVIDOR (sala con la
  opción `practice: nBots`; los bots juegan en `PushGinRoom`) y da la **mitad del XP** (`PRACTICE_XP_FACTOR`), sin fichas.
  Sin cuenta o sin conexión corre en el navegador (`client/src/practice.js`) y no da XP. El tiempo de turno se elige
  en Juego privado y en Práctica.

## Cuentas (Lote 3)
- `src/logic/progress.js`: XP por puesto (100/50/30/10), nivel N→N+1 = 100×N XP, pozo de cuotas, fichas gratis (300 / 24 h).
- Base de datos: PostgreSQL en **Neon** (variable `DATABASE_URL`); sin ella, `MemoryStore` (local/pruebas). Misma interfaz.
- **Token + hash:** cada dispositivo tiene su token (32 bytes); la tabla `sessions` guarda solo `sha256(token)`.
  El token va en `Authorization: Bearer`, nunca en la URL. La sala lo recibe en la opción `token` (`onAuth`).
- **Sincronización:** `POST /api/sync/code` da un código corto (8 caracteres, `src/logic/sync.js`) de UN solo uso que
  vence a los 10 minutos (hora de la base de datos); se guarda solo su hash. `POST /api/sync/redeem` lo canjea de forma
  atómica y entrega un token NUEVO. Canjes limitados por IP.
- **XP y fichas los decide siempre el servidor:** premios de la partida, cuota (a todos o a nadie) y fichas gratis.
  Ninguna ruta acepta esos valores del cliente. La práctica da la mitad del XP solo si se juega en el servidor.
- **Avatar:** cada cuenta nueva recibe uno al azar (1–8, columna `accounts.avatar`; cuentas viejas: `avatarFor(id)`).
  Se cambia tocando el avatar en el menú de inicio (`POST /api/account/avatar`). Los jugadores lo llevan en la vista.
- Cliente: `account.js` (API), `menus.js`/`menus.css`, `settings.js`, `sound.js`. Los menús ocupan toda la pantalla.
- Menú de inicio (ref. `docs/referencias/barra superior.png` y `barra de monedas gratis/activa.png`): barra superior
  con avatar grande, nombre, XP con barra dorada, caja de fichas con ícono grande y botones grandes. La ficha es
  `client/public/coin.webp` (`coinImg`, de `ICONO MONEDA.png`). Abajo, la barra de fichas gratis: la ficha sobresale
  al centro, apagada (gris) mientras corre el tiempo, con la cuenta regresiva y su barra; dorada y con el botón
  «Recoger 300 fichas» cuando ya se puede.

