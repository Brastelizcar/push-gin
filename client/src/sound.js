// Sonidos cortos sintetizados con Web Audio (sin archivos). Respetan el ajuste "Sonidos".
// El tono varía ±10 % en cada golpe para que no suene repetitivo (spec 4.3) y hay como mucho 6 voces a la vez (4.4).
import { settings } from "./settings.js";

let ctx = null;
let voices = 0;
const MAX_VOICES = 6;

function audio() {
  if (!ctx) { try { ctx = new AudioContext(); } catch { return null; } }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// kind: 'card' (golpe de carta), 'ok' (jugada aceptada), 'bad' (rechazo), 'turn' (te toca)
export function play(kind) {
  if (!settings().sounds || voices >= MAX_VOICES) return;
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const pitch = 0.9 + Math.random() * 0.2;
  const tone = (freq, start, dur, type = "triangle", vol = 0.12) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq * pitch, t + start);
    g.gain.setValueAtTime(vol, t + start);
    g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
    o.connect(g).connect(a.destination);
    voices++;
    o.onended = () => voices--;
    o.start(t + start);
    o.stop(t + start + dur);
  };
  if (kind === "card") tone(220, 0, 0.07, "square", 0.05);
  else if (kind === "ok") { tone(523, 0, 0.12); tone(784, 0.08, 0.16); }
  else if (kind === "bad") { tone(196, 0, 0.12, "sawtooth", 0.06); tone(147, 0.09, 0.16, "sawtooth", 0.06); }
  else if (kind === "turn") tone(660, 0, 0.18, "sine", 0.1);
}
