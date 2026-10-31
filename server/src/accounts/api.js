// Rutas HTTP de cuentas. El código de sincronización viaja en la cabecera Authorization (nunca en la URL).
//   POST /api/account          { name }  → crea una cuenta nueva          → { account }
//   GET  /api/account                     → tu cuenta (para sincronizar)  → { account }
//   POST /api/account/name     { name }  → cambia tu nombre              → { account }
//   POST /api/chips/claim                 → reclama las fichas gratis    → { ok, account }
import express from "express";
import { initStore, publicAccount, isSyncCode, cleanName } from "./store.js";

// Límite simple de cuentas nuevas por IP (evita que alguien llene la base de datos).
const CREATE_LIMIT = 20, CREATE_WINDOW_MS = 60 * 60 * 1000;
const created = new Map(); // ip -> [instantes]
function allowCreate(ip, now = Date.now()) {
  const list = (created.get(ip) ?? []).filter((t) => now - t < CREATE_WINDOW_MS);
  if (list.length >= CREATE_LIMIT) { created.set(ip, list); return false; }
  list.push(now); created.set(ip, list);
  return true;
}

async function auth(req, res) {
  const code = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1];
  if (!isSyncCode(code)) { res.status(401).json({ error: "Código no válido" }); return null; }
  const acc = await (await initStore()).byCode(code);
  if (!acc) { res.status(401).json({ error: "No existe una cuenta con ese código" }); return null; }
  return acc;
}

// Envuelve los manejadores async: cualquier error responde 500 en vez de tumbar el servidor.
const safe = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error("api:", e);
  if (!res.headersSent) res.status(500).json({ error: "Error del servidor, intenta de nuevo" });
});

export function mountAccountRoutes(app) {
  // El cliente vive en otro dominio (GitHub Pages): se permite CORS solo para /api.
  app.use("/api", (req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use("/api", express.json({ limit: "4kb" }));

  app.post("/api/account", safe(async (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: "Escribe tu nombre" });
    if (!allowCreate(req.ip)) return res.status(429).json({ error: "Demasiadas cuentas nuevas, intenta más tarde" });
    const acc = await (await initStore()).create(name);
    res.json({ account: publicAccount(acc) });
  }));

  app.get("/api/account", safe(async (req, res) => {
    const acc = await auth(req, res); if (!acc) return;
    res.json({ account: publicAccount(acc) });
  }));

  app.post("/api/account/name", safe(async (req, res) => {
    const acc = await auth(req, res); if (!acc) return;
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: "Escribe tu nombre" });
    res.json({ account: publicAccount(await (await initStore()).rename(acc.id, name)) });
  }));

  app.post("/api/chips/claim", safe(async (req, res) => {
    const acc = await auth(req, res); if (!acc) return;
    const r = await (await initStore()).claim(acc.id);
    res.json({ ok: r.ok, account: publicAccount(r.account, r.now) });
  }));
}
