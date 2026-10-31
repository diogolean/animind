"use client";
/* Browser-side preview renderer (Canvas 2D + Web Audio + MediaRecorder).
 * Mirrors what the Rigly engine does server-side: layered rig + mouth driven
 * by the audio envelope. Pure client code, no keys involved. */
import { PARODY_DISCLAIMER, type Character, type Layer, type RenderResult, type ScriptLine, type ViewName, type Viseme } from "./contract";
import { ACCENT, BOARD, BUST_BOTTOM, BUST_H, camera, contactShadow, depthTransform, ease, FADE_IN_S, FADE_OUT_S, grade, H, lectern, LECTERN_BASE, LECTERN_TOP, LECTERN_W, lightFor, litLayer, PLACES, planShots, plates, soft, blurNow, W, VW, VH, handheld, type Cut, type Light, type Shot } from "./cinema";
import { blink, gaze, type Lids } from "./eyes";

export { H, VH, VW, W };
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

/** Viseme changes are hard cuts (mirrors scene.XFADE_S = 0 in the core): every mouth sprite has its
 *  own alpha shape, so an alpha crossfade between two shapes shows two mouths at once. */
const XFADE_MS = 0;
let speakingFade: { cur: Viseme; prev: Viseme; w: number } | null = null;
export function visemeFade(vis: Viseme[], k: number): { cur: Viseme; prev: Viseme; w: number } {
  const cur = vis[k] ?? "X";
  let j = k;
  while (j > 0 && vis[j - 1] === cur) j--;
  const prev = j > 0 ? vis[j - 1] : cur;
  return { cur, prev, w: prev === cur || XFADE_MS <= 0 ? 1 : Math.min(1, ((k - j) * 10) / XFADE_MS) };
}

let irisCanvas: HTMLCanvasElement | null = null;
/** The iris layer moved by the gaze and clipped to the eye opening (socket), in canvas space. */
function movedIris(iris: HTMLImageElement, l: Layer, sock: HTMLImageElement, s: Layer, dx: number, dy: number) {
  irisCanvas ??= document.createElement("canvas");
  irisCanvas.width = s.w;
  irisCanvas.height = s.h;
  const o = irisCanvas.getContext("2d")!;
  o.clearRect(0, 0, s.w, s.h);
  o.drawImage(iris, l.x - s.x + dx, l.y - s.y + dy, l.w, l.h);
  o.globalCompositeOperation = "destination-in";
  o.drawImage(sock, 0, 0, s.w, s.h);
  o.globalCompositeOperation = "source-over";
  return irisCanvas;
}

/** Where character idx looks (mirrors Scene.gaze in the core). */
function gazeFor(r: RenderResult, idx: number, speaker: number, kind: string | undefined, view: ViewName, t: number) {
  const place = PLACES[r.template] ?? PLACES.solo;
  const toward = r.template === "debate" ? (place[Math.min(idx, place.length - 1)][0] < 0.5 ? 1 : -1) : r.template === "lesson" ? 1 : 0;
  let bias = speaker === idx ? (kind === "cu" ? 0.3 : 0.08) : 0;
  if (r.template === "solo") bias += 0.35;
  const facing = view === "left" ? -1 : view === "right" ? 1 : 0;
  return { lids: blink(t, 7 + idx * 13), gaze: gaze(t, 101 + idx * 57, { toward, view, facing, cameraBias: bias }) };
}

type EyeState = { lids: Lids; gaze: [number, number] };

