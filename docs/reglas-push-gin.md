# Push Gin — Instructivo del juego

## Objetivo

Ser el primer jugador en quedarse sin cartas en la mano, cumpliendo en cada ronda la combinación específica que esa ronda exige antes de poder "plantarse".

---

## Componentes y preparación

- **Baraja:** 3 barajas de póker estándar, mezcladas juntas.
- **Jugadores:** probado y funcional con 4 jugadores.
- **Reparto:** 10 cartas por jugador.
- Se voltea **una carta boca arriba** sobre la mesa para iniciar el pozo de descarte. El resto de las cartas forma el **mazo** (boca abajo).

---

## Estructura de la partida: 5 rondas

Cada ronda exige una combinación distinta para poder plantarte. No puedes bajar tu jugada hasta tener **exactamente** lo que la ronda pide.

| Ronda | Requisito para plantarse |
|---|---|
| **1** | 3 tríos |
| **2** | 1 trío + 1 consecutivo de 5 cartas |
| **3** | 2 consecutivos de 6 cartas |
| **4** | 4 tríos |
| **5** | 1 cuarteto + 1 consecutivo de 8 cartas |

**Definiciones:**
- **Trío:** 3 cartas del mismo número, distinto palo.
- **Cuarteto:** 4 cartas del mismo número, una de cada palo.
- **Consecutivo:** cartas en secuencia numérica del mismo palo (la cantidad de cartas la define la ronda, ej. "consecutivo de 5" = 5 cartas seguidas del mismo palo).

---

## El comodín: el 2

- El **2** es comodín y puede sustituir a cualquier carta, en cualquier trío, cuarteto o consecutivo.
- Ver más abajo la sección **"Robo del 2"** — existe una mecánica especial para recuperar 2s que ya están en juego en la mesa.

---

## Valor de las cartas (para puntaje)

Estas son las cartas que **quedan en tu mano** al terminar la ronda (es decir, si no ganaste esa ronda, estas cartas suman en tu contra):

| Carta | Puntos |
|---|---|
| A | 15 |
| 2 (comodín) | 20 |
| 10, J, Q, K | 10 |
| 3 a 9 | 5 |

---

## Turno de juego

En tu turno ocurre **una** de estas dos situaciones:

### Opción 1 — La carta de descarte te sirve
- Tomas la carta que está boca arriba en el pozo de descarte.
- Descartas una carta de tu mano al final del turno.

### Opción 2 — La carta de descarte no te sirve ("push")
1. Tomas una carta del mazo **sin mirarla** (boca abajo).
2. La colocas encima de la carta de descarte (tapándola).
3. Le pasas esas **2 cartas juntas** (la nueva boca abajo + la vieja de descarte debajo) al siguiente jugador.
4. Tomas una carta normal del mazo para ti.
5. Descartas una carta de tu mano.

> Esta es la mecánica que le da nombre al juego: en vez de simplemente pasar el turno, "empujas" una carta desconocida hacia el siguiente jugador, cambiando lo que él tiene disponible para robar.

---

## Plantarse

- Solo puedes plantarte cuando tienes en mano **exactamente** la combinación que pide la ronda actual (ver tabla de rondas).
- No puedes plantarte con una combinación distinta ni "a medias" — debe cumplir el requisito completo de la ronda.

### Después de plantarte

Una vez plantado, en tus turnos siguientes puedes:

1. **Formar nuevos tríos, cuartetos o consecutivos** con las cartas que te van quedando, para deshacerte de ellas.
2. **Agregar cartas a un plante que ya existe en la mesa** (tuyo o de otro jugador), siempre que:
   - Solo **extiendas** el plante (alargar el consecutivo por cualquier extremo, o agrandar el trío hasta cuarteto).
   - **Nunca dividas** un plante existente en dos partes separadas.

---

## Cómo se gana la ronda

- Gana la ronda el primer jugador en quedarse sin cartas.
- **Importante:** no puedes ganar formando tu última jugada (trío/consecutivo) con tus últimas cartas, porque **siempre debes descartar una carta al final de tu turno**. Es decir, la forma de ganar es descartando tu última carta — no bajando un plante que te deje en cero directamente.

---

## Robo del 2 (regla especial)

Mecánica exclusiva de tu variante, aplicable en tu turno:

1. **Condición para poder robar:** solo puedes robar 2s si **tú todavía no te has plantado** en la partida.
2. **De dónde se puede robar:** únicamente de plantes que pertenecen a jugadores que **ya se plantaron**. No se puede tocar el plante de alguien que aún no se ha bajado.
3. **Cómo se roba:** reemplazas el 2 por una carta de tu mano que encaje exactamente en esa posición (continuando el consecutivo, o completando el trío/cuarteto del mismo número). El 2 pasa a tu mano.
4. **Cantidad:** puedes robar **todos los 2 que quieras** en el mismo turno, de cualquier plante de la mesa, sin límite de "uno por plante" — mientras tengas cartas que encajen en cada reemplazo.
5. **Consecuencia:** si robas **al menos un 2** en tu turno, **no puedes plantarte** ese mismo turno, aunque ya tengas en mano la combinación completa que pide la ronda.

---

## Resumen del flujo de un turno

1. **Robo de 2s (opcional):** si aún no te has plantado, puedes robar cuantos 2s quieras de plantes de jugadores ya plantados, reemplazándolos por cartas que encajen. Si robas alguno, saltas al paso 4 (no puedes plantarte este turno).
2. **Tomar carta:**
   - Si la carta de descarte te sirve → la tomas.
   - Si no te sirve → aplicas el "push": cubres la carta de descarte con una del mazo sin ver, pasas ambas al siguiente jugador, y tomas tu propia carta del mazo.
3. **Jugar (si corresponde):**
   - Si es tu primera vez y tienes la combinación exacta de la ronda → te plantas.
   - Si ya estás plantado → puedes bajar nuevas combinaciones o enganchar cartas en plantes existentes (sin dividirlos).
4. **Descartar** una carta de tu mano — obligatorio en todos los casos.

---

## Fin de ronda y puntaje

- La ronda termina cuando un jugador se queda sin cartas.
- Los demás jugadores suman a su puntaje total el valor de las cartas que les quedaron en la mano (según la tabla de valores).
- Se juegan las **5 rondas** con sus respectivos requisitos, acumulando puntaje ronda tras ronda.

---

## Fin de la partida

- Se juegan las 5 rondas completas.
- Al terminar la quinta ronda, se suman los puntos acumulados de cada jugador a lo largo de todas las rondas.
- **Gana la partida el jugador con menor puntaje total.**
- El jugador que gana una ronda (se queda sin cartas) suma **0 puntos** en esa ronda, ya que no le queda ninguna carta en mano para contar.
- El mazo, en la práctica, nunca se agota durante una ronda: al haber solo 1 carta en el pozo de descarte en todo momento y usarse 3 barajas completas, siempre hay cartas suficientes para completar la ronda.
