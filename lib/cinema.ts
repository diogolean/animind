"use client";
/* Cinematic look for the browser preview, mirroring the core's
 * products/animind_core/look.py: parallax scenario plates with depth-of-field
 * blur, rim/key light and soft drop shadows on the rig layers, a camera that
 * pushes in, drifts and reframes on the speaker (cross-dissolve / whip pan),
 * a colour grade and a vignette. Plates and lit layers are built once and
 * cached; every per-frame value is a pure function of time (deterministic). */
import type { Scenario, SceneTemplate, ScriptLine } from "./contract";

export const W = 1280;
export const H = 720;
const MARGIN = 1.3;
const PW = Math.round(W * MARGIN), PH = Math.round(H * MARGIN);
const OX = (PW - W) / 2, OY = (PH - H) / 2;
const HORIZON = 0.8;
export const PARALLAX = { far: 0.35, mid: 0.65, stage: 1 } as const;
export const DISSOLVE_S = 0.45, WHIP_S = 0.3, FADE_IN_S = 0.5, FADE_OUT_S = 0.6;

/** (x centre as a fraction of W, scale on top of "fit to 92% of the height") */
export const PLACES: Record<SceneTemplate, [number, number][]> = {
  debate: [[0.27, 0.85], [0.73, 0.85]],
  lesson: [[0.25, 0.9]],
  solo: [[0.5, 0.95]],
};
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

export interface Light { side: number; rim: string }

export function lightFor(scenario: Scenario, template: SceneTemplate, idx: number): Light {
  const px = PLACES[template][Math.min(idx, PLACES[template].length - 1)][0];
  const side = template === "solo" ? 1 : px < 0.5 ? -1 : 1;
  const rims = RIM[scenario] ?? RIM.studio;
  return { side, rim: rims[Math.min(idx, rims.length - 1)] };
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

function floor(g: CanvasRenderingContext2D, c: HTMLCanvasElement, top: string, bottom: string, reflect: number) {
  const hy = py(HORIZON);
  const n = PH - hy;
  const grad = g.createLinearGradient(0, hy, 0, PH);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, hy, PW, n);
  // mirrored wall, fading out
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
  g.fillStyle = "rgba(255,255,255,.035)";
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
  if (s === "classroom") {
    v("#4d4133", "#29211a");
    g.fillStyle = "#8c9eb3";
    for (const wx of [0.04, 0.96]) g.fillRect(px(wx) - 0.07 * W, py(0.06), 0.14 * W, 0.6 * H);
    places.forEach((x) => pool(g, px(x), py(0.42), 0.22 * W, 0.4 * H, "rgba(36,28,18,1)"));
    floor(g, c, "#33221a", "#1c130c", 0.12);
    g.fillStyle = "rgba(0,0,0,.08)";
    for (let x = 0; x < PW; x += 57) g.fillRect(x, py(HORIZON), 2, PH);
  } else if (s === "arena") {
    v("#090611", "#07050b");
    pool(g, px(0.1), py(0.35), 0.45 * W, 0.6 * H, "rgba(115,10,23,1)");
    pool(g, px(0.9), py(0.35), 0.45 * W, 0.6 * H, "rgba(10,31,122,1)");
    g.fillStyle = "rgba(255,255,255,.025)";
    for (let x = 0; x < PW; x += 46) g.fillRect(x, 0, 2, py(HORIZON));
    for (let y = 0; y < py(HORIZON); y += 46) g.fillRect(0, y, PW, 2);
    floor(g, c, "#08060a", "#050406", 0.35);
  } else if (s === "space") {
    v("#02030a", "#03040d");
    const r = rng(7);
    for (let i = 0; i < 14; i++) {
      const col = i % 3 === 0 ? "rgba(0,64,82,.9)" : "rgba(107,31,128,.7)";
      pool(g, r() * PW, r() * PH * 0.8, 120 + r() * 260, 80 + r() * 200, col);
    }
    const st = rng(42);
    for (let i = 0; i < 900; i++) {
      const b = st() ** 3;
      g.fillStyle = `rgba(255,255,255,${0.25 + 0.75 * b})`;
      g.fillRect(Math.floor(st() * PW), Math.floor(st() * PH), 1, 1);
    }
    floor(g, c, "#080a0f", "#040507", 0.25);
    g.fillStyle = "rgba(26,115,153,.9)";
    g.fillRect(0, py(HORIZON) - 1, PW, 4);
  } else {
    v("#1a1d21", "#0a0b0d");
    pool(g, px(0.5), py(0.38), 0.6 * W, 0.45 * H, "rgba(13,26,31,1)");
    for (let i = 0; i < 16; i++) {
      g.fillStyle = `rgba(0,0,0,${0.05 + 0.05 * Math.cos(i * Math.PI)})`;
      g.fillRect(px(0) + i * 0.0625 * W - W * 0.3, 0, 0.0625 * W, PH);
    }
    places.forEach((x) => pool(g, px(x), py(0.45), 0.2 * W, 0.42 * H, "rgba(51,41,31,1)"));
    floor(g, c, "#0d0d0e", "#060607", 0.3);
  }
  return softBlur(c, 6); // depth of field
}

