# Especificaciones de UI/UX para Mecánica de Cartas (Web)

Especificación técnica de cómo deben comportarse, animarse y sonar las cartas en el juego, usando HTML/CSS/JS. Este documento asume el sistema visual y los componentes ya definidos en `CLAUDE.md` y el mockup `push-gin-vista-general-v6.html`.

---

## 0. Principio general: qué es cosmético y qué es autoritativo

- **Cosmético / local:** cómo se ve y se siente la mano del jugador (hover, reordenar tus propias cartas). No se sincroniza con el servidor, no afecta el estado del juego. Cada jugador puede reordenar su mano como quiera sin que nadie más lo note.
- **Autoritativo / de red:** cualquier acción que cambie el estado real del juego (descartar, tomar el descarte, hacer push, plantarse, enganchar, robar un 2). Estas siempre deben confirmarse contra el servidor (Colyseus) antes de darse por definitivas — ver sección 3.4.

Mantener esta distinción clara evita la mayoría de los bugs de sincronización típicos de este tipo de juegos.

---

## 1. Comportamiento visual y layout (grid lineal)

### 1.1 Estructura base
Usar `display: flex` con `flex-direction: row` para la mano del jugador, con `margin-left` negativo para el solape entre cartas (ya implementado así en el mockup). Sin rotación (0deg) — cartas siempre en línea recta, sin efecto de abanico.

### 1.2 Estado de foco (hover en PC / press en táctil)

Usar la **Pointer Events API** (`pointerenter`, `pointerdown`, `pointerup`, `pointermove`), que unifica mouse y touch en un solo set de listeners.

| Dispositivo | Evento que dispara el foco |
|---|---|
| PC (mouse) | `pointerenter` — se activa al pasar el cursor sobre la carta |
| Táctil (móvil) | No existe hover real — el efecto debe activarse al iniciar el press (`pointerdown`) y mantenerse mientras el dedo esté sobre la carta |

**Especificación del efecto:**
- Traslación en eje Y: `translateY(-14px)`.
- Escala: `scale(1.2)`.
- Transición: `transform 0.15s ease-out`.
- `z-index`: asignar un contador global incremental (`++zTop`) a la carta activa, **sin tocar su índice dentro del array de datos de la mano** — el orden lógico de la mano no cambia por esto, solo su capa visual.

```css
.hand-card {
  transition: transform 0.15s ease-out;
  touch-action: none; /* evita que el navegador interprete el drag como scroll */
}
.hand-card.focused {
  transform: translateY(-14px) scale(1.2);
}
```

### 1.3 Reordenamiento dentro de la mano (cosmético, local)

Técnica: **FLIP** (First, Last, Invert, Play).

1. **First:** antes de reordenar, medir la posición (`getBoundingClientRect()`) de cada carta.
2. **Last:** reordenar el array de datos y dejar que el DOM se actualice a las posiciones finales instantáneamente.
3. **Invert:** aplicar a cada carta un `transform` que la haga *parecer* que sigue en su posición vieja (diferencia entre posición vieja y nueva).
4. **Play:** en el siguiente frame, quitar ese `transform` con una transición — el navegador anima el desplazamiento a la posición real.

Duración: **0.15s**.

Esto se dispara mientras el jugador arrastra una carta sobre su propia mano para reordenar — es puramente visual y local, no dispara ningún mensaje al servidor.

---

## 2. Renderizado y nitidez

Las cartas se construyen con HTML/CSS y texto real (el número y el palo son texto tipográfico, no imágenes) — son vectoriales por naturaleza y se ven nítidas en cualquier resolución o nivel de zoom sin configuración adicional.

Si en algún momento se reemplazan los palos/números por ilustraciones (por ejemplo, un ícono dibujado en vez del carácter `♣`), esas ilustraciones deben entregarse en **SVG**, no PNG/JPG, para conservar la misma nitidez en cualquier resolución.