function drawCharacter(g: CanvasRenderingContext2D, c: Character, img: Images, cx: number, scale: number, amp: number, vis: Viseme, t: number, view: ViewName, seed: number, light: Light, eye: EyeState = { lids: "open", gaze: [0, 0] }) {
  const v = c.views[view] ?? c.views.front;
  const cw = v?.canvas.w ?? 512, ch = v?.canvas.h ?? 640;
  // Fit any core canvas to the same bust height; the bust stands behind a lectern that hides the cut.
  const fit = (scale * H * BUST_H) / ch;
  g.save();
  g.translate(cx, H * BUST_BOTTOM);
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
  const lids = eye.lids;
  const mouth = v.visemes[vis] ?? v.visemes.X;
  const parts = [...v.layers, ...(mouth ? [{ ...mouth, name: "mouth", z: mouth.z ?? 99 }] : [])].sort((a, b) => a.z - b.z);
  const socket = v.layers.find((l) => l.name === "eye_socket");
  const movable = !!socket && v.layers.some((l) => l.name === "iris") && v.layers.some((l) => l.name === "eye_white");
  const [mx, my] = v.eyeRig?.maxShift ?? [0, 0];
  for (const l of parts) {
    if (l.name === "eye_socket" || (movable && l.name === "eyes")) continue;
    if ((l.name === "eyes" && lids === "closed") || (l.name === "eyes_closed" && lids !== "closed") || (l.name === "eyes_half" && lids !== "half")) continue;
    const im = img.get(l.url);
    if (!im) continue;
    // The face no longer rides the jaw: only the mouth layer changes with speech.
    const dy = breathe * (BREATH_SHARE[l.name] ?? 1) + (l.name === "brows" ? -amp * 2 : 0);
    if (l.name === "iris" && socket) {
      const sk = img.get(socket.url);
      const gx = Math.max(-1, Math.min(1, eye.gaze[0])), gy = Math.max(-1, Math.min(1, eye.gaze[1]));  // iris never leaves the socket
      if (sk) g.drawImage(movedIris(im, l, sk, socket, gx * mx, gy * my), socket.x, socket.y + dy, socket.w, socket.h);
      continue;
    }
    const lit = ["body", "torso", "neck", "head", "hair"].includes(l.name);
    const src = l.name === "mouth" || l.name === "iris" || l.name.startsWith("eye") ? im : litLayer(im, l, cw, ch, light, lit);
    const fade = l.name === "mouth" && speakingFade && speakingFade.cur === vis ? speakingFade : null;
    const prevMouth = fade && fade.w < 1 ? v.visemes[fade.prev] : undefined;
    const prevIm = prevMouth ? img.get(prevMouth.url) : undefined;
    if (prevMouth && prevIm) {
      g.drawImage(prevIm, prevMouth.x, prevMouth.y + dy, prevMouth.w, prevMouth.h);
      g.globalAlpha = fade!.w;
    }
    g.drawImage(src, l.x, l.y + dy, l.w, l.h);
    g.globalAlpha = 1;
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

/** Share of the breath each layer follows (torso least); head, eyes and mouth follow it fully. */
const BREATH_SHARE: Record<string, number> = { body: 0.4, torso: 0.4, neck: 0.7 };

const cutsCache = new WeakMap<RenderResult, Cut[]>();
const lineAt = (r: RenderResult, ms: number, grace = 0) => r.script.find((l) => ms >= l.startMs && ms <= l.endMs + grace);
let shotCanvas: HTMLCanvasElement | null = null;

const boardCache = new Map<string, HTMLCanvasElement>();
/** Lesson board: beat label, the line set as large as the board allows (vertically centred), and the
 *  quote's source at the foot; out of focus behind the teacher in a medium close-up. */
function drawBoard(g: CanvasRenderingContext2D, r: RenderResult, tMs: number, blurred: boolean) {
  const [bx0, by0, bx1, by1] = BOARD;
  const x = W * bx0, y = H * by0, bw = W * (bx1 - bx0), bh = H * (by1 - by0);
  const cur = lineAt(r, tMs, 350) ?? r.script[0];
  const key = `${r.scenario}|${cur?.kind}|${cur?.beat}|${cur?.text}`;
  let c = boardCache.get(key);
  if (!c) {
    if (boardCache.size > 24) boardCache.clear();
    c = Object.assign(document.createElement("canvas"), { width: Math.round(bw), height: Math.round(bh) });
    const b = c.getContext("2d")!;
    if (r.scenario === "classroom") { // chalkboard in a wooden frame, with a chalk tray
      b.fillStyle = "#523620";
      b.beginPath();
      b.roundRect(0, 0, bw, bh, 10);
      b.fill();
      b.fillStyle = "#1a3027";
      b.beginPath();
      b.roundRect(14, 14, bw - 28, bh - 28, 5);
      b.fill();
      b.fillStyle = "#68462a";
      b.fillRect(30, bh - 14, bw - 60, 10);
    } else { // dark glass screen with a thin accent frame
      b.fillStyle = "rgba(10,12,16,.9)";
      b.strokeStyle = ACCENT[r.scenario];
      b.globalAlpha = 1;
      b.beginPath();
      b.roundRect(1, 1, bw - 2, bh - 2, 14);
      b.fill();
      b.globalAlpha = 0.6;
      b.lineWidth = 2;
      b.stroke();
      b.globalAlpha = 1;
    }
    const ink = r.scenario === "classroom" ? "rgba(238,240,230,.94)" : "rgba(255,255,255,.94)";
    const quote = cur?.kind === "quote";
    const tx = bw * 0.075, width = bw * 0.85, top = bh * 0.1;
    b.textAlign = "left";
    b.textBaseline = "top";
    if (cur?.beat) {
      b.font = "700 17px Geist, ui-sans-serif, system-ui";
      b.fillStyle = ACCENT[r.scenario];
      b.letterSpacing = "3.5px";
      b.fillText(cur.beat.toUpperCase(), tx, top);
      b.letterSpacing = "0px";
      b.fillRect(tx, top + 30, 44, 3);
    }
    const text = quote ? `“${cur!.text}”` : cur?.text ?? "";
    const src = quote ? cur!.quote?.source ?? "" : "";
    const bodyTop = top + 50, bodyBot = bh - bh * (src ? 0.17 : 0.09);
    const room = bodyBot - bodyTop;
    let rows: string[] = [], step = 44;
    for (const size of [52, 48, 44, 40, 37, 34, 31, 28, 25, 22]) { // largest size whose rows fit
      b.font = `${quote ? "italic " : ""}600 ${size}px Geist, ui-sans-serif, system-ui`;
      rows = wrap(b, text, width);
      step = size * 1.3;
      if (rows.length * step <= room) break;
    }
    const y0 = bodyTop + Math.max(0, (room - rows.length * step) / 2);
    b.fillStyle = ink;
    rows.forEach((ln, i) => b.fillText(ln, tx, y0 + i * step));
    if (src) {
      b.font = "500 17px Geist, ui-sans-serif, system-ui";
      b.globalAlpha = 0.7;
      b.textBaseline = "middle";
      b.fillText(fit(b, `— ${src}`, width), tx, bh - bh * 0.1);
      b.globalAlpha = 1;
    }
    boardCache.set(key, c);
  }
  g.save();
  g.shadowColor = "rgba(0,0,0,.55)";
  g.shadowBlur = 24;
  g.shadowOffsetY = 8;
  g.drawImage(blurred ? soft(c) : c, x, y, bw, bh);
  g.restore();
}

/** Trim `text` with an ellipsis until it fits `maxW`. */
function fit(g: CanvasRenderingContext2D, text: string, maxW: number) {
  let t = text;
  while (g.measureText(t).width > maxW && t.length > 8) t = `${t.replace(/…$/, "").slice(0, -2).replace(/[\s,·]+$/, "")}…`;
  return t;
}

/** Caption rows in pages of two; pages advance in proportion to their words, like cinema subtitles. */
export function captionPage(g: CanvasRenderingContext2D, line: ScriptLine, tMs: number, maxW: number) {
  const text = line.kind === "quote" ? `“${line.text}”` : line.text;
  const rows = wrap(g, text, maxW);
  const pages: string[][] = [];
  for (let i = 0; i < rows.length; i += 2) pages.push(rows.slice(i, i + 2));
  if (pages.length < 2) return pages[0] ?? [];
  const frac = (tMs - line.startMs) / Math.max(100, line.endMs - line.startMs);
  const sizes = pages.map((p) => p.join(" ").split(" ").length);
  const total = sizes.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < pages.length; i++) {
    acc += sizes[i] / total;
    if (frac < acc) return pages[i];
  }
  return pages[pages.length - 1];
}

/** Top-center chip: "CITAÇÃO REAL · source · Wikiquote" for a real quote, "PARÁFRASE" for written lines. */
function sourceChip(g: CanvasRenderingContext2D, r: RenderResult, line: ScriptLine, t: number) {
  if (line.kind !== "quote" && line.kind !== "paraphrase") return;
  const head = line.kind === "quote" ? "CITAÇÃO REAL" : "PARÁFRASE";
  const basis = line.basis?.source;
  g.font = "500 17px Geist, ui-sans-serif, system-ui";
  const src = fit(g, line.kind === "quote" ? `${line.quote?.source ?? ""} · ${line.quote?.site ?? "Wikiquote"}` : basis ? `inspirada em ${basis}` : "fala escrita para a cena", 560);
  const sw = g.measureText(src).width;
  g.font = "700 15px Geist, ui-sans-serif, system-ui";
  const hw = g.measureText(head).width + head.length * 2;
  const w = hw + sw + 66, a = ease((t - line.startMs / 1000) / 0.25);
  const x = (W - w) / 2, y = 22 - Math.round(8 * (1 - a));
  g.save();
  g.globalAlpha = a;
  g.fillStyle = "rgba(8,8,10,.69)";
  g.beginPath();
  g.roundRect(x, y, w, 40, 20);
  g.fill();
  const dot = line.kind === "quote" ? ACCENT[r.scenario] : "rgb(200,200,205)";
  g.fillStyle = dot;
  g.beginPath();
  g.arc(x + 21, y + 20, 5, 0, Math.PI * 2);
  g.fill();
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.letterSpacing = "2px";
  g.fillText(head, x + 36, y + 21);
  g.letterSpacing = "0px";
  g.font = "500 17px Geist, ui-sans-serif, system-ui";
  g.fillStyle = "rgba(255,255,255,.86)";
  g.fillText(src, x + 36 + hw + 12, y + 21);
  g.restore();
}

let charCanvas: HTMLCanvasElement | null = null;
/** Plates (parallax + depth of field), then contact shadows, the characters behind their lecterns,
 *  through one camera shot. In a single (over-the-shoulder / close-up) the listener is out of focus. */
function drawWorld(g: CanvasRenderingContext2D, r: RenderResult, img: Images, shot: Shot, drift: [number, number, number], t: number, tMs: number, speaker: number, amp: number, vis: Viseme) {
  const p = plates(r.scenario, r.template);
  const vert = r.format === "9:16";
  g.save();
  depthTransform(g, shot, "far", drift, vert);
  g.drawImage(p.far, 0, 0);
  depthTransform(g, shot, "mid", drift, vert);
  g.drawImage(p.mid, 0, 0);
  depthTransform(g, shot, "stage", drift, vert);
  const chars = r.characters;
  const say = (i: number) => (speaker === i ? [amp, vis] : [0, "X"]) as [number, Viseme];
  const place = PLACES[r.template] ?? PLACES.solo;
  const n = r.template === "debate" ? 2 : 1;
  if (r.template === "lesson") drawBoard(g, r, tMs, shot.kind === "mcu");
  const sh = contactShadow();
  for (let i = 0; i < n; i++) {
    const side = lightFor(r.scenario, r.template, i).side;
    g.drawImage(sh, W * place[i][0] - sh.width / 2 + side * W * 0.012, H * LECTERN_BASE - sh.height * 0.55);
  }
  const single = n > 1 && ["ots", "cu", "single", "react"].includes(shot.kind ?? "");
  // the speaker is drawn last (in front)
  const order = [...Array(n).keys()].sort((a, b) => (a === speaker ? 1 : 0) - (b === speaker ? 1 : 0));
  for (const i of order) {
    const c = chars[i] ?? chars[0];
    const light = lightFor(r.scenario, r.template, i);
    const cx = W * place[i][0];
    const lec = lectern(r.scenario, light);
    const lx = cx - (W * LECTERN_W) / 2, ly = H * LECTERN_TOP;
    if (single && speaker >= 0 && i !== speaker) {
      // listener: draw into an off-screen canvas in stage space, then lay in a blurred, darker copy
      charCanvas ??= Object.assign(document.createElement("canvas"), { width: W, height: H });
      const o = charCanvas.getContext("2d")!;
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.clearRect(0, 0, W, H);
      const lv = viewFor(r, speaker, i, tMs);
      drawCharacter(o, c, img, cx, place[i][1], 0, "X", t, lv, i * 1.3, light, gazeFor(r, i, speaker, shot.kind, lv, t));
      o.drawImage(lec, lx, ly);
      o.globalCompositeOperation = "source-atop";
      o.fillStyle = "rgba(0,0,0,.38)";
      o.fillRect(0, 0, W, H);
      o.globalCompositeOperation = "source-over";
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      depthTransform(g, shot, "stage", drift, vert);
      g.drawImage(blurNow(charCanvas), 0, 0);
      g.restore();
      continue;
    }
    const view = viewFor(r, speaker, i, tMs);
    drawCharacter(g, c, img, cx, place[i][1], ...say(i), t, view, i * 1.3, light, gazeFor(r, i, speaker, shot.kind, view, t));
    g.drawImage(lec, lx, ly);
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

function lowerThird(g: CanvasRenderingContext2D, r: RenderResult, line: ScriptLine, t: number, kind?: string) {
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
  // wide/two: under the speaker; close debate shots: on the open side, off the face
  const close = kind === "ots" || kind === "cu";
  const right = r.template === "debate" && (line.speaker === 1) !== close;
  const x = (right ? W - 64 - pw : 64) + Math.round(30 * (1 - a)) * (right ? 1 : -1);
  const y = H - 262;
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
  speakingFade = track ? visemeFade(track.vis, Math.max(0, k)) : null;
  let cuts = cutsCache.get(r);
  if (!cuts) cutsCache.set(r, (cuts = planShots(r.template, r.script, r.format === "9:16")));
  const vert = r.format === "9:16";
  const FW = vert ? VW : W, FH = vert ? VH : H, ks = vert ? 1.45 : 1;
  const drift = handheld(t);
  const takes = camera(cuts, t);
  g.save();
  g.imageSmoothingQuality = "high";
  takes.forEach(([weight, shot, blur], i) => {
    if (i === 0 && blur < 0.05) return drawWorld(g, r, img, shot, drift, t, tMs, speaker, amp, vis);
    // dissolve (second take) or whip pan: draw the take off-screen, then blend it in
    if (!shotCanvas || shotCanvas.width !== FW) shotCanvas = Object.assign(document.createElement("canvas"), { width: FW, height: FH });
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
    g.fillRect(0, 0, FW, FH);
  }
  // bottom scrim that seats the captions
  const s0 = vert ? 0.62 : 0.68;
  const sc = g.createLinearGradient(0, FH * s0, 0, FH);
  sc.addColorStop(0, "rgba(0,0,0,0)");
  sc.addColorStop(1, "rgba(0,0,0,.6)");
  g.fillStyle = sc;
  g.fillRect(0, FH * s0, FW, FH * (1 - s0));
  const line = lineAt(r, tMs);
  const kind = takes[takes.length - 1][1].kind;
  // vertical: the 16:9 chip and lower third, scaled to the narrower frame (chip below the top chrome)
  const fit = (y: number, f: () => void) => {
    g.save();
    if (vert) g.setTransform(FW / W, 0, 0, FW / W, 0, y);
    f();
    g.restore();
  };
  if (line) fit(FH * 0.58 - (H - 262) * (FW / W), () => lowerThird(g, r, line, t, vert ? "cu" : kind));
  if (line) fit(90, () => sourceChip(g, r, line, t));
  const onBoard = r.template === "lesson" && (kind === "board" || kind === "wide");
  if (line && !onBoard) { // the lesson reads the board; captions only when it is out of frame
    const a = ease((t - line.startMs / 1000) / 0.18);
    g.globalAlpha = a;
    const cap = `${line.kind === "quote" ? "italic " : ""}600 ${Math.round(34 * ks)}px Geist, ui-sans-serif, system-ui`;
    g.font = cap;
    g.textAlign = "center";
    g.textBaseline = "top";
    const ls = captionPage(g, line, tMs, FW * (vert ? 0.86 : 0.72));
    const lh = Math.round(44 * ks);
    const y0 = (vert ? FH * 0.7 + 40 : H - 22 - ls.length * lh) + Math.round(6 * (1 - a));
    g.shadowColor = "rgba(0,0,0,.9)";
    g.shadowBlur = 10;
    g.shadowOffsetY = 2;
    const who = r.characters[line.speaker];
    if (who) { // tracked speaker label in the accent colour, above the rows
      g.font = `700 ${Math.round(16 * ks)}px Geist, ui-sans-serif, system-ui`;
      g.letterSpacing = "2.6px";
      g.fillStyle = ACCENT[r.scenario];
      g.fillText(prettyName(who.name).toUpperCase(), FW / 2, y0 - 26 * ks);
      g.letterSpacing = "0px";
      g.font = cap;
    }
    g.fillStyle = "#fff";
    ls.forEach((s, i) => g.fillText(s, FW / 2, y0 + i * lh));
    g.shadowColor = "transparent";
    g.globalAlpha = 1;
  }
  g.textBaseline = "alphabetic";
  // parody disclaimer (always visible, baked into the video); larger and below the top chrome in 9:16
  if (vert) g.setTransform(ks, 0, 0, ks, 0, 40);
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
  g.fillText("animind", FW / ks - 28, 46);
  g.restore();
}

export function pickMime() {
  const c = ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return c.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}
