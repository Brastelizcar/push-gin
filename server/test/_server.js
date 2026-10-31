// Un solo servidor de pruebas para todos los archivos: la configuración es una instancia de Server
// (defineServer) y no se puede volver a levantar después de apagarla. Mocha corre con --exit.
import { boot } from "@colyseus/testing";
import appConfig from "../src/app.config.js";

let booting = null;
export const getServer = () => (booting ??= boot(appConfig));
