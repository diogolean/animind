"use client";
/* Cinematic look for the browser preview, mirroring the core's
 * products/animind_core/look.py: built sets per scenario on parallax plates
 * (perspective floor under the horizon, set pieces and practical lights that
 * match the rim colours, depth-of-field blur), lecterns with contact shadows,
 * rim/key light and set ambient on the rig layers, shot grammar (wide,
 * over-the-shoulder, close-up on quotes, two-shot) with cuts, dissolves and
 * whip pans, a colour grade and a vignette. Plates and lit layers are built once and
 * cached; every per-frame value is a pure function of time (deterministic). */
import type { Scenario, SceneTemplate, ScriptLine } from "./contract";

export const W = 1280;
export const H = 720;
/** Vertical 9:16 output (as in the core): a VWIN-wide window of the same 16:9 set, shot at OW x OH. */
export const VW = 1080, VH = 1920, VWIN = (H * 9) / 16;
const MARGIN = 1.3;
const PW = Math.round(W * MARGIN), PH = Math.round(H * MARGIN);
const OX = (PW - W) / 2, OY = (PH - H) / 2;
const HORIZON = 0.6;
export const PARALLAX = { far: 0.5, mid: 0.75, stage: 1 } as const;
export const DISSOLVE_S = 0.45, WHIP_S = 0.3, FADE_IN_S = 0.5, FADE_OUT_S = 0.6;

/** (x centre as a fraction of W, scale on top of BUST_H) */
export const PLACES: Record<SceneTemplate, [number, number][]> = {
  debate: [[0.29, 1], [0.71, 1]],
  lesson: [[0.25, 1]],
  solo: [[0.5, 1.06]],
};
/** Set geometry (fractions of H / W), as in scene.py: busts stand behind lecterns that hide the cut. */
export const BUST_H = 0.55, BUST_BOTTOM = 0.8;
export const LECTERN_TOP = 0.645, LECTERN_BASE = 0.835, LECTERN_W = 0.27;
export const FACE_Y = 0.42;
export const BOARD = [0.45, 0.08, 0.94, 0.62] as const;
const RIM: Record<Scenario, string[]> = {
  studio: ["#ffd199", "#9edbff"],
  classroom: ["#ffe6b8", "#ffe6b8"],
  arena: ["#ff616b", "#6b9eff"],
  space: ["#8cd9ff", "#d99aff"],
};
/** soft-light tint (split tone) and its strength, per scenario */
const GRADE: Record<Scenario, [string, number]> = {
  studio: ["#3a6f7a", 0.22],
  classroom: ["#a8743a", 0.22],
  arena: ["#7a2f6e", 0.2],
  space: ["#2f4f9a", 0.24],
};
export const ACCENT: Record<Scenario, string> = { studio: "#f5b042", classroom: "#f0c46e", arena: "#ff5460", space: "#60d6ff" };

/** the set's bounce light, multiplied into the characters */
const AMBIENT: Record<Scenario, string> = { studio: "#e6edff", classroom: "#ffebcc", arena: "#fad6f2", space: "#d1e6ff" };
export interface Light { side: number; rim: string; ambient: string }

export function lightFor(scenario: Scenario, template: SceneTemplate, idx: number): Light {
  const px = PLACES[template][Math.min(idx, PLACES[template].length - 1)][0];
  const side = template === "solo" ? 1 : px < 0.5 ? -1 : 1;
  const rims = RIM[scenario] ?? RIM.studio;
  return { side, rim: rims[Math.min(idx, rims.length - 1)], ambient: AMBIENT[scenario] ?? AMBIENT.studio };
}

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
const ctx2d = (c: HTMLCanvasElement) => c.getContext("2d")!;

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Blur by down/up-sampling: works in every browser (no ctx.filter needed). */
function softBlur(src: HTMLCanvasElement, factor: number) {
  const small = canvas(src.width / factor, src.height / factor);
  const s = ctx2d(small);
  s.imageSmoothingQuality = "high";
  s.drawImage(src, 0, 0, small.width, small.height);
  const out = canvas(src.width, src.height);
  const o = ctx2d(out);
  o.imageSmoothingQuality = "high";
  o.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

const px = (fx: number) => OX + fx * W;
const py = (fy: number) => OY + fy * H;

function pool(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const r = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  r.addColorStop(0, color);
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r;
  g.globalCompositeOperation = "lighter";
  g.fillRect(-rx, -rx, rx * 2, rx * 2);
  g.restore();
}

const rect = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, fill: string | CanvasGradient) => {
  g.fillStyle = fill;
  g.fillRect(px(x0), py(y0), (x1 - x0) * W, (y1 - y0) * H);
};

