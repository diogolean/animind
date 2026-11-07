import type { Character, Layer, LayerName } from "./contract";
import type { Raster } from "./png-rgba";

export type GazeDirection = "center" | "left" | "right" | "up" | "down";

export const GAZE_DIRECTIONS: GazeDirection[] = ["center", "left", "right", "up", "down"];

/** +x is viewer-right, +y is down, each axis in [-1, 1]. The head and canvas stay put. */
export function gazeVector(direction: GazeDirection): [number, number] {
  if (direction === "left") return [-1, 0];
  if (direction === "right") return [1, 0];
  if (direction === "up") return [0, -1];
  if (direction === "down") return [0, 1];
  return [0, 0];
}

export interface EyeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type EyeCapability = "separable" | "recovered" | "unavailable";

export interface ViewEyeReport {
  gaze: EyeCapability;
  /** Full deflection in canvas pixels. Omitted when the view cannot move a pupil. */
  travel?: [number, number];
  sockets?: EyeBox[];
  reason?: string;
}

export interface GazeProof {
  ok: boolean;
  reason?: string;
  centroids: Partial<Record<GazeDirection, { x: number; y: number }[]>>;
}

const SEPARABLE: LayerName[] = ["iris", "eye_socket"];
const PLATE: LayerName[] = ["eye_white", "eyes"];

export function separableGaze(layers: { name: string }[]): boolean {
  const names = new Set(layers.map((layer) => layer.name));
  return SEPARABLE.every((name) => names.has(name)) && PLATE.some((name) => names.has(name));
}

function index(raster: Raster, x: number, y: number): number {
  return (y * raster.width + x) * 4;
}

function lum(data: Uint8ClampedArray, i: number): number {
  return data[i] + data[i + 1] + data[i + 2];
}

/** Average of the light, opaque pixels. Used to paint over a pupil that was baked into the sclera. */
export function scleraColor(raster: Raster): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < raster.data.length; i += 4) {
    if (raster.data[i + 3] > 180 && lum(raster.data, i) > 360) {
      r += raster.data[i];
      g += raster.data[i + 1];
      b += raster.data[i + 2];
      n += 1;
    }
  }
  if (!n) return [180, 180, 180];
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

function coverage(socket: Raster, iris: Raster, restX: number, restY: number, dx: number, dy: number): number {
  let inside = 0;
  let total = 0;
  for (let y = 0; y < iris.height; y += 1) {
    for (let x = 0; x < iris.width; x += 1) {
      const alpha = iris.data[index(iris, x, y) + 3];
      if (alpha < 32) continue;
      total += 1;
      const sx = Math.round(restX + x + dx);
      const sy = Math.round(restY + y + dy);
      if (sx < 0 || sy < 0 || sx >= socket.width || sy >= socket.height) continue;
      if (socket.data[index(socket, sx, sy) + 3] > 32) inside += 1;
    }
  }
  return total ? inside / total : 0;
}

/** Largest integer travel that keeps the iris inside the socket. Never invents a shift the mask cannot hold. */
export function fitTravel(socket: Raster, iris: Raster, restX: number, restY: number, desired: [number, number]): [number, number] | null {
  const fit = (axis: 0 | 1): number | null => {
    let travel = Math.max(1, Math.round(desired[axis]));
    while (travel >= 1) {
      const dx = axis === 0 ? travel : 0;
      const dy = axis === 1 ? travel : 0;
      const positive = coverage(socket, iris, restX, restY, dx, dy);
      const negative = coverage(socket, iris, restX, restY, -dx, -dy);
      if (positive >= 0.75 && negative >= 0.75) return travel;
      travel -= 1;
    }
    return null;
  };
  const x = fit(0);
  const y = fit(1);
  if (x == null || y == null) return null;
  return [x, y];
}

function clone(raster: Raster): Raster {
  return { width: raster.width, height: raster.height, data: new Uint8ClampedArray(raster.data) };
}

