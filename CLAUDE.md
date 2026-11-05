# Push Gin — guía para trabajar en este repositorio

Juego de cartas multijugador (3 a 4 en la mesa; si faltan, completan bots) en el navegador. El código y los comentarios
van en **español**; la interfaz está en español e inglés (ver "Idiomas").

## Estructura
- `src/logic/` — lógica PURA del juego (sin red ni DOM). La usan el servidor y el cliente.
  - `cards.js` cartas, baraja (3 barajas), puntos · `melds.js` tríos/cuartetos/consecutivos, enganche, robo de 2
  - `rounds.js` requisitos de las 5 rondas · `game.js` clase `Round` (estado y turnos de una ronda)
  - `turn.js` jugada completa de un turno, validada de una vez (`resolveTurn`) · `plan.js` ayudas para agrupar cartas
  - `match.js` la PARTIDA (jugadores, 5 rondas, vistas privadas, temporizador). La usan la sala del servidor y la práctica
  - `bot.js` jugador automático (solo ve su propia vista; nombres y avatares de los bots) · `progress.js` XP, niveles y fichas
  - `avatars.js` los 10 avatares (`client/public/avatars/avatar-N.webp`, recortados de `docs/referencias/avatares*.png`:
    1 y 2 de avatares4/5, 3–8 de avatares1/2, 9 y 10 de avatares3;
    por dentro del aro dorado y con el fondo verde pasado a vino tinto, para que no se pierdan en el fieltro; el fondo
    de 3–8 se llevó a la luz y saturación de los de avatares3/4/5 para que todos tengan el mismo vino tinto).
    Al cambiar una imagen, sube `ASSETS_V` (client/src/dom.js): va en la dirección para que el navegador no use la vieja
- `test/` — pruebas de la lógica (`npm test` en la raíz, `node --test`).
- `server/` — servidor Colyseus 0.18 (`PushGinRoom`). Pruebas con mocha (`cd server && npm test`).
- `client/` — Vite + JS sin framework. `table.js` es la mesa; `main.js` las pantallas. Pruebas puras en `client/test` (`cd client && npm test`).
- `docs/` — reglas (`reglas-push-gin.md`), especificación de UI de cartas, mockup de estilo y `docs/referencias/` (imágenes de disposición de menús).

## Reglas del juego (decididas; no cambiarlas sin preguntar)
- 3 barajas, 10 cartas por jugador, 1 carta boca arriba en el descarte. 5 rondas:
  1) 3 tríos · 2) trío + consecutivo de 5 · 3) 2 consecutivos de 6 · 4) 4 tríos · 5) cuarteto + consecutivo de 8.
- Orden A,K,Q,J,10…3: un consecutivo va de 3 a A (valores 3…14, `RUN_LOW`/`RUN_HIGH`); el As solo va después de la
  K, sin vuelta (no hay A-3 ni K-A-3). Consecutivos: mismo palo, 12 cartas como máximo. En pantalla se ven de mayor a
  menor (A K Q … 3): en la mesa, soltar a la izquierda engancha arriba; 789 los ordena igual.
- **El 2 es SOLO comodín.** Vale el número del trío, o en un consecutivo el de la POSICIÓN donde se coloca (las cartas
  viajan con `ordered:true`, ascendente o descendente). No hay tríos de 2s; cualquier 2 de la mesa se puede robar.
- Tríos/cuartetos: mismo número, **el palo no importa** y pueden tener más de 4 cartas (se enganchan sin límite).
- Cada plante necesita ≥1 carta que no sea 2.
- Turno: (robar 2s opcional, solo si no te has plantado) → tomar el descarte o hacer **push** (carta ciega + descarte
  viejo van a la MANO del siguiente; tú robas una) → plantarte / bajar / enganchar → **descartar** (obligatorio).
- Enganchar y bajar solo **después de tomar carta**. Robar 2s solo **antes** de tomar carta; si robas, no te plantas ese turno.
- **No se planta y engancha en el mismo turno:** primero te plantas; enganchas desde tu próximo turno (bajar extra sí).
- **Plante completo sale de la mesa:** solo un consecutivo de 3 a A (12 cartas) desaparece al completarse
  (`isCompleteMeld`, `Round._commit`; evento `turn` con `cleared`). Los grupos del mismo número nunca salen.
