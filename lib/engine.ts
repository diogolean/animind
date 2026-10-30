"use client";
/* Browser-side preview renderer (Canvas 2D + Web Audio + MediaRecorder).
 * Mirrors what the Rigly engine does server-side: layered rig + mouth driven
 * by the audio envelope. Pure client code, no keys involved. */
import { PARODY_DISCLAIMER, type Character, type RenderResult, type Scenario, type Viseme } from "./contract";

export const FPS_ENV = 100; // envelope samples per second
export const W = 1280;
export const H = 720;

export interface Track {
  buffer: AudioBuffer;
  /** amplitude 0..1 per 10ms */
  env: Float32Array;
  /** viseme per 10ms */
  vis: Viseme[];
  /** speaker index per 10ms (-1 = silence) */
  who: Int8Array;
}

const VOWELS: Record<string, { f1: number; f2: number; v: Viseme }> = {
  a: { f1: 800, f2: 1250, v: "mouth_A" },
  e: { f1: 450, f2: 2000, v: "mouth_E" },
  i: { f1: 300, f2: 2300, v: "mouth_E" },
  o: { f1: 500, f2: 900, v: "mouth_O" },
  u: { f1: 330, f2: 800, v: "mouth_O" },
};
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Placeholder "voice": a formant-shaped babble that follows the script syllables. */
export function synthTrack(ctx: BaseAudioContext, r: RenderResult): Track {
  const sr = 22050;
  const total = Math.ceil((r.durationMs / 1000) * sr);
  const pcm = new Float32Array(total);
  const n = Math.ceil((r.durationMs / 1000) * FPS_ENV);
  const env = new Float32Array(n);
  const vis: Viseme[] = Array(n).fill("mouth_rest");
  const who = new Int8Array(n).fill(-1);
  for (const line of r.script) {
    const vowels = [...norm(line.text)].filter((c) => c in VOWELS || c === " " || c === "," || c === ".");
    const span = line.endMs - line.startMs;
    const step = span / Math.max(1, vowels.length);
    const f0base = line.speaker === 0 ? 165 : 118;
    vowels.forEach((c, i) => {
      const t0 = line.startMs + i * step;
      const k0 = Math.floor((t0 / 1000) * FPS_ENV);
      const k1 = Math.floor(((t0 + step) / 1000) * FPS_ENV);
      for (let k = k0; k < k1 && k < n; k++) who[k] = line.speaker;
      if (!(c in VOWELS)) {
        for (let k = k0; k < k1 && k < n; k++) vis[k] = c === " " ? "mouth_M" : "mouth_rest";
        return;
      }
      const { f1, f2, v } = VOWELS[c];
      const s0 = Math.floor((t0 / 1000) * sr);
      const len = Math.floor((step / 1000) * sr * 0.92);
      const f0 = f0base * (1 + 0.08 * Math.sin(i * 1.7)) * (i === vowels.length - 1 ? 0.85 : 1);
      let phase = 0;
      for (let j = 0; j < len && s0 + j < total; j++) {
        const a = Math.min(1, j / (sr * 0.02)) * Math.min(1, (len - j) / (sr * 0.04));
        phase += (2 * Math.PI * f0) / sr;
        let s = 0;
        for (let h = 1; h <= 18; h++) {
          const f = h * f0;
          const g = Math.exp(-(((f - f1) / 160) ** 2)) + 0.6 * Math.exp(-(((f - f2) / 220) ** 2)) + 0.15 / h;
          s += g * Math.sin(h * phase);
        }
        pcm[s0 + j] += 0.12 * a * s;
      }
      for (let k = k0; k < k1 && k < n; k++) {
        const local = (k - k0) / Math.max(1, k1 - k0);
        env[k] = Math.sin(Math.PI * Math.min(1, local * 1.1)) * (0.75 + 0.25 * Math.sin(i));
        vis[k] = env[k] < 0.15 ? "mouth_M" : v;
      }
    });
  }
  const buffer = ctx.createBuffer(1, total, sr);
  buffer.copyToChannel(pcm, 0);
  return { buffer, env, vis, who };
}

/** Envelope from a real TTS track (core-provided audioUrl). */
export async function trackFromUrl(ctx: BaseAudioContext, url: string, r: RenderResult): Promise<Track> {
  const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const ch = buf.getChannelData(0);
  const hop = Math.floor(buf.sampleRate / FPS_ENV);
  const n = Math.ceil(ch.length / hop);
  const env = new Float32Array(n);
  let max = 1e-6;
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let j = k * hop; j < Math.min(ch.length, (k + 1) * hop); j++) s += ch[j] * ch[j];
    env[k] = Math.sqrt(s / hop);
    max = Math.max(max, env[k]);
  }
  const vis: Viseme[] = [];
  const who = new Int8Array(n).fill(-1);
  for (let k = 0; k < n; k++) {
    env[k] /= max;
    vis.push(env[k] < 0.12 ? "mouth_M" : env[k] > 0.6 ? "mouth_A" : k % 3 ? "mouth_E" : "mouth_O");
  }
  for (const l of r.script) {
    for (let k = Math.floor(l.startMs / 10); k < Math.min(n, l.endMs / 10); k++) who[k] = l.speaker;
    l.visemes?.forEach((v) => { const k = Math.floor(v.t * FPS_ENV); if (k < n) vis[k] = v.v; });
  }
  return { buffer: buf, env, vis, who };
}

