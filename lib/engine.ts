"use client";
/* Browser-side preview renderer (Canvas 2D + Web Audio + MediaRecorder).
 * Mirrors what the Rigly engine does server-side: layered rig + mouth driven
 * by the audio envelope. Pure client code, no keys involved. */
import { PARODY_DISCLAIMER, type Character, type RenderResult, type Scenario, type ViewName, type Viseme } from "./contract";

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
  a: { f1: 800, f2: 1250, v: "D" },
  e: { f1: 450, f2: 2000, v: "C" },
  i: { f1: 300, f2: 2300, v: "B" },
  o: { f1: 500, f2: 900, v: "E" },
  u: { f1: 330, f2: 800, v: "F" },
};
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Placeholder "voice": a formant-shaped babble that follows the script syllables. */
export function synthTrack(ctx: BaseAudioContext, r: RenderResult): Track {
  const sr = 22050;
  const total = Math.ceil((r.durationMs / 1000) * sr);
  const pcm = new Float32Array(total);
  const n = Math.ceil((r.durationMs / 1000) * FPS_ENV);
  const env = new Float32Array(n);
  const vis: Viseme[] = Array(n).fill("X");
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
        for (let k = k0; k < k1 && k < n; k++) vis[k] = c === " " ? "A" : "X";
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
        vis[k] = env[k] < 0.15 ? "A" : v;
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
    vis.push(env[k] < 0.08 ? "X" : env[k] < 0.2 ? "A" : env[k] > 0.65 ? "D" : env[k] > 0.4 ? "C" : "B");
  }
  for (const l of r.script) {
    for (let k = Math.floor(l.startMs / 10); k < Math.min(n, l.endMs / 10); k++) who[k] = l.speaker;
    l.visemes?.forEach((v, i, arr) => {
      const k1 = Math.min(n, Math.floor((arr[i + 1]?.t ?? v.t + 0.1) * FPS_ENV));
      for (let k = Math.floor(v.t * FPS_ENV); k < k1; k++) vis[k] = v.v;
    });
  }
  return { buffer: buf, env, vis, who };
}

export type Images = Map<string, HTMLImageElement>;