- El requisito de la ronda es el **MÍNIMO** (`matchPlant`): un grupo pedido puede ser más grande (un cuarteto cumple
  un trío) y al plantarte puedes bajar grupos de más (van en `melds` del mismo `playTurn`). Tras jugar debes conservar ≥1 carta para descartar:
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
  casilla vacía (también los espacios entre grupos). SIEMPRE 2 filas de alto fijo (`--hwmax`) y al inicio 20 casillas
  (10 por fila, `MIN_COLS`) con las cartas casi pegadas (`CELL_AIR`). Atril de madera de una pieza (diseño de
  `docs/referencias/idea atril.jpg`): empieza a un cuarto de la fila de arriba (las cartas sobresalen) y abajo un borde
  más oscuro. La fila de abajo se monta un poco sobre la de arriba (margen negativo en `.row-bottom`: `row-gap` no
  admite negativos). Alto fijo; con más cartas CRECE a lo ancho (como `atril agrandado.png`) y las cartas conservan su
  tamaño; solo si ya no cabe entre los jugadores y el riel, se achican. Centrado y pegado al marco de madera de abajo
  (tapa el filo del fieltro), sin franja oscura; su degradé termina en el color del marco.
  Columna de jugadores angosta; el avatar se ajusta al ALTO disponible y al número de asientos (`--n`, container query):
  en ventana normal (no pantalla completa) con 4 jugadores todos caben; si la columna mide <440 px se oculta el estado. Los avisos de la mano van encima del atril.
  Las casillas vacías no llevan marco. Tu jugada sin confirmar se ve en su propia fila, debajo de los plantes de la mesa.
  Fin de ronda: la tabla va de menor a mayor total.
- **Arrastre protegido:** mientras arrastras (o mantienes presionada) una carta, la mesa NO se redibuja
  (`ui.dragging`): lo que llegue del servidor (jugada en vivo de otro, push, bots) espera y se dibuja al soltar.
  Antes, un redibujo a mitad del arrastre hacía perder el movimiento.
- **Jugada en vivo:** lo que el jugador en turno arma sin confirmar (grupos y enganches) lo ven los demás en tiempo real
  (mensaje `stage` → `Match.setLive`; la vista de los DEMÁS trae `live`, que se olvida al pasar el turno). Se ve con
  borde dorado punteado y «X está armando su jugada…»; al confirmar, sus cartas aparecen de translúcidas a sólidas. Revela cartas aunque
  luego las devuelva a la mano (decidido así). Mensajes `stage` inválidos se ignoran sin rechazo.
- Los bots usan avatares que no tenga ninguna persona de la mesa (`botAvatars`). Antes de terminar un turno en que
  bajan o enganchan, muestran su jugada en vivo `BOT_SHOW_MS` (1,5 s; `liveOfTurn`), en el servidor y en la práctica local.
- Mesa (UI): cartas de 4 colores (`suitColor`: ♥ rojo, ♠ negro, ♦ azul, ♣ verde), número grande al centro y palo
  pequeño en la esquina (también la del descarte). El 2 (comodín) se dibuja como una P grande con los 4 palos en las esquinas, del
  color de su palo (`cardEl`/`faceEl`, ref. `docs/referencias/Comodin.png`). Riel: «Pozo» (cuota × personas, solo con cuota).
  Botón ☰: menú de la partida (ajustes de sonido, reglas, ayuda, salir al menú de inicio = abandonar).
  Disposición (cuadrícula en `.table-felt`: barra arriba como franja pegada al borde y de lado a lado, tablero sin
  recuadro, riel que empieza a la altura del tablero, atril centrado en la mesa entera y sin sombra; el ícono de cartas
  de cada jugador es un reverso rojo; el aviso de turno va en una sola línea; ref. `docs/referencias/diposicion del tablero.png`, solo disposición): columna de jugadores a la izquierda
  (avatar, nombre, cartas, puntos; tú abajo; repartidos con el mismo espacio entre ellos), mesa grande con las cartas de cada plante lado a lado, tu mano en un
  atril de madera y el riel a la derecha. El jugador EN TURNO lleva un aro dorado alrededor del avatar que se va
  vaciando: es su reloj (`--t` 1→0); su asiento no lleva marco. Botón «Terminar turno» dorado. Avisos (toast) justo encima de la mano. Sin botón de tamaño de cartas.
- Animaciones: reparto y tu carta tras un push (`flyFromDeck`), tomar el descarte (`flyCard`), push en dos tiempos
  (si te lo hacen a ti, las 2 cartas vuelan del descarte a tus casillas), cartas nuevas en la mesa (NO vuelan: aparecen
  de translúcidas a sólidas, `applyFlights`/`detectRemotePlay`), plantes que se reacomodan o se achican para dar espacio
  (en cada redibujo, `slideMelds`), lo que hacen los demás con el descarte (`detectRemoteDiscard` + `flyBetween`) y el plante
  completo que sale de la mesa (`noteCleared`/`startClearing`: se voltean una a una y se apagan; la mesa le guarda
  el lugar con un hueco hasta que desaparecen; luego los demás plantes se deslizan a su lugar nuevo). Bots: 1,5–2,4 s por movimiento.