export type Images = Map<string, HTMLImageElement>;

export async function loadImages(chars: Character[]): Promise<Images> {
  const urls = new Set<string>();
  chars.forEach((c) => { c.layers.forEach((l) => urls.add(l.url)); if (c.photo) urls.add(c.photo.url); });
  const m: Images = new Map();
  await Promise.all(
    [...urls].map(
      (u) =>
        new Promise<void>((res) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => { m.set(u, img); res(); };
          img.onerror = () => res();
          img.src = u;
        }),
    ),
  );
  return m;
}

function background(g: CanvasRenderingContext2D, s: Scenario, t: number) {
  const grad = g.createLinearGradient(0, 0, 0, H);
  const pal: Record<Scenario, [string, string]> = {
    studio: ["#1b1530", "#0b0a12"],
    classroom: ["#1f3a33", "#0f1f1b"],
    arena: ["#3a1020", "#120509"],
    space: ["#070b1f", "#000"],
  };
  grad.addColorStop(0, pal[s][0]);
  grad.addColorStop(1, pal[s][1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  if (s === "studio") {
    for (let i = 0; i < 3; i++) {
      const x = W * (0.2 + i * 0.3);
      const r = g.createRadialGradient(x, 0, 10, x, 0, 520);
      r.addColorStop(0, "rgba(167,139,250,.35)");
      r.addColorStop(1, "rgba(167,139,250,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, W, H);
    }
    g.fillStyle = "#14101f";
    g.fillRect(0, H * 0.82, W, H);
  } else if (s === "classroom") {
    g.fillStyle = "#3b2a1a";
    g.fillRect(0, H * 0.84, W, H);
  } else if (s === "arena") {
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,${80 + (i * 37) % 120},120,${0.08 + 0.06 * Math.sin(t * 2 + i)})`;
      g.beginPath();
      g.arc((i * 97) % W, H * 0.35 + ((i * 53) % 120), 6 + (i % 4), 0, 7);
      g.fill();
    }
    g.fillStyle = "#1e0910";
    g.fillRect(0, H * 0.8, W, H);
  } else {
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(255,255,255,${0.3 + 0.7 * Math.abs(Math.sin(i * 12.9 + t * (i % 3)))})`;
      g.fillRect((i * 137.5) % W, (i * 71.3) % (H * 0.85), 2, 2);
    }
    const p = g.createRadialGradient(W * 0.85, H * 0.2, 5, W * 0.85, H * 0.2, 90);
    p.addColorStop(0, "#f472b6");
    p.addColorStop(1, "#4c1d95");
    g.fillStyle = p;
    g.beginPath();
    g.arc(W * 0.85, H * 0.2, 70, 0, 7);
    g.fill();
  }
}

function drawCharacter(g: CanvasRenderingContext2D, c: Character, img: Images, cx: number, scale: number, amp: number, vis: Viseme, t: number, flip: boolean, seed: number) {
  g.save();
  g.translate(cx, H * 0.98);
  g.scale(flip ? -scale : scale, scale);
  g.translate(-c.canvas.w / 2, -c.canvas.h);
  const breathe = Math.sin(t * 2 + seed) * 3;
  if (c.photo) {
    const im = img.get(c.photo.url);
    if (im) {
      const ar = im.width / im.height;
      const w = c.canvas.w, h = w / ar;
      const y0 = c.canvas.h - h + breathe;
      const j = c.photo.jaw;
      const drop = amp * j.h * h * 0.55;
      g.shadowColor = "rgba(0,0,0,.5)";
      g.shadowBlur = 24;
      g.fillStyle = "#fff";
      g.fillRect(-8, y0 - 8, w + 16, h + 16);
      g.shadowBlur = 0;
      g.drawImage(im, 0, y0, w, h);
      // mouth hole + dropping jaw (cut-out style)
      g.fillStyle = "#1a0b0b";
      g.fillRect(j.x * w, (j.y) * h + y0, j.w * w, drop + 2);
      g.drawImage(im, j.x * im.width, j.y * im.height, j.w * im.width, j.h * im.height, j.x * w, j.y * h + y0 + drop, j.w * w, j.h * h);
      g.strokeStyle = "rgba(255,255,255,.9)";
      g.lineWidth = 3;
      g.strokeRect(j.x * w, j.y * h + y0 + drop, j.w * w, j.h * h);
    }
    g.restore();
    return;
  }
  const blink = (t + seed) % 3.4 < 0.12;
  const headY = breathe - amp * 6;
  const tilt = Math.sin(t * 3 + seed) * 0.02 * (amp > 0.1 ? 1 : 0.3);
  const layers = [...c.layers].sort((a, b) => a.z - b.z);
  for (const l of layers) {
    if (l.name.startsWith("mouth_") && l.name !== vis) continue;
    if (l.name === "eyes" && blink) continue;
    if (l.name === "eyes_closed" && !blink) continue;
    const im = img.get(l.url);
    if (!im) continue;
    g.save();
    if (l.name !== "body") {
      g.translate(c.canvas.w / 2, 420);
      g.rotate(tilt);
      g.translate(-c.canvas.w / 2, -420 + headY + (l.name === "brows" ? -amp * 9 : 0));
    } else g.translate(0, breathe * 0.4);
    g.drawImage(im, l.x, l.y, l.w, l.h);
    g.restore();
  }
  g.restore();
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const nx = cur ? `${cur} ${w}` : w;
    if (g.measureText(nx).width > maxW && cur) { lines.push(cur); cur = w; } else cur = nx;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function drawFrame(g: CanvasRenderingContext2D, r: RenderResult, img: Images, track: Track | null, tMs: number) {
  const t = tMs / 1000;
  const k = Math.min(Math.floor(t * FPS_ENV), (track?.env.length ?? 1) - 1);
  const speaker = track ? track.who[Math.max(0, k)] : -1;
  const amp = track ? track.env[Math.max(0, k)] : 0;
  const vis = track ? track.vis[Math.max(0, k)] : "mouth_rest";
  background(g, r.scenario, t);
  const chars = r.characters;
  if (r.template === "debate") {
    g.fillStyle = "rgba(255,255,255,.06)";
    g.fillRect(W * 0.08, H * 0.74, W * 0.3, H * 0.3);
    g.fillRect(W * 0.62, H * 0.74, W * 0.3, H * 0.3);
    const b = chars[1] ?? chars[0];
    drawCharacter(g, chars[0], img, W * 0.24, 0.92, speaker === 0 ? amp : 0, speaker === 0 ? vis : "mouth_rest", t, false, 0);
    drawCharacter(g, b, img, W * 0.76, 0.92, speaker === 1 ? amp : 0, speaker === 1 ? vis : "mouth_rest", t, true, 1.3);
    g.font = "800 64px ui-sans-serif, system-ui";
    g.fillStyle = "rgba(255,255,255,.9)";
    g.textAlign = "center";
    g.fillText("VS", W / 2, H * 0.45);
  } else if (r.template === "lesson") {
    g.fillStyle = "#123b2f";
    g.strokeStyle = "#8b5a2b";
    g.lineWidth = 14;
    g.fillRect(W * 0.45, H * 0.12, W * 0.48, H * 0.5);
    g.strokeRect(W * 0.45, H * 0.12, W * 0.48, H * 0.5);
    const cur = r.script.find((l) => tMs >= l.startMs && tMs <= l.endMs + 350) ?? r.script[0];
    g.fillStyle = "#e7f5ee";
    g.font = "600 30px ui-rounded, 'Comic Sans MS', system-ui";
    g.textAlign = "left";
    wrap(g, cur?.text ?? "", W * 0.42).forEach((ln, i) => g.fillText(ln, W * 0.48, H * 0.22 + i * 42));
    drawCharacter(g, chars[0], img, W * 0.24, 0.95, speaker === 0 ? amp : 0, speaker === 0 ? vis : "mouth_rest", t, false, 0);
  } else {
    drawCharacter(g, chars[0], img, W * 0.5, 1, speaker === 0 ? amp : 0, speaker === 0 ? vis : "mouth_rest", t, false, 0);
  }
  // caption
  const line = r.script.find((l) => tMs >= l.startMs && tMs <= l.endMs);
  if (line && r.template !== "lesson") {
    g.font = "600 30px ui-sans-serif, system-ui";
    g.textAlign = "center";
    const ls = wrap(g, line.text, W * 0.7);
    const bh = ls.length * 40 + 24;
    g.fillStyle = "rgba(10,10,15,.72)";
    g.beginPath();
    g.roundRect(W * 0.13, H - bh - 28, W * 0.74, bh, 18);
    g.fill();
    g.fillStyle = "#fff";
    ls.forEach((s, i) => g.fillText(s, W / 2, H - bh - 28 + 44 + i * 40));
  }
  // parody disclaimer (always visible, baked into the video)
  g.font = "700 22px ui-sans-serif, system-ui";
  g.textAlign = "left";
  const label = `⚠ ${r.disclaimer || PARODY_DISCLAIMER}`;
  const lw = g.measureText(label).width + 32;
  g.fillStyle = "rgba(250,204,21,.95)";
  g.beginPath();
  g.roundRect(24, 22, lw, 40, 20);
  g.fill();
  g.fillStyle = "#1a1405";
  g.fillText(label, 40, 50);
  g.font = "600 20px ui-sans-serif, system-ui";
  g.textAlign = "right";
  g.fillStyle = "rgba(255,255,255,.55)";
  g.fillText("animind", W - 28, 48);
}

export function pickMime() {
  const c = ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return c.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}