/**
 * Clears the rest-position iris out of the sclera plate, then redraws the iris at `offset`,
 * clipped to the socket. The plate outside the socket is unchanged.
 */
export function composeSeparable(input: {
  plate: Raster;
  iris: Raster;
  socket: Raster;
  plateOrigin: [number, number];
  irisOrigin: [number, number];
  socketOrigin: [number, number];
  offset: [number, number];
}): Raster {
  const { plate, iris, socket, offset } = input;
  const out = clone(socket);
  const originX = input.plateOrigin[0] - input.socketOrigin[0];
  const originY = input.plateOrigin[1] - input.socketOrigin[1];
  const restX = input.irisOrigin[0] - input.socketOrigin[0];
  const restY = input.irisOrigin[1] - input.socketOrigin[1];
  const fill = scleraColor(plate);
  for (let y = 0; y < socket.height; y += 1) {
    for (let x = 0; x < socket.width; x += 1) {
      const dest = index(out, x, y);
      if (out.data[dest + 3] < 32) {
        out.data[dest + 3] = 0;
        continue;
      }
      const px = x - originX;
      const py = y - originY;
      if (px >= 0 && py >= 0 && px < plate.width && py < plate.height) {
        const source = index(plate, px, py);
        out.data[dest] = plate.data[source];
        out.data[dest + 1] = plate.data[source + 1];
        out.data[dest + 2] = plate.data[source + 2];
      }
    }
  }
  for (let y = 0; y < iris.height; y += 1) {
    for (let x = 0; x < iris.width; x += 1) {
      const source = index(iris, x, y);
      if (iris.data[source + 3] < 32) continue;
      const sx = Math.round(restX + x);
      const sy = Math.round(restY + y);
      if (sx < 0 || sy < 0 || sx >= out.width || sy >= out.height) continue;
      const dest = index(out, sx, sy);
      if (out.data[dest + 3] < 32) continue;
      out.data[dest] = fill[0];
      out.data[dest + 1] = fill[1];
      out.data[dest + 2] = fill[2];
    }
  }
  for (let y = 0; y < iris.height; y += 1) {
    for (let x = 0; x < iris.width; x += 1) {
      const source = index(iris, x, y);
      const alpha = iris.data[source + 3];
      if (alpha < 32) continue;
      const sx = Math.round(restX + x + offset[0]);
      const sy = Math.round(restY + y + offset[1]);
      if (sx < 0 || sy < 0 || sx >= out.width || sy >= out.height) continue;
      const dest = index(out, sx, sy);
      if (out.data[dest + 3] < 32) continue;
      const cover = alpha / 255;
      out.data[dest] = Math.round(iris.data[source] * cover + out.data[dest] * (1 - cover));
      out.data[dest + 1] = Math.round(iris.data[source + 1] * cover + out.data[dest + 1] * (1 - cover));
      out.data[dest + 2] = Math.round(iris.data[source + 2] * cover + out.data[dest + 2] * (1 - cover));
    }
  }
  return out;
}

function isWhite(data: Uint8ClampedArray, i: number): boolean {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  return data[i + 3] > 200 && r > 230 && g > 215 && b > 190 && r - b < 45 && g > b;
}

function isIris(data: Uint8ClampedArray, i: number): boolean {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  return data[i + 3] > 200 && r > 70 && r < 210 && g > 30 && g < 150 && b < 110 && r > g + 15 && r > b + 20;
}

function isPupil(data: Uint8ClampedArray, i: number): boolean {
  return data[i + 3] > 200 && data[i] < 70 && data[i + 1] < 70 && data[i + 2] < 80;
}

export interface RecoveredEyes {
  sockets: EyeBox[];
  travel: [number, number];
}

/**
 * Finds a horizontal pair of painted eyes on a flattened plate.
 * Returns null when the pair cannot be isolated. Callers must not repeat the plate five times.
 */