export async function loadImages(chars: Character[]): Promise<Images> {
  const urls = new Set<string>();
  chars.forEach((c) => {
    Object.values(c.views).forEach((v) => {
      v.layers.forEach((l) => urls.add(l.url));
      Object.values(v.visemes).forEach((l) => l && urls.add(l.url));
    });
    if (c.photo) urls.add(c.photo.url);
  });
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

const BG: Record<Scenario, [string, string]> = {
  studio: ["#161616", "#0b0b0b"],
  classroom: ["#14171a", "#0b0c0d"],
  arena: ["#1a1414", "#0c0a0a"],
  space: ["#0d0e14", "#050507"],
};

function background(g: CanvasRenderingContext2D, s: Scenario, t: number) {
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, BG[s][0]);
  grad.addColorStop(1, BG[s][1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(255,255,255,.035)";
  g.fillRect(0, H * 0.82, W, H * 0.18);
  if (s === "space") {
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(255,255,255,${0.15 + 0.35 * Math.abs(Math.sin(i * 12.9 + t * 0.6 * (i % 3)))})`;
      g.fillRect((i * 137.5) % W, (i * 71.3) % (H * 0.8), 1.5, 1.5);
    }
  } else if (s === "arena") {
    for (const x of [0.25, 0.75]) {
      const r = g.createRadialGradient(W * x, H * 0.9, 10, W * x, H * 0.9, 380);
      r.addColorStop(0, "rgba(255,255,255,.07)");
      r.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, W, H);
    }
  }
}

/** Neutral placeholder while the core has not delivered a rig. Turns with the view. */
function drawPlaceholder(g: CanvasRenderingContext2D, amp: number, vis: Viseme, t: number, view: ViewName, seed: number) {
  const turn = view === "left" ? -1 : view === "right" ? 1 : 0;
  const by = Math.sin(t * 1.6 + seed) * 2;
  g.fillStyle = "#2a2a2a";
  g.beginPath();
  g.moveTo(96, 640);
  g.bezierCurveTo(96, 500, 170, 430, 256, 430);
  g.bezierCurveTo(342, 430, 416, 500, 416, 640);
  g.closePath();
  g.fill();
  g.fillStyle = "#333";
  g.beginPath();
  g.ellipse(256 + turn * 14, 300 + by - amp * 3, 108 - Math.abs(turn) * 10, 128, 0, 0, 7);
  g.fill();
  // mouth: a quiet line that opens with the viseme
  const open = vis === "X" || vis === "A" ? 0 : vis === "D" ? 1 : vis === "B" ? 0.35 : 0.6;
  const mx = 256 + turn * 34;
  g.fillStyle = "rgba(255,255,255,.55)";
  g.beginPath();
  g.roundRect(mx - 22 + Math.abs(turn) * 6, 352 + by - amp * 3, 44 - Math.abs(turn) * 12, 3 + open * 16, 6);
  g.fill();
}

export function viewFor(r: RenderResult, speaker: number, idx: number, tMs: number): ViewName {
  const line = r.script.find((l) => tMs >= l.startMs && tMs <= l.endMs + 350);
  if (line && line.speaker === idx && line.view) return line.view;
  if (r.template === "debate") return idx === 0 ? "right" : "left";
  return "front";
}

function drawCharacter(g: CanvasRenderingContext2D, c: Character, img: Images, cx: number, scale: number, amp: number, vis: Viseme, t: number, view: ViewName, seed: number) {
  const v = c.views[view] ?? c.views.front;
  const cw = v?.canvas.w ?? 512, ch = v?.canvas.h ?? 640;
  // Fit any core canvas to the same on-screen height (the mock's 640px canvas keeps ~its old size).
  const fit = (scale * H * 0.92) / ch;
  g.save();
  g.translate(cx, H * 0.98);
  g.scale(fit, fit);
  g.translate(-cw / 2, -ch);
  const breathe = Math.sin(t * 1.6 + seed) * 2;
  if (c.photo) {
    const im = img.get(c.photo.url);
    if (im) {
      const w = cw * 0.86, h = w / (im.width / im.height);
      const x0 = (cw - w) / 2, y0 = ch - h + breathe;
      const j = c.photo.jaw;
      const drop = amp * j.h * h * 0.55;
      g.shadowColor = "rgba(0,0,0,.45)";
      g.shadowBlur = 30;
      g.drawImage(im, x0, y0, w, h);
      g.shadowBlur = 0;
      g.fillStyle = "#120808";
      g.fillRect(x0 + j.x * w, y0 + j.y * h, j.w * w, drop + 1);
      g.drawImage(im, j.x * im.width, j.y * im.height, j.w * im.width, j.h * im.height, x0 + j.x * w, y0 + j.y * h + drop, j.w * w, j.h * h);
    }
    g.restore();
    return;
  }
  if (c.status === "placeholder" || !v || v.layers.length === 0) {
    drawPlaceholder(g, amp, vis, t, view, seed);
    g.restore();
    return;
  }
  const blink = (t + seed) % 3.6 < 0.12;
  const mouth = v.visemes[vis] ?? v.visemes.X;
  const parts = [...v.layers, ...(mouth ? [{ ...mouth, name: "mouth", z: mouth.z ?? 99 }] : [])].sort((a, b) => a.z - b.z);
  for (const l of parts) {
    if (l.name === "eyes" && blink) continue;
    if (l.name === "eyes_closed" && !blink) continue;
    const im = img.get(l.url);
    if (!im) continue;
    const head = l.name !== "body";
    g.drawImage(im, l.x, l.y + (head ? breathe - amp * 4 : breathe * 0.4) + (l.name === "brows" ? -amp * 6 : 0), l.w, l.h);
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
  const vis = track ? track.vis[Math.max(0, k)] : "X";
  background(g, r.scenario, t);
  const chars = r.characters;
  const say = (i: number) => (speaker === i ? [amp, vis] : [0, "X"]) as [number, Viseme];
  if (r.template === "debate") {
    const b = chars[1] ?? chars[0];
    drawCharacter(g, chars[0], img, W * 0.27, 0.85, ...say(0), t, viewFor(r, speaker, 0, tMs), 0);
    drawCharacter(g, b, img, W * 0.73, 0.85, ...say(1), t, viewFor(r, speaker, 1, tMs), 1.3);
  } else if (r.template === "lesson") {
    g.strokeStyle = "rgba(255,255,255,.12)";
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(W * 0.48, H * 0.14, W * 0.44, H * 0.48, 16);
    g.stroke();
    const cur = r.script.find((l) => tMs >= l.startMs && tMs <= l.endMs + 350) ?? r.script[0];
    g.fillStyle = "rgba(255,255,255,.85)";
    g.font = "500 28px Geist, ui-sans-serif, system-ui";
    g.textAlign = "left";
    wrap(g, cur?.text ?? "", W * 0.38).forEach((ln, i) => g.fillText(ln, W * 0.51, H * 0.24 + i * 40));
    drawCharacter(g, chars[0], img, W * 0.25, 0.9, ...say(0), t, viewFor(r, speaker, 0, tMs), 0);
  } else {
    drawCharacter(g, chars[0], img, W * 0.5, 0.95, ...say(0), t, viewFor(r, speaker, 0, tMs), 0);
  }
  // caption
  const line = r.script.find((l) => tMs >= l.startMs && tMs <= l.endMs);
  if (line && r.template !== "lesson") {
    g.font = "500 28px Geist, ui-sans-serif, system-ui";
    g.textAlign = "center";
    const ls = wrap(g, line.text, W * 0.66);
    g.fillStyle = "rgba(0,0,0,.55)";
    g.shadowColor = "rgba(0,0,0,.8)";
    g.shadowBlur = 12;
    g.fillStyle = "#fff";
    ls.forEach((s, i) => g.fillText(s, W / 2, H - 40 - (ls.length - 1 - i) * 38));
    g.shadowBlur = 0;
  }
  // parody disclaimer (always visible, baked into the video)
  g.font = "600 18px Geist, ui-sans-serif, system-ui";
  g.textAlign = "left";
  const label = r.disclaimer || PARODY_DISCLAIMER;
  const lw = g.measureText(label).width + 28;
  g.fillStyle = "rgba(255,255,255,.92)";
  g.beginPath();
  g.roundRect(24, 24, lw, 34, 17);
  g.fill();
  g.fillStyle = "#0a0a0a";
  g.fillText(label, 38, 47);
  g.font = "500 16px Geist, ui-sans-serif, system-ui";
  g.textAlign = "right";
  g.fillStyle = "rgba(255,255,255,.4)";
  g.fillText("animind", W - 28, 46);
}

export function pickMime() {
  const c = ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return c.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}
