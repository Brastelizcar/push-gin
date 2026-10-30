# Cómo publicar Push Gin en internet (gratis)

Al terminar, tus amigos abren un enlace desde su celular o computador, escriben su nombre y juegan contigo. Tú no tienes que dejar nada encendido.

```
Tu computador ──(subir cambios)──► GitHub  (guarda tu código)
                                     ├──► GitHub Pages  →  la PÁGINA del juego (el enlace que compartes)
                                     └──► Render        →  el SERVIDOR que reparte las cartas
```

**Tiempo:** unos 30–40 minutos la primera vez.
**Necesitas:** una cuenta de [GitHub](https://github.com) y una de [Render](https://render.com), ambas gratis (en Render puedes entrar con tu cuenta de GitHub).

---

## Paso 1 · Revisa que tengas los archivos nuevos en su sitio

Además de lo que ya tenías, deben estar estos (⭐ = nuevo):

```
push-gin/
├── .gitignore                        ⭐  (empieza con punto)
├── render.yaml                       ⭐
├── DEPLOY.md                         ⭐  (este archivo)
├── .github/
│   └── workflows/
│       └── deploy-client.yml         ⭐  (carpetas que empiezan con punto)
├── package.json                      (el de la raíz: NO lo borres, el servidor lo necesita)
├── src/logic/ ...
├── server/ ...
└── client/
    ├── .env.production               ⭐  (empieza con punto)
    ├── vite.config.js                (reemplazado)
    └── src/
        ├── net.js                    (reemplazado)
        ├── main.js                   (reemplazado)
        └── style.css                 (reemplazado)
```

> **Los archivos que empiezan con punto** (`.gitignore`, `.env.production`, la carpeta `.github`) a veces se descargan sin el punto o quedan ocultos. En VS Code créalos tú: clic derecho en la carpeta → **Nuevo archivo** → escribe el nombre **con el punto** → pega el contenido de abajo.

**`.gitignore`** (en `push-gin/`):
```
node_modules/
dist/
build/
.env
.env.local
.env.*.local
.DS_Store
Thumbs.db
*.log
.colyseus-cloud.json
.devmode.json
```

**`client/.env.production`** (dentro de `client/`, no en `src/`):
```
VITE_SERVER_URL=wss://CAMBIA-ESTO.onrender.com
```
(Lo cambiarás en el Paso 4.)

Para el archivo `.github/workflows/deploy-client.yml`, crea el archivo con la ruta completa: al nombrarlo escribe `.github/workflows/deploy-client.yml` y VS Code crea las carpetas solo.

**Comprobación rápida** (opcional, pero recomendable). En la terminal de VS Code:

```
npm test                      (en push-gin/)      → deben pasar 31
cd client && npm test         (en push-gin/client) → deben pasar 7
```

---

## Paso 2 · Sube el código a GitHub (con VS Code)

1. Instala [Git](https://git-scm.com) si no lo tienes. Para saberlo, en la terminal escribe `git --version`.
2. En VS Code abre el panel **Control de código fuente** (icono de ramas a la izquierda, o `Ctrl+Shift+G`).
3. Pulsa **Inicializar repositorio** (si ya hiciste `git init` antes, sáltate esto).
4. Escribe un mensaje, por ejemplo `Primera versión`, y pulsa **Confirmar** (Commit). Si te pregunta si guardar todos los cambios, di que sí.
5. Pulsa **Publicar rama** (Publish Branch). VS Code te pide iniciar sesión en GitHub en el navegador; acepta.
6. Elige **Publish to GitHub public repository** con el nombre `push-gin`.

> **El repositorio debe ser público.** Es un requisito de GitHub Pages en cuentas gratuitas. En el código no hay contraseñas ni datos privados, así que no hay problema.

Cuando termine, entra a `https://github.com/TU-USUARIO/push-gin` y verifica que ves tus carpetas (`client`, `server`, `src`…). **No** debe aparecer ninguna carpeta `node_modules`.

---

## Paso 3 · Crea el servidor en Render

1. Entra a [render.com](https://render.com) e inicia sesión con **GitHub**.
2. Arriba a la derecha pulsa **New +** → **Blueprint**.
3. Conecta tu cuenta de GitHub si te lo pide y elige el repositorio **push-gin**.
4. Render lee el archivo `render.yaml` y te muestra un servicio llamado `push-gin-server` con plan **Free**. Pulsa **Apply** (o *Deploy Blueprint*).
5. Espera unos minutos hasta que el estado diga **Live** (verde). Puedes ver el avance en **Logs**.
6. Copia la dirección del servicio: aparece arriba, bajo el nombre, con esta forma:
   `https://push-gin-server-xxxx.onrender.com`
7. **Pruébala:** abre esa dirección con `/hi` al final, es decir `https://push-gin-server-xxxx.onrender.com/hi`. Debe aparecer un texto en inglés ("It's time to kick ass…"). Si lo ves, el servidor funciona.

> La primera vez que abras esa dirección puede tardar hasta un minuto: es el servidor gratuito despertando. Es normal.

---

## Paso 4 · Dile a la página dónde está el servidor

Abre `client/.env.production` y reemplaza la línea por tu dirección, **cambiando `https://` por `wss://`**:

```
VITE_SERVER_URL=wss://push-gin-server-xxxx.onrender.com
```

(Usa la tuya, con las letras que te dio Render. Sin espacios y sin `/` al final.)

Guarda y sube el cambio: en **Control de código fuente** escribe un mensaje (`Dirección del servidor`), **Confirmar** y luego **Sincronizar cambios** (o *Push*).

---

## Paso 5 · Activa GitHub Pages

1. En tu repositorio en GitHub: **Settings** → **Pages** (menú izquierdo).
2. En **Build and deployment → Source** elige **GitHub Actions**.
3. Ve a la pestaña **Actions**. Verás "Publicar página (GitHub Pages)" ejecutándose por la subida del Paso 4. Si no aparece, entra a ese flujo y pulsa **Run workflow**.
4. Cuando salga en verde ✓ (1–2 minutos), tu página queda en:

   **`https://TU-USUARIO.github.io/push-gin/`**

Ese es el enlace que compartes.

---

## Paso 6 · Pruébalo

1. Abre el enlace en tu computador, escribe tu nombre y pulsa **Crear sala**. Verás un código de 4 dígitos.
2. Abre el mismo enlace en tu celular (con datos móviles, para comprobar que funciona fuera de tu casa), entra con el código.
3. Inicia la partida. 🎉

Si el servidor estaba dormido, la pantalla dice "Despertando el servidor…" y se conecta sola. No cierres la página.

---

## Cuando cambies algo del juego

Haz el cambio, **Confirmar** y **Sincronizar cambios**. GitHub Pages republica la página y Render reinicia el servidor solo. Tarda un par de minutos. **No se puede actualizar mientras hay una partida en curso:** el servidor se reinicia y la partida se pierde.

---

## Lo que debes saber del plan gratuito

| Qué pasa | Por qué | Qué hace el juego |
|---|---|---|
| El servidor se **duerme tras ~15 minutos sin actividad** y tarda hasta 1 minuto en despertar. | Es el límite del plan gratuito de Render. | Al abrir la página la "toca" para despertarla, y mientras estás en una sala la mantiene despierta (una petición cada 4 minutos). |
| Render **puede reiniciar** el servidor en cualquier momento. | También es parte del plan gratuito. | Se perdería la partida en curso. Todavía no hay reconexión: es el siguiente paso recomendado. |
| Las salas viven **en memoria**. | Así se diseñó: no hay base de datos. | Al reiniciar el servidor, todas las salas desaparecen. |
| El plan gratuito tiene **límites mensuales**. | Render los define y pueden cambiar. | Para jugar con amigos suele ser suficiente. Revisa tu panel de Render si juegas mucho. |

---

## Si algo falla

| Síntoma | Qué revisar |
|---|---|
| La página sale **en blanco** o con errores `404` | En GitHub → Settings → Pages, el origen debe ser **GitHub Actions**. Y el nombre del repositorio debe ser el mismo con el que se publicó (la ruta se toma sola del nombre). |
| Dice **"Falta poner la dirección del servidor"** | No cambiaste `CAMBIA-ESTO` en `client/.env.production`, o no subiste ese cambio. Revisa el Paso 4. |
| Dice **"No se pudo conectar al servidor"** | Abre `https://tu-servidor.onrender.com/hi` en el navegador. Si no responde, mira los **Logs** en Render. Si responde, revisa que en `.env.production` empiece con **`wss://`** (no `ws://` ni `https://`) y que no tenga errores de tipeo. |
| **Actions** falla con "Pages not enabled" / "Get Pages site failed" | Haz primero el Paso 5, punto 2, y vuelve a ejecutar el flujo (**Re-run jobs**). |
| Render falla al construir | Abre **Logs** del servicio. Si menciona una versión de Node, confirma que `render.yaml` tiene `NODE_VERSION: "22"`. |
| "Código no válido o sala ya iniciada" | El código se escribió mal, o la partida ya empezó (la sala se cierra al empezar). |