export function recoverPaintedEyes(plate: Raster): RecoveredEyes | null {
  const seen = new Uint8Array(plate.width * plate.height);
  const blobs: EyeBox[] = [];
  for (let y = 0; y < plate.height; y += 1) {
    for (let x = 0; x < plate.width; x += 1) {
      const start = y * plate.width + x;
      if (seen[start] || !isWhite(plate.data, start * 4)) continue;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let count = 0;
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const at = stack.pop()!;
        count += 1;
        const cx = at % plate.width;
        const cy = Math.floor(at / plate.width);
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        const next = [at - 1, at + 1, at - plate.width, at + plate.width];
        for (const candidate of next) {
          if (candidate < 0 || candidate >= seen.length || seen[candidate]) continue;
          const nx = candidate % plate.width;
          if (Math.abs(nx - cx) > 1) continue;
          if (!isWhite(plate.data, candidate * 4)) continue;
          seen[candidate] = 1;
          stack.push(candidate);
        }
      }
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      if (count < 80 || count > 800 || w < 18 || w > 80 || h < 8 || h > 36 || w / h < 1 || w / h > 4.5) continue;
      let iris = 0;
      let pupil = 0;
      for (let py = Math.max(0, minY - 2); py <= Math.min(plate.height - 1, maxY + 2); py += 1) {
        for (let px = Math.max(0, minX - 2); px <= Math.min(plate.width - 1, maxX + 2); px += 1) {
          const i = index(plate, px, py);
          if (isIris(plate.data, i)) iris += 1;
          if (isPupil(plate.data, i)) pupil += 1;
        }
      }
      if (iris < 40 || iris > 400 || pupil < 8 || pupil > 220) continue;
      blobs.push({ x: minX, y: minY, w, h });
    }
  }
  if (blobs.length < 2) return null;
  const ranked = [...blobs].sort((a, b) => a.y - b.y || a.x - b.x);
  let best: [EyeBox, EyeBox] | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < ranked.length; i += 1) {
    for (let j = i + 1; j < ranked.length; j += 1) {
      const left = ranked[i].x <= ranked[j].x ? ranked[i] : ranked[j];
      const right = left === ranked[i] ? ranked[j] : ranked[i];
      const dy = Math.abs(left.y + left.h / 2 - (right.y + right.h / 2));
      const gap = right.x - (left.x + left.w);
      if (dy > 8 || gap < 8 || gap > plate.width * 0.45) continue;
      const score = dy + Math.abs(left.w - right.w);
      if (score < bestScore) {
        bestScore = score;
        best = [left, right];
      }
    }
  }
  if (!best) return null;
  const travelX = Math.max(2, Math.min(6, Math.round(best[0].w * 0.12)));
  const travelY = Math.max(2, Math.min(4, Math.round(best[0].h * 0.15)));
  return { sockets: best, travel: [travelX, travelY] };
}

function paintRecovered(plate: Raster, eyes: RecoveredEyes, offset: [number, number]): Raster {
  const out = clone(plate);
  for (const box of eyes.sockets) {
    const fill = sampleSclera(plate, box);
    const pixels: { x: number; y: number; r: number; g: number; b: number }[] = [];
    for (let y = box.y; y < box.y + box.h; y += 1) {
      for (let x = box.x; x < box.x + box.w; x += 1) {
        const i = index(plate, x, y);
        if (!isIris(plate.data, i) && !isPupil(plate.data, i)) continue;
        pixels.push({ x, y, r: plate.data[i], g: plate.data[i + 1], b: plate.data[i + 2] });
        out.data[i] = fill[0];
        out.data[i + 1] = fill[1];
        out.data[i + 2] = fill[2];
      }
    }
    for (const pixel of pixels) {
      const x = pixel.x + offset[0];
      const y = pixel.y + offset[1];
      if (x < box.x + 1 || y < box.y + 1 || x >= box.x + box.w - 1 || y >= box.y + box.h - 1) continue;
      const i = index(out, x, y);
      if (out.data[i + 3] < 32) continue;
      out.data[i] = pixel.r;
      out.data[i + 1] = pixel.g;
      out.data[i + 2] = pixel.b;
    }
  }
  return out;
}