**Rendimiento:** animar siempre con `transform` y `opacity` — nunca `top`/`left`/`width`/`height` directamente, porque eso fuerza al navegador a recalcular el layout en cada frame. Marcar con `will-change: transform` las cartas que están a punto de animarse.

---

## 3. Drag hacia zonas de juego (acción real, no reordenar)

Cubre arrastrar una carta de la mano hacia el slot de descarte, y a futuro, hacia un plante de la mesa para enganchar.

### 3.1 Diferencia con el reordenamiento de la sección 1.3
Este drag **termina en un contenedor distinto** a la mano (el slot de descarte, o un meld en la mesa) y **es una acción de juego real** — debe pasar por el servidor antes de confirmarse.

### 3.2 Zonas de destino válidas
- El slot unificado de descarte (solo aceptar drop cuando esté en estado "esperando descarte", ver `CLAUDE.md`).
- Un meld existente en el panel "Plantes en mesa", si la carta encaja para enganchar.

Usar `pointerdown` + `pointermove` + `pointerup` con `element.setPointerCapture(pointerId)` al iniciar el drag — esto asegura que los eventos de movimiento se sigan recibiendo aunque el dedo/cursor se salga momentáneamente del elemento, algo común en táctil que puede romper el drag si no se captura el puntero.

### 3.3 Feedback de drop inválido

- Si se suelta la carta fuera de una zona válida, o sobre una zona válida pero la jugada es rechazada por el servidor (ver 3.4): la carta debe **regresar animada a su posición original** en la mano (mismo mecanismo FLIP, 0.15–0.2s), no simplemente desaparecer o quedar flotando.
- Reproducir un sonido de rechazo corto y distinto al "snap" de acierto (ver sección 4).
- Aplicar un pequeño "shake" (2-3px de oscilación horizontal, ~0.2s) en la zona de drop que rechazó la carta, para reforzar visualmente que ahí no se puede soltar.

### 3.4 UI optimista con reversión

1. Al soltar la carta en una zona válida, animarla *inmediatamente* a su destino, sin esperar al servidor — esto es lo que hace que el juego se sienta responsivo.
2. En paralelo, enviar la acción al servidor.
3. Si el servidor **confirma**, no hacer nada más (la animación ya reflejó el estado correcto).
4. Si el servidor **rechaza** (por ejemplo, otro jugador ya había tomado esa carta de descarte una fracción de segundo antes), revertir: animar la carta de vuelta a la mano (igual que 3.3) y mostrar un mensaje breve del motivo del rechazo.

---

## 4. Sincronización de audio (SFX)

### 4.1 Selección al iniciar drag
Reproducir sonido de fricción de papel ("slide") en `pointerdown` sobre una carta arrastrable.

### 4.2 Impacto al llegar al destino
No disparar el sonido de golpe ("snap"/"flick") al soltar el clic/dedo. Debe dispararse cuando la animación de llegada termine realmente:

- Si se anima con CSS `transition`: escuchar el evento `transitionend` en el elemento.
- Si se anima con la **Web Animations API** (`element.animate(...)`): usar la promesa `animation.finished`, más confiable que `transitionend` cuando hay animaciones interrumpidas o superpuestas.

```js
const animation = card.animate(
  [{ transform: startTransform }, { transform: endTransform }],
  { duration: 150, easing: 'ease-out', fill: 'forwards' }
);
animation.finished.then(() => playSnapSound());
```

### 4.3 Variación de tono (pitch)
Usar la **Web Audio API** con la propiedad `playbackRate` del `AudioBufferSourceNode`, randomizada en un rango de **±0.1** (ej. `0.9` a `1.1`) cada vez que se reproduce un sonido de papel/snap, para evitar que suene repetitivo en repartos múltiples.

### 4.4 Sonidos simultáneos

Con el reparto inicial (10 cartas × cada jugador) o un push, pueden dispararse varios sonidos de "snap" casi al mismo tiempo. Sin control, esto se escucha como ruido saturado.

