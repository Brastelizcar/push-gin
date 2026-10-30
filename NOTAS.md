# Notas de la lógica (decisiones tomadas donde las reglas no decían nada)

1. **Push**: la carta ciega + el descarte viejo pasan a la MANO del siguiente jugador (no al pozo).
   Es lo que cuadra con "solo hay 1 carta en el pozo en todo momento". Ver `Round.push`.
2. **As**: vale 1 (A-2-3) o 14 (Q-K-A). No se puede "dar la vuelta" (K-A-2-3 inválido).
3. **2 siempre es comodín** (no se usa como 2 natural). Se exige ≥1 carta natural por plante (`MIN_NATURALS`).
4. **Tras plantarse/bajar/enganchar debes conservar ≥1 carta** para el descarte obligatorio.
5. **Robo de 2s** solo en la fase previa a tomar carta; si robas, `stoleThisTurn` bloquea plantarse.
6. **Comodín ambiguo en consecutivos** (5♥ 6♥ 2 → ¿4-5-6 o 5-6-7?): sin `start` usa la posición más baja.
7. **Quién empieza la ronda**: jugador `roundIndex % nJugadores` (provisional).