function sampleSclera(plate: Raster, box: EyeBox): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = box.y; y < box.y + box.h; y += 1) {
    for (let x = box.x; x < box.x + box.w; x += 1) {
      const i = index(plate, x, y);
      if (!isWhite(plate.data, i)) continue;
      r += plate.data[i];
      g += plate.data[i + 1];
      b += plate.data[i + 2];
      n += 1;
    }
  }
  if (!n) return [242, 233, 217];
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

export function composeRecoveredOffset(plate: Raster, eyes: RecoveredEyes, offset: [number, number]): Raster {
  const clamped: [number, number] = [
    Math.max(-eyes.travel[0], Math.min(eyes.travel[0], Math.round(offset[0]))),
    Math.max(-eyes.travel[1], Math.min(eyes.travel[1], Math.round(offset[1]))),
  ];
  return paintRecovered(plate, eyes, clamped);
}

export function composeRecovered(plate: Raster, eyes: RecoveredEyes, direction: GazeDirection): Raster {
  const [vx, vy] = gazeVector(direction);
  return composeRecoveredOffset(plate, eyes, [vx * eyes.travel[0], vy * eyes.travel[1]]);
}

export function pupilCentroids(raster: Raster, boxes: EyeBox[]): { x: number; y: number }[] {
  return boxes.map((box) => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = box.y; y < box.y + box.h; y += 1) {
      for (let x = box.x; x < box.x + box.w; x += 1) {
        if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) continue;
        const i = index(raster, x, y);
        if (raster.data[i + 3] < 128 || lum(raster.data, i) > 180) continue;
        sx += x;
        sy += y;
        n += 1;
      }
    }
    return n ? { x: sx / n, y: sy / n } : { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  });
}

function outsideStable(base: Raster, next: Raster, boxes: EyeBox[]): boolean {
  const pad = 2;
  for (let y = 0; y < base.height; y += 1) {
    for (let x = 0; x < base.width; x += 1) {
      const inside = boxes.some((box) => x >= box.x - pad && y >= box.y - pad && x < box.x + box.w + pad && y < box.y + box.h + pad);
      if (inside) continue;
      const i = index(base, x, y);
      if (base.data[i] !== next.data[i] || base.data[i + 1] !== next.data[i + 1] || base.data[i + 2] !== next.data[i + 2] || base.data[i + 3] !== next.data[i + 3]) {
        return false;
      }
    }
  }
  return true;
}

/** Proves the pupils move and the rest of the picture does not. A metadata flag is not enough. */
export function proveGaze(render: (direction: GazeDirection) => Raster, boxes: EyeBox[]): GazeProof {
  const frames = Object.fromEntries(GAZE_DIRECTIONS.map((direction) => [direction, render(direction)])) as Record<GazeDirection, Raster>;
  const centroids = Object.fromEntries(GAZE_DIRECTIONS.map((direction) => [direction, pupilCentroids(frames[direction], boxes)])) as GazeProof["centroids"];
  const center = centroids.center ?? [];
  const left = centroids.left ?? [];
  const right = centroids.right ?? [];
  const up = centroids.up ?? [];
  const down = centroids.down ?? [];
  if (center.length < 1 || [left, right, up, down].some((row) => row.length !== center.length)) {
    return { ok: false, reason: "each direction needs the same eyes", centroids };
  }
  for (let i = 0; i < center.length; i += 1) {
    if (!(left[i].x < center[i].x - 0.6)) return { ok: false, reason: "left gaze did not move the pupil left", centroids };
    if (!(right[i].x > center[i].x + 0.6)) return { ok: false, reason: "right gaze did not move the pupil right", centroids };
    if (!(up[i].y < center[i].y - 0.35)) return { ok: false, reason: "up gaze did not move the pupil up", centroids };
    if (!(down[i].y > center[i].y + 0.35)) return { ok: false, reason: "down gaze did not move the pupil down", centroids };
  }
  const distinct = GAZE_DIRECTIONS.slice(1).every((direction) => !sameRaster(frames.center, frames[direction]));
  if (!distinct) return { ok: false, reason: "directions repeated the same pixels", centroids };
  const stable = GAZE_DIRECTIONS.slice(1).every((direction) => outsideStable(frames.center, frames[direction], boxes));
  if (!stable) return { ok: false, reason: "pixels outside the eyes moved", centroids };
  return { ok: true, centroids };
}