- Mantener un **pool limitado de voces** para el sonido de snap (máximo 4-6 instancias simultáneas) — si se dispara un nuevo snap con el pool lleno, se ignora o se reemplaza la instancia más antigua.
- Para el reparto inicial: escalonar los sonidos con un pequeño delay entre cada carta (40-60ms), incluso si la animación visual de reparto es más rápida — esto se escucha como un "riffle" de cartas, mucho más natural que una ráfaga simultánea.

---

## 5. Animaciones de eventos de mesa

| Evento | Animación esperada |
|---|---|
| **Reparto inicial** | Cartas "vuelan" una por una desde el mazo (o desde un punto central) hacia la mano de cada jugador, escalonadas (ver 4.4 para el audio asociado) |
| **Robar del mazo** | La nueva carta se anima desde la posición del mazo hasta su lugar en la mano |
| **Push** | Animación en dos tiempos: (1) la carta boca abajo "cae" sobre el descarte cubriéndolo, (2) ambas cartas juntas se deslizan visualmente hacia el jugador siguiente antes de desaparecer de la vista actual |
| **Nuevo plante en la mesa** | Las cartas se animan desde la mano del jugador hacia su posición final en el panel "Plantes en mesa", agrupándose con la transición ya definida (`meld` con `margin-left` negativo) |
| **Enganche** | La carta viaja desde la mano hasta insertarse en el extremo correspondiente del meld existente; si el enganche es al inicio del consecutivo, animar el desplazamiento del resto de cartas con FLIP en vez de un salto brusco |
| **Robo de un 2** | La carta reemplazo entra desde la mano ocupando el lugar exacto del 2, y el 2 sale animado hacia la mano de quien robó (dirección opuesta, para que quede claro visualmente que es un intercambio) |

Duración para todas estas animaciones de mesa: **0.2–0.3s** (ligeramente más lento que las de la mano, ya que recorren más distancia en pantalla).

---

## 6. Responsive y adaptación por dispositivo

El juego debe verse bien en PC pantalla completa y en móvil horizontal — esto afecta directamente el tamaño de carta y los espaciados.

**Breakpoints:**

| Rango | Tamaño de carta en mano | Tamaño de carta en mesa |
|---|---|---|
| Móvil horizontal (≤ 900px de ancho, orientación landscape) | ~40×58px | ~32×46px |
| PC / tablet grande (> 900px) | ~46×66px | ~38×54px |

Usar `clamp()` en CSS para que el tamaño escale de forma fluida entre esos extremos en vez de saltos bruscos por breakpoint:

```css
.card {
  width: clamp(36px, 5vw, 46px);
  height: clamp(52px, 7vw, 66px);
}
```

**Aviso de rotación:** si el juego se abre en móvil en modo vertical, mostrar una pantalla simple pidiendo girar el dispositivo (detectable con `matchMedia('(orientation: portrait)')`), en vez de intentar comprimir el layout completo a un formato vertical.

---

## 7. Accesibilidad y buenas prácticas

- **`prefers-reduced-motion`:** respetar esta preferencia del sistema operativo del usuario — para quienes la tengan activada, reducir o eliminar las animaciones de traslación (dejar solo cambios instantáneos de posición/opacidad), ya que animaciones grandes y frecuentes pueden causar mareo o incomodidad.

  ```css
  @media (prefers-reduced-motion: reduce) {
    .hand-card, .card { transition: none !important; animation: none !important; }
  }
  ```
- **Tamaño mínimo de zona táctil:** aunque una carta visualmente mida 40px, en móvil la zona "tocable" alrededor de cada carta debe tener al menos 44×44px, para evitar que sea frustrante seleccionar la carta correcta cuando la mano tiene muchas cartas superpuestas.
- **Doble input accidental:** durante el drag, deshabilitar temporalmente el scroll de la página (`touch-action: none` ya cubre esto en el elemento arrastrado) y evitar que un segundo dedo/click dispare una segunda acción mientras la primera sigue en curso.
