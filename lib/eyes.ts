/**
 * Eye motion, mirrored from the core (products/animind_core/eyes.py) so the preview and the MP4
 * move the same way: blinks at random intervals and a gaze vector in [-1, 1] (+x right, +y down).
 * Default target is the other speaker; sometimes the lens (more in front view / close-ups); short wanders.
 */
const SEG_MIN = 0.8, SEG_MAX = 2.4, BLINK_MIN = 2.2, BLINK_MAX = 5.6, SACCADE_S = 0.07;

export function rand(seed: number, n: number): number {
  let x = (Math.imul(seed, 374761393) + Math.imul(n, 668265263)) >>> 0;
  x = Math.imul((x ^ (x >>> 13)) >>> 0, 1274126177) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x & 0xffffff) / 0x1000000;
}

export type Lids = "open" | "half" | "closed";

export function blink(t: number, seed: number): Lids {
  let start = 0.6 + rand(seed, 9999) * 1.5, n = 0;
  while (start <= t) {
    const u = t - start;
    if (u < 0.05 || (u >= 0.16 && u < 0.22)) return "half";
    if (u < 0.16) return "closed";
    n += 1;
    start += BLINK_MIN + rand(seed, n) * (BLINK_MAX - BLINK_MIN);
  }
  return "open";
}

function segment(t: number, seed: number): [number, number] {
  let start = 0, n = 0;
  for (;;) {
    const dur = SEG_MIN + rand(seed + 17, n) * (SEG_MAX - SEG_MIN);
    if (t < start + dur) return [n, start];
    start += dur;
    n += 1;
  }
}

export interface GazeOpts { toward: number; view: string; facing: number; cameraBias: number }

export const cameraTarget = (view: string, facing: number): [number, number] => (view === "front" ? [0, 0] : [-0.45 * facing, 0]);

function target(n: number, seed: number, o: GazeOpts): [number, number] {
  const r = rand(seed + 31, n);
  const cam = Math.min(0.85, (o.view === "front" ? 0.45 : 0.12) + o.cameraBias);
  if (r < cam) return cameraTarget(o.view, o.facing);
  if (r < cam + (1 - cam) * 0.22) {
    const a = rand(seed + 47, n) * Math.PI * 2;
    return [0.6 * Math.cos(a), 0.5 * Math.sin(a)];
  }
  return [0.85 * o.toward, 0.05 + 0.15 * (rand(seed + 53, n) - 0.5)];
}

export function gaze(t: number, seed: number, o: GazeOpts): [number, number] {
  const [n, start] = segment(t, seed);
  let cur = target(n, seed, o);
  if (n > 0 && t - start < SACCADE_S) {
    const prev = target(n - 1, seed, o);
    let a = (t - start) / SACCADE_S;
    a = a * a * (3 - 2 * a);
    cur = [prev[0] + (cur[0] - prev[0]) * a, prev[1] + (cur[1] - prev[1]) * a];
  }
  const jx = rand(seed + 71, n) > 0.5 ? 0.05 * Math.sin(t * 7.1 + seed) : 0;
  return [Math.max(-1, Math.min(1, cur[0] + jx)), Math.max(-1, Math.min(1, cur[1]))];
}