function sameRaster(a: Raster, b: Raster): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i += 1) if (a.data[i] !== b.data[i]) return false;
  return true;
}

export function reportSeparable(layers: Layer[], rasters: Partial<Record<LayerName, Raster>>): ViewEyeReport {
  if (!separableGaze(layers)) return { gaze: "unavailable", reason: "this view has no separate iris and socket" };
  const plateName = layers.some((layer) => layer.name === "eye_white") ? "eye_white" : "eyes";
  const plateLayer = layers.find((layer) => layer.name === plateName);
  const irisLayer = layers.find((layer) => layer.name === "iris");
  const socketLayer = layers.find((layer) => layer.name === "eye_socket");
  const plate = rasters[plateName];
  const iris = rasters.iris;
  const socket = rasters.eye_socket;
  if (!plateLayer || !irisLayer || !socketLayer || !plate || !iris || !socket) {
    return { gaze: "unavailable", reason: "the iris or socket bytes are missing" };
  }
  const restX = irisLayer.x - socketLayer.x;
  const restY = irisLayer.y - socketLayer.y;
  const published = [8, 4] as [number, number];
  const travel = fitTravel(socket, iris, restX, restY, published);
  if (!travel) return { gaze: "unavailable", reason: "the socket cannot hold a visible iris shift" };
  const socketBox: EyeBox = { x: 0, y: 0, w: socket.width, h: socket.height };
  const proof = proveGaze((direction) => {
    const [vx, vy] = gazeVector(direction);
    return composeSeparable({
      plate,
      iris,
      socket,
      plateOrigin: [plateLayer.x, plateLayer.y],
      irisOrigin: [irisLayer.x, irisLayer.y],
      socketOrigin: [socketLayer.x, socketLayer.y],
      offset: [Math.round(vx * travel[0]), Math.round(vy * travel[1])],
    });
  }, [socketBox]);
  if (!proof.ok) return { gaze: "unavailable", reason: proof.reason, sockets: [socketBox] };
  return { gaze: "separable", travel, sockets: [socketBox] };
}

export function reportPainted(plate: Raster): ViewEyeReport {
  if (plate.width < 64 || plate.height < 64) return { gaze: "unavailable", reason: "image is too small to contain a face" };
  const eyes = recoverPaintedEyes(plate);
  if (!eyes) return { gaze: "unavailable", reason: "the painted plate has no separable pupil pair" };
  const proof = proveGaze((direction) => composeRecovered(plate, eyes, direction), eyes.sockets);
  if (!proof.ok) return { gaze: "unavailable", reason: proof.reason, sockets: eyes.sockets };
  return { gaze: "recovered", travel: eyes.travel, sockets: eyes.sockets };
}

/** A new rig is ready only when every supplied face view can move its own pupils. */
export function eyesReady(reports: ViewEyeReport[]): boolean {
  return reports.length > 0 && reports.every((report) => report.gaze === "separable" || report.gaze === "recovered");
}

/**
 * One-click characters stay placeholders until every supplied face view names a separate iris and socket.
 * Photo cut-outs are a different rig. A `true` flag is not accepted in place of those layers.
 */
export function holdUnprovenCharacter(character: Character): Character {
  if (character.photo || character.style === "cutout") return character;
  if (character.status !== "ready") return character;
  const faced = Object.values(character.views ?? {}).filter((view) => (view?.layers?.length ?? 0) > 0);
  if (faced.length > 0 && faced.every((view) => separableGaze(view.layers))) return character;
  return {
    ...character,
    status: "placeholder",
    generatorNote: "Eye control is not proven for every supplied view. The character stays a placeholder until the pupils move.",
  };
}
