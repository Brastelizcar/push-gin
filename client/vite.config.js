import { defineConfig } from "vite";

// El cliente reutiliza la lógica pura del juego (../src/logic) para validar al instante lo que
// el jugador selecciona. El servidor sigue siendo la autoridad: valida todo otra vez.
export default defineConfig({
  // En GitHub Pages la página vive en https://usuario.github.io/NOMBRE-DEL-REPO/ ; el flujo de
  // publicación pone VITE_BASE=/NOMBRE-DEL-REPO/. En tu computador (npm run dev) queda "/".
  base: process.env.VITE_BASE ?? "/",
  server: { fs: { allow: [".."] } },
});
