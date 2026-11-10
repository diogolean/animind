import type { Raster } from "./png-rgba";

/**
 * Removes a flat background that touches the border.
 * Returns null when the border is not that color, or when the flood reaches the center.
 * The Einstein charge room fails this proof: the shelves are not the wall color and the suit matches it.
 * Callers then keep the painted plate. The file is never rewritten.
 */
export function sceneryMatte(raster: Raster): Raster | null {
  if (raster.width < 8 || raster.height < 8) return null;
  const corner = [raster.data[0], raster.data[1], raster.data[2]];
  if (raster.data[3] < 32) return null;
  const seen = new Uint8Array(raster.width * raster.height);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return;
    const at = y * raster.width + x;
    if (seen[at]) return;
    const i = at * 4;
    if (raster.data[i + 3] < 32) return;
    const distance = Math.abs(raster.data[i] - corner[0]) + Math.abs(raster.data[i + 1] - corner[1]) + Math.abs(raster.data[i + 2] - corner[2]);
    if (distance > 40) return;
    seen[at] = 1;
    stack.push(at);
  };
  for (let x = 0; x < raster.width; x += 1) {
    push(x, 0);
    push(x, raster.height - 1);
  }
  for (let y = 0; y < raster.height; y += 1) {
    push(0, y);
    push(raster.width - 1, y);
  }
  while (stack.length) {
    const at = stack.pop()!;
    const x = at % raster.width;
    const y = Math.floor(at / raster.width);
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  const corners = [0, raster.width - 1, (raster.height - 1) * raster.width, raster.height * raster.width - 1];
  if (corners.some((at) => !seen[at])) return null;
  let border = 0;
  let borderCleared = 0;
  const band = Math.max(2, Math.round(Math.min(raster.width, raster.height) * 0.04));
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (x >= band && y >= band && x < raster.width - band && y < raster.height - band) continue;
      border += 1;
      if (seen[y * raster.width + x]) borderCleared += 1;
    }
  }
  if (borderCleared / border < 0.85) return null;
  const x0 = Math.round(raster.width * 0.35);
  const x1 = Math.round(raster.width * 0.65);
  const y0 = Math.round(raster.height * 0.35);
  const y1 = Math.round(raster.height * 0.65);
  let center = 0;
  let centerCleared = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      center += 1;
      if (seen[y * raster.width + x]) centerCleared += 1;
    }
  }
  if (center === 0 || centerCleared / center > 0.02) return null;
  const out: Raster = { width: raster.width, height: raster.height, data: new Uint8ClampedArray(raster.data) };
  for (let at = 0; at < seen.length; at += 1) if (seen[at]) out.data[at * 4 + 3] = 0;
  return out;
}
