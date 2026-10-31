// Rutas HTTP de cuentas. El token del dispositivo viaja en la cabecera Authorization (nunca en la URL).
//   POST /api/account          { name }  → crea una cuenta nueva          → { account, token }
//   GET  /api/account                     → tu cuenta                     → { account }
//   POST /api/account/name     { name }  → cambia tu nombre              → { account }
//   POST /api/chips/claim                 → reclama las fichas gratis    → { ok, account }
//   POST /api/sync/code                   → código corto (1 uso, 10 min) → { code, expiresInMs }
//   POST /api/sync/redeem      { code }  → usar la cuenta en este equipo → { account, token }
// XP y fichas solo cambian por decisión del servidor: ninguna ruta acepta esos valores del cliente.
import express from "express";
import { initStore, publicAccount, cleanName } from "./store.js";

// Límite de intentos por IP en una ventana de tiempo (memoria del proceso).
function limiter(max, windowMs) {
  const hits = new Map(); // ip -> [instantes]
  return (ip, now = Date.now()) => {
    const list = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    const ok = list.length < max;
    if (ok) list.push(now);
    hits.set(ip, list);
    return ok;
  };
}
const allowCreate = limiter(20, 60 * 60 * 1000);   // cuentas nuevas: evita llenar la base de datos
const allowRedeem = limiter(10, 10 * 60 * 1000);   // canjes: el código es corto, así se impide adivinarlo a la fuerza

async function auth(req, res) {
  const token = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1];
  const acc = token && (await (await initStore()).byToken(token));
  if (!acc) { res.status(401).json({ error: "Sesión no válida" }); return null; }
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
    const { account, token } = await (await initStore()).create(name);
    res.json({ account: publicAccount(account), token });
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

  app.post("/api/sync/code", safe(async (req, res) => {
    const acc = await auth(req, res); if (!acc) return;
    res.json(await (await initStore()).createSyncCode(acc.id));
  }));

  app.post("/api/sync/redeem", safe(async (req, res) => {
    if (!allowRedeem(req.ip)) return res.status(429).json({ error: "Demasiados intentos, espera unos minutos" });
    const r = await (await initStore()).redeemSyncCode(req.body?.code);
    if (!r) return res.status(400).json({ error: "Código incorrecto, vencido o ya usado" });
    res.json({ account: publicAccount(r.account), token: r.token });
  }));
}