/** Floor below the horizon: gradient, perspective seams/planks/tiles toward a vanishing point, and a
 *  fading mirror of the wall (gloss). */
function floor(g: CanvasRenderingContext2D, c: HTMLCanvasElement, top: string, bottom: string, reflect: number, pattern: "seams" | "planks" | "tiles", line: string) {
  const hy = py(HORIZON), n = PH - hy, vx = px(0.5);
  const grad = g.createLinearGradient(0, hy, 0, PH);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, hy, PW, n);
  const refl = canvas(PW, n);
  const r = ctx2d(refl);
  r.translate(0, n);
  r.scale(1, -1);
  r.drawImage(c, 0, hy - n, PW, n, 0, 0, PW, n);
  r.setTransform(1, 0, 0, 1, 0, 0);
  r.globalCompositeOperation = "destination-in";
  const m = r.createLinearGradient(0, 0, 0, n);
  m.addColorStop(0, `rgba(0,0,0,${reflect})`);
  m.addColorStop(1, "rgba(0,0,0,0)");
  r.fillStyle = m;
  r.fillRect(0, 0, PW, n);
  g.drawImage(refl, 0, hy);
  // perspective lines, fading toward the horizon
  const lines = canvas(PW, n);
  const l = ctx2d(lines);
  l.strokeStyle = line;
  l.lineWidth = pattern === "planks" ? 1.5 : 2;
  const step = pattern === "planks" ? 0.045 : 0.11;
  for (let k = -30; k <= 30; k++) {
    l.beginPath();
    l.moveTo(vx - 0, 0);
    l.lineTo(vx + k * step * W * 2.2, n * 1.0);
    l.stroke();
  }
  if (pattern !== "planks") for (let i = 1; i < 12; i++) {
    const y = n * (0.06 * i * i) / 1.2;
    if (y > n) break;
    l.fillStyle = line;
    l.fillRect(0, y, PW, 2);
  }
  l.globalCompositeOperation = "destination-in";
  const f = l.createLinearGradient(0, 0, 0, n);
  f.addColorStop(0, "rgba(0,0,0,0)");
  f.addColorStop(0.25, "rgba(0,0,0,1)");
  l.fillStyle = f;
  l.fillRect(0, 0, PW, n);
  g.drawImage(lines, 0, hy);
  g.fillStyle = "rgba(255,255,255,.05)";
  g.fillRect(0, hy, PW, 2);
}