- Lote 3 (cuentas y menús): hecho. Ver "Cuentas" abajo.
- Lote 4 (práctica con bots, temporizador): hecho. **Con cuenta**, la práctica se juega en el SERVIDOR (sala con la
  opción `practice: nBots`; los bots juegan en `PushGinRoom`) y da la **mitad del XP** (`PRACTICE_XP_FACTOR`), sin fichas.
  Sin cuenta o sin conexión corre en el navegador (`client/src/practice.js`) y no da XP. El tiempo de turno se elige
  en Juego privado y en Práctica.

## Idiomas y tutorial
- **Idiomas** (`client/src/i18n.js`, `client/src/en.js`): el texto en ESPAÑOL es la clave. Todo texto visible va con
  `t("…", { datos })` (con `{marcadores}`); `toast()` traduce solo, y así también los errores que manda el servidor
  (que siempre llegan en español). Claves que terminan en `{rest}`: prefijos de mensajes con datos al final. Números
  con `num()`. Texto nuevo → agregar su inglés en `en.js`: `client/test/i18n.test.js` falla si falta alguno o si los
  marcadores no coinciden. El idioma se guarda en `localStorage` (`pushgin:lang`; si no hay, el del navegador).
- Botón de idioma (`langButton`, ref. `docs/referencias/btonidioma*.png`): bandera redonda + nombre, fondo vino tinto como los avatares; español con la
  bandera de **Colombia** (`client/public/flags/co.svg`), inglés mitad EE. UU. / mitad Reino Unido (`en.svg`). Está
  arriba a la izquierda en la bienvenida y en Ajustes; al tocarlo cambia al otro idioma y se redibuja todo.
- **Tutorial** (`client/src/tutorial.js`): al crear la cuenta se entra directo (también desde Ajustes → Tutorial, fuera
  de partida). Es una ronda de práctica local con reparto preparado (`tutorialSetup`, opción `setup` de startPractice)
  y bots que nunca hacen push (`noPush`). Rosa empieza ya plantada con un comodín en su trío de 5. Un "entrenador"
  explica cada paso (`nextStep`, función pura que avanza con lo que pasa en la mesa; usa `stageInfo()` de table.js),
  en 3 turnos: 1) robas el comodín de Rosa, tomas el descarte y descartas (no te plantas porque robaste); 2) push y
  te plantas; 3) enganchas el 7♣ y ganas la ronda. Antes, un paso muestra el 2 de siempre → la carta P (`cardEl(...,
  plain)` en `cardview.js`, que dibuja todas las cartas). Puntos y consejos al final.
  En el primer turno el tutorial bloquea lo que lo haría imposible de terminar (`tutorialLocks` → `renderTable(...,
  { locks })`): tomar carta antes de robar el comodín y hacer push en vez de tomar el 9♦ (avisa qué hacer). «Saltar» va en la barra de la mesa,
  a la izquierda de pantalla completa (`renderTable(..., { onSkip })`).

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
- **Avatar:** cada cuenta nueva recibe uno al azar (1–10, columna `accounts.avatar`; cuentas viejas: `avatarFor(id)`).
  Se cambia tocando el avatar en el menú de inicio (`POST /api/account/avatar`). Los jugadores lo llevan en la vista.
- Cliente: `account.js` (API), `menus.js`/`menus.css`, `settings.js`, `sound.js`. Los menús ocupan toda la pantalla.
- Menú de inicio (ref. `docs/referencias/barra superior.png` y `barra de monedas gratis/activa.png`): barra superior
  con avatar grande, nombre, XP con barra dorada, caja de fichas con ícono grande y botones grandes. La ficha es
  `client/public/coin.webp` (`coinImg`, de `ICONO MONEDA.png`). Abajo, la barra de fichas gratis: la ficha sobresale
  al centro, apagada (gris) mientras corre el tiempo, con la cuenta regresiva y su barra; dorada y con el botón
  «Recoger 300 fichas» cuando ya se puede. Se recoge con el botón o tocando la ficha: salta, gira en el aire y vuelve
  a caer (`coinJump`, 1,2 s) y después se reclaman.