function mid(s: Scenario, template: SceneTemplate) {
  const c = canvas(PW, PH);
  const g = ctx2d(c);
  const r = rng({ studio: 1, classroom: 2, arena: 3, space: 4 }[s] ?? 1);
  if (s === "classroom") {
    if (template !== "lesson") {
      g.fillStyle = "#462e1c";
      g.beginPath();
      g.roundRect(px(0.33), py(0.13), 0.34 * W, 0.47 * H, 10);
      g.fill();
      g.fillStyle = "#182c24";
      g.beginPath();
      g.roundRect(px(0.33) + 12, py(0.13) + 12, 0.34 * W - 24, 0.47 * H - 24, 6);
      g.fill();
    }
    g.fillStyle = "rgba(255,244,220,.08)";
    for (const [wx, k] of [[0.04, 1], [0.96, -1]]) {
      g.beginPath();
      g.moveTo(px(wx) - 60, py(0.06));
      g.lineTo(px(wx) + 60, py(0.06));
      g.lineTo(px(wx + k * 0.38), py(1));
      g.lineTo(px(wx + k * 0.2), py(1));
      g.fill();
    }
    return softBlur(c, 2);
  }
  if (s === "arena") {
    for (const fx of [0.2, 0.5, 0.8]) {
      const grad = g.createLinearGradient(0, py(-0.05), 0, py(HORIZON));
      grad.addColorStop(0, "rgba(255,236,220,.2)");
      grad.addColorStop(1, "rgba(255,236,220,.05)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(px(fx) - 18, py(-0.05));
      g.lineTo(px(fx) + 18, py(-0.05));
      g.lineTo(px(fx) + 230, py(HORIZON));
      g.lineTo(px(fx) - 230, py(HORIZON));
      g.fill();
    }
    const blurred = softBlur(c, 8);
    const out = ctx2d(blurred);
    out.fillStyle = "rgba(6,5,9,.92)";
    const hy = py(HORIZON);
    for (let i = 0; i < 70; i++) {
      const cx = (i + (r() - 0.5) * 0.6) * (PW / 69);
      const rad = 15 + r() * 9;
      const top = hy - 20 - r() * 26;
      out.beginPath();
      out.arc(cx, top, rad, 0, 7);
      out.fill();
      out.beginPath();
      out.roundRect(cx - rad * 1.6, top + rad * 0.6, rad * 3.2, hy + 30 - top - rad * 0.6, 14);
      out.fill();
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
    for (let i = 0; i < 30; i++) {
      const s2 = 1.5 + r() * 1.7;
      g.fillStyle = "rgba(220,235,255,.9)";
      g.beginPath();
      g.arc(r() * PW, r() * py(HORIZON), s2, 0, 7);
      g.fill();
    }
    return softBlur(c, 1.5);
  }
  for (let i = 0; i < 34; i++) { // studio bokeh
    const cx = r() * PW, cy = py(0.02) + r() * 0.6 * H, rad = 10 + r() * 24;
    const warm = r() < 0.6;
    g.fillStyle = warm ? `rgba(255,196,120,${(22 + r() * 48) / 255})` : `rgba(120,210,255,${(22 + r() * 48) / 255})`;
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
  const key = `${box.x},${box.y},${box.w},${box.h},${cw},${ch},${light.side},${light.rim},${rim}`;
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
  const fy = g.createLinearGradient(0, (ch * 0.72 - box.y) * sy, 0, (ch - box.y) * sy);
  fy.addColorStop(0, clear);
  fy.addColorStop(1, "rgba(0,0,0,.55)");
  g.fillStyle = fy;
  g.fillRect(0, 0, w, h);
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

/** Soft black silhouette of the given layers, in view-canvas space (scaled by `k`). */
const shadowCache = new Map<string, HTMLCanvasElement>();
export function dropShadow(key: string, parts: { im: HTMLImageElement; x: number; y: number; w: number; h: number }[], cw: number, ch: number) {
  let c = shadowCache.get(key);
  if (c) return c;
  const k = 0.25;
  const small = canvas(cw * k, ch * k);
  const g = ctx2d(small);
  parts.forEach((p) => g.drawImage(p.im, p.x * k, p.y * k, p.w * k, p.h * k));
  g.globalCompositeOperation = "source-in";
  g.fillStyle = "rgba(0,0,0,.55)";
  g.fillRect(0, 0, small.width, small.height);
  c = softBlur(softBlur(small, 3), 2);
  shadowCache.set(key, c);
  return c;
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
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.18; // S-curve-ish contrast
  g.globalCompositeOperation = "overlay";
  g.fillStyle = "#808080";
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "multiply";
  g.drawImage(vignette(), 0, 0);
  g.restore();
}

// ------------------------------------------------------------------ camera
export interface Shot { cx: number; cy: number; zoom: number }

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

function clampShot(s: Shot): Shot {
  const z = Math.max(1.04, s.zoom);
  const hw = W / (2 * z) + 8, hh = H / (2 * z) + 8;
  return { cx: Math.min(Math.max(s.cx, hw), W - hw), cy: Math.min(Math.max(s.cy, hh), H - hh), zoom: z };
}

export function shotFor(template: SceneTemplate, speaker: number, i: number): Shot {
  if (template === "debate") {
    if (speaker < 0) return { cx: W / 2, cy: H * 0.5, zoom: 1.06 };
    const x = PLACES.debate[Math.min(speaker, 1)][0];
    return { cx: W * (x + (x < 0.5 ? 0.07 : -0.07)), cy: H * 0.55, zoom: 1.42 };
  }
  if (template === "lesson") return speaker < 0 || i % 2 === 0 ? { cx: W / 2, cy: H * 0.5, zoom: 1.05 } : { cx: W / 2, cy: H * 0.44, zoom: 1.16 };
  return speaker < 0 || i % 2 === 0 ? { cx: W / 2, cy: H * 0.5, zoom: 1.08 } : { cx: W / 2, cy: H * 0.5, zoom: 1.34 };
}

export type Cut = { start: number; shot: Shot; kind: "cut" | "dissolve" | "whip" };
const same = (a: Shot, b: Shot) => a.cx === b.cx && a.cy === b.cy && a.zoom === b.zoom;

export function planShots(template: SceneTemplate, script: ScriptLine[]): Cut[] {
  const cuts: Cut[] = [{ start: 0, shot: clampShot(shotFor(template, -1, 0)), kind: "cut" }];
  const kinds = ["dissolve", "whip"] as const;
  script.forEach((l, i) => {
    let start = l.startMs / 1000;
    if (i === 0) {
      if (template !== "debate") return;
      start = Math.min(start + 1.4, Math.max(start, l.endMs / 1000 - 1));
    }
    const shot = clampShot(shotFor(template, l.speaker, i));
    const last = cuts[cuts.length - 1];
    if (!same(shot, last.shot)) cuts.push({ start: Math.max(start - 0.12, last.start + 0.5), shot, kind: kinds[cuts.length % 2] });
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
    const s = { cx: before.cx + (cur.cx - before.cx) * a, cy: before.cy + (cur.cy - before.cy) * a, zoom: before.zoom + (cur.zoom - before.zoom) * a };
    return [[1, s, Math.sin(Math.PI * u)]];
  }
  return [[1, cur, 0]];
}

/** Canvas transform for a parallax depth: maps that depth's own pixels to the frame. */
export function depthTransform(g: CanvasRenderingContext2D, s: Shot, depth: keyof typeof PARALLAX, drift: [number, number, number]) {
  const p = PARALLAX[depth];
  const z = 1 + (s.zoom - 1) * p;
  const plate = depth !== "stage";
  const cx = (plate ? W / 2 + (s.cx - W / 2) * p : s.cx) + (plate ? OX : 0);
  const cy = (plate ? H / 2 + (s.cy - H / 2) * p : s.cy) + (plate ? OY : 0);
  const [dx, dy, roll] = drift.map((v) => v * p);
  const a = z * Math.cos(roll), b = z * Math.sin(roll), c = -b, d = a;
  g.setTransform(a, b, c, d, W / 2 + dx - a * cx - c * cy, H / 2 + dy - b * cx - d * cy);
}
