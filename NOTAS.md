# Notas de la lógica (decisiones tomadas)

1. **Push**: la carta ciega + el descarte viejo pasan a la MANO del siguiente jugador (no al pozo).
2. **Orden de las cartas: A,2,3…K.** El As solo vale 1: no existe Q-K-A, ni K-A-2, ni se engancha un As tras la K.
3. **El 2 es número y comodín.**
   - Como número: forma tríos/cuartetos de 2s (palos distintos) y va en su sitio en un consecutivo (A-2-3).
   - Como comodín: en un trío de otro número vale ese número; en un consecutivo vale el número de la
     POSICIÓN donde se ubica (5♥ 6♥ 2 → el 2 es un 7; 2 5♥ 6♥ → el 2 es un 4). Para eso las cartas se
     envían en orden (`ordered:true`) y el orden de tu mano decide la posición.
   - Un 2 que está haciendo de sí mismo (en su lugar, o en un trío de 2s) NO se puede robar.
4. Cada plante necesita ≥1 carta que no sea 2 (salvo los tríos/cuartetos de 2s).
5. **Tras plantarte/bajar/enganchar debes conservar ≥1 carta** para el descarte obligatorio.
6. **Robo de 2s** solo antes de tomar carta; si robas, no puedes plantarte ese turno.
7. **Enganchar/bajar** solo después de tomar carta (descarte o push).
8. **Jugada validada:** plantarse, bajar y enganchar se arman en local y se envían junto con el descarte (`playTurn`).
   Se permite plantarse y enganchar/bajar en el MISMO turno (como ya hacía la lógica).
9. Quién empieza la ronda: jugador `roundIndex % nJugadores` (provisional).

## Pendientes decididos con el usuario (lotes siguientes)
- ✅ Lote 2 (hecho): agrupación automática con espacio, arrastrar grupos completos a la mesa y validar la jugada
  entera al terminar el turno (sin dejar pasar si es inválida).
- ✅ Lote 3 (hecho): cuentas (sin correo, con código de sincronización), nivel/XP (1.º 100, 2.º 50, 3.º 30, 4.º 10),
  fichas de póker (+300 cada 24 h), menú principal, ajustes, juego privado y sala de espera. Requiere BASE DE DATOS.
- ✅ Lote 4 (hecho): práctica contra la máquina y temporizador de turno.

## Decisiones del Lote 3
- Base de datos: Supabase (PostgreSQL gratis). Cuentas nuevas empiezan con 0 fichas y pueden reclamar 300 de inmediato.
- Cuotas permitidas: 0, 100, 200, 300, 500, 1000. El ganador se lleva el pozo (empate: se reparte).
  Si alguien sale a mitad de partida, su cuota no se devuelve.
- XP solo en partidas con cuenta. Los empatados comparten el mejor puesto (y su XP).
- Menú de juego privado: en lugar de la lista de amigos de la referencia, un panel "Unirse con código"
  (no hay sistema de amigos). Ajustes: sin "Asistencia" (no hay canal de soporte).

## Decisiones del Lote 4 (a confirmar)
- **Mazo agotado:** cada push saca 2 cartas del mazo y nada vuelve a él, así que SÍ se puede agotar (con bots pasa en
  ~4 de cada 10 rondas). Antes el servidor lanzaba un error. Regla provisional: push solo con ≥2 cartas en el mazo y,
  si tras un descarte quedan <2, la ronda termina sin ganador (todos suman su mano).
- **Tiempo agotado:** antes de tomar carta → toma el descarte y lo devuelve (nada cambia); después → descarta la carta
  que tomó. Tiempos: sin límite, 30, 45, 60, 90, 120 s.
- **Práctica:** corre en el navegador (sirve sin internet), 1 a 3 bots, no da XP ni fichas. Los bots solo ven su mano.