function far(s: Scenario, places: number[]) {
  const c = canvas(PW, PH);
  const g = ctx2d(c);
  const v = (a: string, b: string) => {
    const grad = g.createLinearGradient(0, 0, 0, PH);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    g.fillStyle = grad;
    g.fillRect(0, 0, PW, PH);
  };
  const rims = RIM[s] ?? RIM.studio;
  if (s === "classroom") {
    v("#8a7558", "#5a4a37"); // plaster wall
    rect(g, -0.2, 0.4, 1.2, HORIZON, "#4a3220"); // wainscot
    rect(g, -0.2, 0.395, 1.2, 0.405, "#6b4a2e");
    // sunlit window on the left, with mullions
    const win = g.createLinearGradient(0, py(0.08), 0, py(0.5));
    win.addColorStop(0, "#e8f1fa");
    win.addColorStop(1, "#b9cfe0");
    rect(g, -0.02, 0.08, 0.2, 0.5, "#5a3f28");
    rect(g, -0.005, 0.095, 0.185, 0.485, win);
    rect(g, 0.083, 0.095, 0.092, 0.485, "#5a3f28");
    rect(g, -0.005, 0.28, 0.185, 0.29, "#5a3f28");
    pool(g, px(0.09), py(0.3), 0.3 * W, 0.35 * H, "rgba(255,236,190,.35)");
    // bookcase on the right
    rect(g, 0.82, 0.06, 1.15, HORIZON, "#3d2614");
    const r = rng(5);
    const pal = ["#731f1a", "#264066", "#806633", "#33522e", "#8c8066", "#5a2846"];
    for (let shelf = 0; shelf < 4; shelf++) {
      const y1 = 0.1 + (shelf + 1) * 0.12;
      for (let x = 0.832; x < 1.13;) {
        const bw = 0.008 + r() * 0.008;
        g.globalAlpha = 0.6 + r() * 0.4;
        rect(g, x, y1 - 0.07 - r() * 0.025, x + bw, y1 - 0.004, pal[Math.floor(r() * pal.length)]);
        g.globalAlpha = 1;
        x += bw + 0.002;
      }
      rect(g, 0.82, y1 - 0.004, 1.15, y1 + 0.006, "#3d2614");
    }
    floor(g, c, "#6b4a2e", "#3a2616", 0.08, "planks", "rgba(0,0,0,.22)");
    pool(g, px(0.22), py(0.75), 0.22 * W, 0.08 * H, "rgba(255,226,170,.25)"); // sun patch
  } else if (s === "arena") {
    v("#0b0714", "#07050b");
    pool(g, px(0.08), py(0.3), 0.5 * W, 0.6 * H, "rgba(140,14,30,1)");
    pool(g, px(0.92), py(0.3), 0.5 * W, 0.6 * H, "rgba(14,40,150,1)");
    // jumbotron
    rect(g, 0.37, 0.03, 0.63, 0.23, "#111018");
    const jb = g.createLinearGradient(px(0.38), 0, px(0.62), 0);
    jb.addColorStop(0, rims[0]);
    jb.addColorStop(1, rims[1]);
    g.globalAlpha = 0.35;
    rect(g, 0.38, 0.045, 0.62, 0.215, jb);
    g.globalAlpha = 1;
    // LED ad board along the horizon
    const led = g.createLinearGradient(px(-0.2), 0, px(1.2), 0);
    led.addColorStop(0, "#5a0c16");
    led.addColorStop(0.5, "#1c1530");
    led.addColorStop(1, "#0c1f66");
    rect(g, -0.2, HORIZON - 0.07, 1.2, HORIZON, led);
    rect(g, -0.2, HORIZON - 0.072, 1.2, HORIZON - 0.068, "rgba(255,255,255,.25)");
    floor(g, c, "#120d18", "#060408", 0.4, "seams", "rgba(255,255,255,.035)");
    // ring disc with a glowing edge
    g.save();
    g.translate(px(0.5), py(0.82));
    g.scale(1, 0.16);
    g.strokeStyle = "rgba(255,84,96,.55)";
    g.lineWidth = 10;
    g.beginPath();
    g.arc(0, 0, 0.46 * W, 0, 7);
    g.stroke();
    g.restore();
  } else if (s === "space") {
    v("#02030a", "#03040d");
    const r = rng(7);
    for (let i = 0; i < 14; i++) {
      const col = i % 3 === 0 ? "rgba(0,64,82,.9)" : "rgba(107,31,128,.7)";
      pool(g, r() * PW, r() * PH * 0.5, 120 + r() * 260, 80 + r() * 160, col);
    }
    const st = rng(42);
    for (let i = 0; i < 900; i++) {
      const b = st() ** 3;
      g.fillStyle = `rgba(255,255,255,${0.25 + 0.75 * b})`;
      g.fillRect(Math.floor(st() * PW), Math.floor(st() * py(0.5)), 1.5, 1.5);
    }
    // bridge window frame: header, mullions, sill with a cyan line
    const metal = "#1c222c";
    rect(g, -0.2, -0.2, 1.2, 0.05, metal);
    for (const mx of [-0.02, 0.24, 0.5, 0.76, 1.02]) rect(g, mx - 0.018, 0.05, mx + 0.018, 0.5, metal);
    rect(g, -0.2, 0.5, 1.2, HORIZON, "#12161d");
    rect(g, -0.2, 0.5, 1.2, 0.506, "rgba(77,217,255,.85)");
    pool(g, px(-0.05), py(0.35), 0.3 * W, 0.4 * H, hexA(rims[0], 0.35));
    pool(g, px(1.05), py(0.35), 0.3 * W, 0.4 * H, hexA(rims[1], 0.35));
    floor(g, c, "#121821", "#06080b", 0.25, "tiles", "rgba(77,200,240,.18)");
  } else {
    v("#1d2026", "#0c0d10");
    for (let i = 0; i < 40; i++) { // slat wall
      g.fillStyle = `rgba(0,0,0,${i % 2 ? 0.16 : 0.04})`;
      g.fillRect(px(-0.15) + i * 0.035 * W, 0, 0.035 * W, py(HORIZON));
    }
    // central screen with a gradient in the two rim colours
    rect(g, 0.29, 0.07, 0.71, 0.47, "#0a0b0e");
    rect(g, 0.3, 0.085, 0.7, 0.455, "#0c0e12");
    g.save();
    g.beginPath();
    g.rect(px(0.3), py(0.085), 0.4 * W, 0.37 * H);
    g.clip();
    pool(g, px(0.3), py(0.27), 0.3 * W, 0.3 * H, hexA(rims[0], 0.32));
    pool(g, px(0.7), py(0.27), 0.3 * W, 0.3 * H, hexA(rims[1], 0.32));
    g.restore();
    // practical light strips that motivate the rim lights (warm left, cool right)
    for (const [fx, col] of [[0.045, rims[0]], [0.955, rims[1]]] as [number, string][]) {
      pool(g, px(fx), py(0.32), 0.12 * W, 0.4 * H, hexA(col, 0.45));
      rect(g, fx - 0.005, 0.04, fx + 0.005, HORIZON - 0.01, col);
    }
    rect(g, -0.2, HORIZON - 0.012, 1.2, HORIZON, "#050506"); // skirting
    floor(g, c, "#15161a", "#060607", 0.45, "seams", "rgba(255,255,255,.03)");
  }
  places.forEach((x) => pool(g, px(x), py(0.62), 0.16 * W, 0.12 * H, "rgba(255,240,220,.06)"));
  return softBlur(c, 2.2); // depth of field
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function mid(s: Scenario, template: SceneTemplate) {
  const c = canvas(PW, PH);
  const g = ctx2d(c);
  const r = rng({ studio: 1, classroom: 2, arena: 3, space: 4 }[s] ?? 1);
  if (s === "classroom") {
    if (template !== "lesson") {
      rect(g, 0.35, 0.1, 0.65, 0.44, "#52361f");
      rect(g, 0.36, 0.115, 0.64, 0.425, "#1b3128");
      rect(g, 0.37, 0.425, 0.63, 0.44, "#6b4a2e");
    }
    g.fillStyle = "rgba(255,244,220,.07)"; // sun shaft from the window
    g.beginPath();
    g.moveTo(px(0.0), py(0.1));
    g.lineTo(px(0.18), py(0.1));
    g.lineTo(px(0.42), py(0.95));
    g.lineTo(px(0.12), py(0.95));
    g.fill();
    return softBlur(c, 2);
  }
  if (s === "arena") {
    for (const fx of [0.2, 0.5, 0.8]) {
      const grad = g.createLinearGradient(0, py(-0.05), 0, py(0.95));
      grad.addColorStop(0, "rgba(255,236,220,.22)");
      grad.addColorStop(1, "rgba(255,236,220,.03)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(px(fx) - 18, py(-0.05));
      g.lineTo(px(fx) + 18, py(-0.05));
      g.lineTo(px(fx) + 230, py(0.95));
      g.lineTo(px(fx) - 230, py(0.95));
      g.fill();
    }
    const blurred = softBlur(c, 8);
    const out = ctx2d(blurred);
    out.fillStyle = "#16141c"; // truss with fixtures
    out.fillRect(0, py(-0.06), PW, 14);
    for (const fx of [0.2, 0.5, 0.8]) {
      out.fillStyle = "#2a2833";
      out.fillRect(px(fx) - 16, py(-0.06), 32, 26);
    }
    const hy = py(HORIZON - 0.07);
    for (let row = 0; row < 2; row++) { // crowd above the LED board
      out.fillStyle = row ? "rgba(10,8,14,.95)" : "rgba(22,18,30,.9)";
      for (let i = 0; i < 70; i++) {
        const cx = (i + (r() - 0.5) * 0.6 + row * 0.5) * (PW / 69);
        const rad = 11 + r() * 6;
        const top = hy - 16 - row * 30 - r() * 10;
        out.beginPath();
        out.arc(cx, top, rad, 0, 7);
        out.fill();
        out.beginPath();
        out.roundRect(cx - rad * 1.5, top + rad * 0.6, rad * 3, hy - top - rad * 0.6, 10);
        out.fill();
      }
    }
    return softBlur(blurred, 1.6);
  }
  if (s === "space") {
    const cx = px(0.86), cy = py(0.2), rad = 0.11 * W;
    const grad = g.createRadialGradient(cx - rad * 0.45, cy - rad * 0.4, rad * 0.1, cx, cy, rad);
    grad.addColorStop(0, "#a397c4");
    grad.addColorStop(0.6, "#4a4266");
    grad.addColorStop(1, "#0b0a14");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, rad, 0, 7);
    g.fill();
    return softBlur(c, 1.5);
  }
  const rims = RIM.studio;
  pool(g, px(0.05), py(0.3), 0.2 * W, 0.45 * H, hexA(rims[0], 0.12)); // haze from the practicals
  pool(g, px(0.95), py(0.3), 0.2 * W, 0.45 * H, hexA(rims[1], 0.12));
  for (let i = 0; i < 14; i++) { // a few bokeh high up
    const cx = r() * PW, cy = py(0.0) + r() * 0.12 * H, rad = 8 + r() * 14;
    g.fillStyle = r() < 0.6 ? `rgba(255,196,120,${(20 + r() * 40) / 255})` : `rgba(120,210,255,${(20 + r() * 40) / 255})`;
    g.beginPath();
    g.arc(cx, cy, rad, 0, 7);
    g.fill();
  }
  return softBlur(c, 3);
}

const plateCache = new Map<string, { far: HTMLCanvasElement; mid: HTMLCanvasElement }>();
export function plates(s: Scenario, template: SceneTemplate) {
  const key = `${s}:${template}`;
  let p = plateCache.get(key);
  if (!p) {
    p = { far: far(s, PLACES[template].map((x) => x[0])), mid: mid(s, template) };
    plateCache.set(key, p);
  }
  return p;
}

/** One rig layer with rim light (outer edge), key-side shading and bottom falloff baked in.
 *  `box` is the layer's box in its view canvas (`cw` x `ch`), so ramps match across layers. */
const litCache = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>();
export function litLayer(im: HTMLImageElement, box: { x: number; y: number; w: number; h: number }, cw: number, ch: number, light: Light, rim: boolean) {
  const key = `${box.x},${box.y},${box.w},${box.h},${cw},${ch},${light.side},${light.rim},${light.ambient},${rim}`;
  let m = litCache.get(im);
  if (!m) litCache.set(im, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const w = im.naturalWidth, h = im.naturalHeight;
  const sx = w / box.w, sy = h / box.h;
  const c = canvas(w, h);
  const g = ctx2d(c);
  g.drawImage(im, 0, 0);
  g.globalCompositeOperation = "source-atop";
  // key side brighter, far side darker (ramp in view-canvas x)
  const kx = g.createLinearGradient((0 - box.x) * sx, 0, (cw - box.x) * sx, 0);
  const dark = "rgba(0,0,0,.2)", clear = "rgba(0,0,0,0)";
  kx.addColorStop(0, light.side > 0 ? clear : dark);
  kx.addColorStop(1, light.side > 0 ? dark : clear);
  g.fillStyle = kx;
  g.fillRect(0, 0, w, h);
  const fy = g.createLinearGradient(0, (ch * 0.62 - box.y) * sy, 0, (ch * 0.92 - box.y) * sy); // occlusion toward the lectern
  fy.addColorStop(0, clear);
  fy.addColorStop(1, "rgba(0,0,0,.45)");
  g.fillStyle = fy;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "multiply"; // set ambient
  g.fillStyle = light.ambient;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "destination-in"; // multiply also painted the transparent area
  g.drawImage(im, 0, 0);
  g.globalCompositeOperation = "source-atop";
  if (rim) {
    const d = Math.max(2, Math.round(Math.min(w, h) * 0.014));
    const r = canvas(w, h);
    const rg = ctx2d(r);
    rg.drawImage(im, 0, 0);
    rg.globalCompositeOperation = "source-in";
    rg.fillStyle = light.rim;
    rg.fillRect(0, 0, w, h);
    rg.globalCompositeOperation = "destination-out"; // keep only the edge facing the light (up and outward)
    rg.drawImage(im, -light.side * d, d);
    g.globalCompositeOperation = "screen";
    g.globalAlpha = 0.75;
    g.drawImage(softBlur(r, 1.6), 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "destination-in";
    g.drawImage(im, 0, 0);
  }
  m.set(key, c);
  return c;
}

// ------------------------------------------------------------------ set pieces on the stage
/** lectern finish per scenario: body, top, accent strip ("rim" = the character's rim colour) */
const LECTERN: Record<Scenario, [string, string, string | null]> = {
  studio: ["#13151a", "#33363b", "rim"],
  classroom: ["#5c381f", "#805430", null],
  arena: ["#0a090d", "#242129", "rim"],
  space: ["#29303b", "#4d5966", "#4dd9ff"],
};

const lecternCache = new Map<string, HTMLCanvasElement>();
/** Front-on lectern: top slab, tapered body, key-side shading, outer rim edge in the rim colour. */
export function lectern(s: Scenario, light: Light) {
  const key = `${s}:${light.side}:${light.rim}`;
  const hit = lecternCache.get(key);
  if (hit) return hit;
  const w = Math.round(W * LECTERN_W), h = Math.round(H * (LECTERN_BASE - LECTERN_TOP));
  const c = canvas(w, h);
  const g = ctx2d(c);
  const [body, top, strip] = LECTERN[s] ?? LECTERN.studio;
  const slab = Math.round(h * 0.075);
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(w * 0.035, slab);
  g.lineTo(w * 0.965, slab);
  g.lineTo(w * 0.915, h);
  g.lineTo(w * 0.085, h);
  g.fill();
  g.globalCompositeOperation = "source-atop";
  const kx = g.createLinearGradient(0, 0, w, 0); // key side brighter
  kx.addColorStop(light.side > 0 ? 0 : 1, "rgba(255,255,255,.12)");
  kx.addColorStop(light.side > 0 ? 1 : 0, "rgba(0,0,0,.25)");
  g.fillStyle = kx;
  g.fillRect(0, 0, w, h);
  const dy = g.createLinearGradient(0, slab, 0, h); // darker toward the floor
  dy.addColorStop(0, "rgba(0,0,0,0)");
  dy.addColorStop(1, "rgba(0,0,0,.45)");
  g.fillStyle = dy;
  g.fillRect(0, 0, w, h);
  if (s === "classroom") {
    g.strokeStyle = "rgba(0,0,0,.18)";
    g.lineWidth = 3;
    g.strokeRect(w * 0.14, h * 0.25, w * 0.72, h * 0.6);
  }
  if (strip) {
    const sc = strip === "rim" ? light.rim : strip;
    g.fillStyle = sc;
    g.shadowColor = sc;
    g.shadowBlur = 14;
    g.fillRect(w * 0.08, h * 0.2 - 2, w * 0.84, 4);
    g.shadowBlur = 0;
  }
  g.globalCompositeOperation = "source-over";
  g.fillStyle = top;
  g.fillRect(0, 0, w, slab);
  g.fillStyle = "rgba(255,255,255,.12)";
  g.fillRect(0, slab - 2, w, 2);
  // rim on the outer edge
  const rx = light.side > 0 ? w * 0.93 : w * 0.035;
  g.fillStyle = hexA(light.rim, 0.5);
  g.fillRect(light.side > 0 ? w - 4 : 0, 0, 4, slab);
  g.globalAlpha = 0.45;
  g.fillRect(rx, slab, w * 0.035, h - slab);
  g.globalAlpha = 1;
  lecternCache.set(key, c);
  return c;
}

let shadowCanvas: HTMLCanvasElement | null = null;
/** Soft dark ellipse where a lectern meets the floor. */
export function contactShadow() {
  if (shadowCanvas) return shadowCanvas;
  const w = Math.round(W * LECTERN_W * 1.35), h = Math.round(H * 0.06);
  const c = canvas(w, h);
  const g = ctx2d(c);
  g.translate(w / 2, h / 2);
  g.scale(1, h / w);
  const r = g.createRadialGradient(0, 0, 0, 0, 0, w / 2);
  r.addColorStop(0, "rgba(0,0,0,.75)");
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r;
  g.fillRect(-w / 2, -w / 2, w, w);
  return (shadowCanvas = c);
}

/** Out-of-focus copy (the listener in a single, the board behind the teacher). */
const softCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
export const blurNow = (c: HTMLCanvasElement) => softBlur(softBlur(c, 3), 2);
export function soft(c: HTMLCanvasElement) {
  let o = softCache.get(c);
  if (!o) softCache.set(c, (o = softBlur(softBlur(c, 3), 2)));
  return o;
}

let vigCache: HTMLCanvasElement | null = null;
export function vignette() {
  if (vigCache) return vigCache;
  const c = canvas(W, H);
  const g = ctx2d(c);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, W, H);
  g.translate(W / 2, H / 2);
  g.scale(1, H / W);
  const r = g.createRadialGradient(0, 0, W * 0.32, 0, 0, W * 0.72);
  r.addColorStop(0, "rgba(0,0,0,0)");
  r.addColorStop(1, "rgba(0,0,0,.55)");
  g.fillStyle = r;
  g.fillRect(-W, -W, 2 * W, 2 * W);
  return (vigCache = c);
}

export function grade(g: CanvasRenderingContext2D, s: Scenario) {
  const [tint, a] = GRADE[s] ?? GRADE.studio;
  g.save();
  g.globalCompositeOperation = "soft-light";
  g.globalAlpha = a;
  g.fillStyle = tint;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.globalAlpha = 0.18; // S-curve-ish contrast
  g.globalCompositeOperation = "overlay";
  g.fillStyle = "#808080";
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "multiply";
  g.drawImage(vignette(), 0, 0, g.canvas.width, g.canvas.height);
  g.restore();
}

// ------------------------------------------------------------------ camera
export type ShotKind = "wide" | "two" | "ots" | "cu" | "mcu" | "board" | "single" | "react";
export interface Shot { cx: number; cy: number; zoom: number; kind?: ShotKind }

export function handheld(t: number): [number, number, number] {
  return [
    3.2 * Math.sin(0.53 * t) + 1.4 * Math.sin(1.31 * t + 1),
    2.2 * Math.sin(0.71 * t + 2) + 0.9 * Math.sin(1.87 * t),
    ((0.14 * Math.PI) / 180) * Math.sin(0.41 * t + 0.5),
  ];
}

export const ease = (x: number) => {
  const v = Math.min(1, Math.max(0, x));
  return v * v * (3 - 2 * v);
};

function clampShot(s: Shot, win = W): Shot {
  const z = Math.max(1.04, s.zoom);
  const hw = win / (2 * z) + 8, hh = H / (2 * z) + 8;
  return { cx: Math.min(Math.max(s.cx, hw), W - hw), cy: Math.min(Math.max(s.cy, hh), H - hh), zoom: z, kind: s.kind };
}

/** Shot grammar per line, as in scene.py: wide establishing shot, over-the-shoulder singles, a
 *  close-up cutaway on every real quote and a closing two-shot; the lesson cuts to the board for quotes. */
export function shotFor(template: SceneTemplate, speaker: number, i: number, script: ScriptLine[] = [], vertical = false): Shot {
  const quote = script[i]?.kind === "quote";
  const last = i === script.length - 1 && script.length >= 4;
  if (speaker < 0) return { cx: W / 2, cy: H * 0.5, zoom: 1, kind: "wide" };
  const places = PLACES[template] ?? PLACES.solo;
  const x = places[Math.min(speaker, places.length - 1)][0];
  const toward = x < 0.5 ? 1 : -1;
  if (vertical) { // singles only: the window is too narrow for a two-shot
    if (quote) return { cx: W * (x + 0.01 * toward), cy: H * FACE_Y, zoom: 1.75, kind: "cu" };
    return { cx: W * (x + 0.02 * toward), cy: H * 0.5, zoom: 1.22, kind: "single" };
  }
  if (template === "debate") {
    if (last) return { cx: W / 2, cy: H * 0.47, zoom: 1.24, kind: "two" };
    if (quote) return { cx: W * (x + 0.035 * toward), cy: H * FACE_Y, zoom: 2.1, kind: "cu" };
    return { cx: W * (x + 0.115 * toward), cy: H * 0.47, zoom: 1.6, kind: "ots" };
  }
  if (template === "lesson") {
    const [bx0, by0, bx1, by1] = BOARD;
    if (quote) return { cx: (W * (bx0 + bx1)) / 2, cy: (H * (by0 + by1)) / 2 + H * 0.03, zoom: 1.72, kind: "board" };
    if (last) return { cx: W / 2, cy: H * 0.5, zoom: 1, kind: "wide" };
    return { cx: W * (x + 0.13), cy: H * 0.47, zoom: 1.55, kind: "mcu" };
  }
  if (quote) return { cx: W / 2, cy: H * FACE_Y, zoom: 2, kind: "cu" };
  return last ? { cx: W / 2, cy: H * 0.5, zoom: 1, kind: "wide" } : { cx: W / 2, cy: H * 0.47, zoom: 1.5, kind: "mcu" };
}

export type Cut = { start: number; shot: Shot; kind: "cut" | "dissolve" | "whip" };
const same = (a: Shot, b: Shot) => a.cx === b.cx && a.cy === b.cy && a.zoom === b.zoom && a.kind === b.kind;

/** Opens wide, then cuts to the first speaker; hard cuts between singles, a dissolve into
 *  wide/two/board shots and a whip pan when a quote close-up answers the other side. */
export function planShots(template: SceneTemplate, script: ScriptLine[], vertical = false): Cut[] {
  if (vertical) return planVertical(template, script);
  const cuts: Cut[] = [{ start: 0, shot: clampShot(shotFor(template, -1, 0, script)), kind: "cut" }];
  script.forEach((l, i) => {
    let start = l.startMs / 1000;
    if (i === 0) start = Math.min(start + 1.6, Math.max(start, l.endMs / 1000 - 1));
    const shot = clampShot(shotFor(template, l.speaker, i, script));
    const prev = cuts[cuts.length - 1];
    if (same(shot, prev.shot)) return;
    const kind = ["wide", "two", "board"].includes(shot.kind ?? "") || ["wide", "board"].includes(prev.shot.kind ?? "")
      ? "dissolve" : shot.kind === "cu" && Math.abs(shot.cx - prev.shot.cx) > W * 0.25 ? "whip" : "cut";
    cuts.push({ start: Math.max(start - 0.12, prev.start + 0.5), shot, kind });
  });
  return cuts;
}

/** 9:16 shot/countershot (mirrors Scene._plan_vertical): open on the first speaker, hard cuts, and a
 *  1.3 s reaction cutaway to the listener on long debate lines. */
function planVertical(template: SceneTemplate, script: ScriptLine[]): Cut[] {
  const c = (s: Shot) => clampShot(s, VWIN);
  const first = script[0]?.speaker ?? 0;
  const cuts: Cut[] = [{ start: 0, shot: c(shotFor(template, Math.max(0, first), 0, script, true)), kind: "cut" }];
  script.forEach((l, i) => {
    const start = l.startMs / 1000, end = l.endMs / 1000;
    const shot = c(shotFor(template, l.speaker, i, script, true));
    const prev = cuts[cuts.length - 1];
    if (!same(shot, prev.shot)) cuts.push({ start: Math.max(start - 0.1, prev.start + 0.5), shot, kind: "cut" });
    if (template === "debate" && end - start > 5.5) {
      const mid = start + (end - start) * 0.55;
      cuts.push({ start: mid, shot: c({ ...shotFor(template, 1 - l.speaker, i, script, true), kind: "react" }), kind: "cut" });
      cuts.push({ start: mid + 1.3, shot, kind: "cut" });
    }
  });
  return cuts;
}

/** [(weight, shot, motion blur 0..1)] at time t; two entries during a dissolve. */
export function camera(cuts: Cut[], t: number): [number, Shot, number][] {
  let k = 0;
  cuts.forEach((c, i) => { if (c.start <= t) k = i; });
  const pushed = (s: Shot, since: number): Shot => ({ ...s, zoom: s.zoom * (1 + 0.045 * Math.min(1, since / 7)) });
  const { start, shot, kind } = cuts[k];
  const local = t - start;
  const cur = pushed(shot, local);
  if (k === 0) return [[1, cur, 0]];
  const prev = cuts[k - 1];
  const before = pushed(prev.shot, start - prev.start);
  if (kind === "dissolve" && local < DISSOLVE_S) {
    const a = ease(local / DISSOLVE_S);
    return [[1 - a, { ...before, zoom: before.zoom * (1 + 0.01 * a) }, 0], [a, cur, 0]];
  }
  if (kind === "whip" && local < WHIP_S) {
    const u = local / WHIP_S, a = ease(u);
    const s = { cx: before.cx + (cur.cx - before.cx) * a, cy: before.cy + (cur.cy - before.cy) * a, zoom: before.zoom + (cur.zoom - before.zoom) * a, kind: cur.kind };
    return [[1, s, Math.sin(Math.PI * u)]];
  }
  return [[1, cur, 0]];
}

/** Canvas transform for a parallax depth: maps that depth's own pixels to the frame. */
export function depthTransform(g: CanvasRenderingContext2D, s: Shot, depth: keyof typeof PARALLAX, drift: [number, number, number], vertical = false) {
  const p = PARALLAX[depth];
  const z = 1 + (s.zoom - 1) * p;
  const plate = depth !== "stage";
  const cx = (plate ? W / 2 + (s.cx - W / 2) * p : s.cx) + (plate ? OX : 0);
  const cy = (plate ? H / 2 + (s.cy - H / 2) * p : s.cy) + (plate ? OY : 0);
  const [dx, dy, roll] = drift.map((v) => v * p);
  const a = z * Math.cos(roll), b = z * Math.sin(roll), c = -b, d = a;
  const e = W / 2 + dx - a * cx - c * cy, f = H / 2 + dy - b * cx - d * cy;
  if (!vertical) return g.setTransform(a, b, c, d, e, f);
  // frame px of a centred VWIN-wide window -> VW x VH output
  const k = VH / H, ox = (W - VWIN) / 2;
  g.setTransform(a * k, b * k, c * k, d * k, (e - ox) * k, f * k);
}
