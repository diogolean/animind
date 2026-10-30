"use client";
/* Browser-side preview renderer (Canvas 2D + Web Audio + MediaRecorder).
 * Mirrors what the Rigly engine does server-side: layered rig + mouth driven
 * by the audio envelope. Pure client code, no keys involved. */
import { PARODY_DISCLAIMER, type Character, type RenderResult, type ScriptLine, type ViewName, type Viseme } from "./contract";
import { ACCENT, camera, depthTransform, dropShadow, ease, FADE_IN_S, FADE_OUT_S, grade, H, lightFor, litLayer, PLACES, planShots, plates, W, handheld, type Cut, type Light, type Shot } from "./cinema";

export { H, W };
export const FPS_ENV = 100; // envelope samples per second

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

function drawCharacter(g: CanvasRenderingContext2D, c: Character, img: Images, cx: number, scale: number, amp: number, vis: Viseme, t: number, view: ViewName, seed: number, light: Light) {
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
      g.shadowColor = "rgba(0,0,0,.5)";
      g.shadowBlur = 40;
      g.shadowOffsetX = light.side * 18;
      g.shadowOffsetY = 8;
      g.drawImage(im, x0, y0, w, h);
      g.shadowColor = "transparent";
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
  const body = v.layers.filter((l) => l.name === "body" || l.name === "head").map((l) => ({ ...l, im: img.get(l.url)! })).filter((l) => l.im);
  if (body.length) {
    // soft shadow cast on the backdrop, away from the key light
    const sh = dropShadow(`${c.id}:${view}`, body, cw, ch);
    g.drawImage(sh, light.side * 26 / fit, 10 / fit + breathe * 0.4, cw, ch);
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
    const src = l.name === "mouth" ? im : litLayer(im, l, cw, ch, light, l.name === "body" || l.name === "head" || l.name === "hair");
    g.drawImage(src, l.x, l.y + (head ? breathe - amp * 4 : breathe * 0.4) + (l.name === "brows" ? -amp * 6 : 0), l.w, l.h);
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

const cutsCache = new WeakMap<RenderResult, Cut[]>();
const lineAt = (r: RenderResult, ms: number, grace = 0) => r.script.find((l) => ms >= l.startMs && ms <= l.endMs + grace);
let shotCanvas: HTMLCanvasElement | null = null;

function drawBoard(g: CanvasRenderingContext2D, r: RenderResult, tMs: number) {
  const x = W * 0.48, y = H * 0.14, bw = W * 0.44, bh = H * 0.48;
  if (r.scenario === "classroom") {
    g.fillStyle = "#462e1c";
    g.beginPath();
    g.roundRect(x, y, bw, bh, 10);
    g.fill();
    g.fillStyle = "#182c24";
    g.beginPath();
    g.roundRect(x + 12, y + 12, bw - 24, bh - 24, 6);
    g.fill();
  } else {
    g.fillStyle = "rgba(255,255,255,.06)";
    g.strokeStyle = "rgba(255,255,255,.18)";
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(x, y, bw, bh, 16);
    g.fill();
    g.stroke();
  }
  const cur = lineAt(r, tMs, 350) ?? r.script[0];
  g.fillStyle = r.scenario === "classroom" ? "rgba(236,238,228,.92)" : "rgba(255,255,255,.88)";
  g.font = "500 30px Geist, ui-sans-serif, system-ui";
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  wrap(g, cur?.text ?? "", W * 0.38).forEach((ln, i) => g.fillText(ln, x + W * 0.03, y + H * 0.08 + 24 + i * 44));
}

/** Plates (parallax + depth of field), then the characters, through one camera shot. */
function drawWorld(g: CanvasRenderingContext2D, r: RenderResult, img: Images, shot: Shot, drift: [number, number, number], t: number, tMs: number, speaker: number, amp: number, vis: Viseme) {
  const p = plates(r.scenario, r.template);
  g.save();
  depthTransform(g, shot, "far", drift);
  g.drawImage(p.far, 0, 0);
  depthTransform(g, shot, "mid", drift);
  g.drawImage(p.mid, 0, 0);
  depthTransform(g, shot, "stage", drift);
  const chars = r.characters;
  const say = (i: number) => (speaker === i ? [amp, vis] : [0, "X"]) as [number, Viseme];
  const place = PLACES[r.template] ?? PLACES.solo;
  const n = r.template === "debate" ? 2 : 1;
  if (r.template === "lesson") drawBoard(g, r, tMs);
  // the speaker is drawn last (in front)
  const order = [...Array(n).keys()].sort((a, b) => (a === speaker ? 1 : 0) - (b === speaker ? 1 : 0));
  for (const i of order) {
    const c = chars[i] ?? chars[0];
    drawCharacter(g, c, img, W * place[i][0], place[i][1], ...say(i), t, viewFor(r, speaker, i, tMs), i * 1.3, lightFor(r.scenario, r.template, i));
  }
  g.restore();
}

function roleLine(c: Character, r: RenderResult) {
  const a = c.photo?.attribution;
  if (a?.author) return `Foto: ${a.author}${a.license ? ` · ${a.license}` : ""}`;
  return { debate: "Debate", lesson: "Aula", solo: "Fala" }[r.template] + " · animind";
}

const prettyName = (s: string) => {
  const n = s.trim().replace(/\s+/g, " ");
  const v = n.charAt(0).toUpperCase() + n.slice(1);
  return v.length > 34 ? `${v.slice(0, 33).trimEnd()}…` : v;
};

function lowerThird(g: CanvasRenderingContext2D, r: RenderResult, line: ScriptLine, t: number) {
  const first = r.script.find((l) => l.speaker === line.speaker);
  const c = r.characters[line.speaker];
  if (first !== line || !c) return;
  const since = t - line.startMs / 1000;
  const hold = Math.min(3.4, (line.endMs - line.startMs) / 1000);
  const a = ease((since - 0.25) / 0.35) * (1 - ease((since - hold) / 0.3));
  if (a <= 0.01) return;
  const name = prettyName(c.name);
  const role = roleLine(c, r).toUpperCase();
  g.save();
  g.globalAlpha = a;
  g.font = "700 30px Geist, ui-sans-serif, system-ui";
  const nw = g.measureText(name).width;
  g.font = "600 15px Geist, ui-sans-serif, system-ui";
  g.letterSpacing = "2.2px";
  const rw = g.measureText(role).width;
  const pw = Math.min(620, Math.max(nw, rw) + 52);
  const right = r.template === "debate" && line.speaker === 1;
  const x = (right ? W - 64 - pw : 64) + Math.round(30 * (1 - a)) * (right ? 1 : -1);
  const y = H - 236;
  g.fillStyle = "rgba(8,8,10,.67)";
  g.beginPath();
  g.roundRect(x, y, pw, 92, 10);
  g.fill();
  g.fillStyle = ACCENT[r.scenario];
  g.beginPath();
  g.roundRect(x, y, 6, 92, 3);
  g.fill();
  g.textAlign = "left";
  g.textBaseline = "top";
  g.fillText(role, x + 27, y + 60);
  g.letterSpacing = "0px";
  g.font = "700 30px Geist, ui-sans-serif, system-ui";
  g.fillStyle = "#fff";
  g.fillText(name, x + 26, y + 16);
  g.restore();
}

export function drawFrame(g: CanvasRenderingContext2D, r: RenderResult, img: Images, track: Track | null, tMs: number) {
  const t = tMs / 1000;
  const k = Math.min(Math.floor(t * FPS_ENV), (track?.env.length ?? 1) - 1);
  const speaker = track ? track.who[Math.max(0, k)] : -1;
  const amp = track ? track.env[Math.max(0, k)] : 0;
  const vis = track ? track.vis[Math.max(0, k)] : "X";
  let cuts = cutsCache.get(r);
  if (!cuts) cutsCache.set(r, (cuts = planShots(r.template, r.script)));
  const drift = handheld(t);
  const takes = camera(cuts, t);
  g.save();
  g.imageSmoothingQuality = "high";
  takes.forEach(([weight, shot, blur], i) => {
    if (i === 0 && blur < 0.05) return drawWorld(g, r, img, shot, drift, t, tMs, speaker, amp, vis);
    // dissolve (second take) or whip pan: draw the take off-screen, then blend it in
    shotCanvas ??= Object.assign(document.createElement("canvas"), { width: W, height: H });
    const s = shotCanvas.getContext("2d")!;
    drawWorld(s, r, img, shot, drift, t, tMs, speaker, amp, vis);
    if (blur >= 0.05) {
      const taps = 7, span = 140 * blur;
      g.globalAlpha = 1;
      g.drawImage(shotCanvas, 0, 0);
      for (let j = 0; j < taps; j++) {
        g.globalAlpha = 0.5 * blur;
        g.drawImage(shotCanvas, ((j / (taps - 1)) - 0.5) * span, 0);
      }
    } else {
      g.globalAlpha = weight;
      g.drawImage(shotCanvas, 0, 0);
    }
    g.globalAlpha = 1;
  });
  grade(g, r.scenario);
  const fade = ease(t / FADE_IN_S) * ease((r.durationMs / 1000 - t) / FADE_OUT_S);
  if (fade < 0.999) {
    g.fillStyle = `rgba(0,0,0,${1 - fade})`;
    g.fillRect(0, 0, W, H);
  }
  // bottom scrim that seats the captions
  const sc = g.createLinearGradient(0, H * 0.68, 0, H);
  sc.addColorStop(0, "rgba(0,0,0,0)");
  sc.addColorStop(1, "rgba(0,0,0,.6)");
  g.fillStyle = sc;
  g.fillRect(0, H * 0.68, W, H * 0.32);
  const line = lineAt(r, tMs);
  if (line) lowerThird(g, r, line, t);
  if (line && r.template !== "lesson") {
    const a = ease((t - line.startMs / 1000) / 0.18);
    g.globalAlpha = a;
    g.font = "600 34px Geist, ui-sans-serif, system-ui";
    g.textAlign = "center";
    g.textBaseline = "top";
    const ls = wrap(g, line.text, W * 0.7).slice(0, 3);
    const y0 = H - 20 - ls.length * 44 + Math.round(6 * (1 - a));
    g.shadowColor = "rgba(0,0,0,.9)";
    g.shadowBlur = 10;
    g.shadowOffsetY = 2;
    g.fillStyle = "#fff";
    ls.forEach((s, i) => g.fillText(s, W / 2, y0 + i * 44));
    g.shadowColor = "transparent";
    g.globalAlpha = 1;
  }
  g.textBaseline = "alphabetic";
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
  g.fillStyle = "rgba(255,255,255,.43)";
  g.fillText("animind", W - 28, 46);
  g.restore();
}

export function pickMime() {
  const c = ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return c.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}
