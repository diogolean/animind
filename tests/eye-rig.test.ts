import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { puppetToRig } from "../lib/accounts/rig";
import type { LibraryCharacter } from "../lib/accounts/types";
import type { Character, Layer } from "../lib/contract";
import { blockReadyWithoutEyes } from "../lib/eye-gate";
import { composeRecoveredOffset, composeSeparable, eyesReady, fitTravel, gazeVector, holdUnprovenCharacter, proveGaze, recoverPaintedEyes, reportPainted, reportSeparable, separableGaze, type GazeDirection } from "../lib/eye-rig";
import { decodePngRgba, type Raster } from "../lib/png-rgba";

const root = process.cwd();

async function png(relative: string): Promise<Raster> {
  const bytes = await readFile(path.join(root, relative));
  const raster = decodePngRgba(bytes);
  assert.ok(raster, relative);
  return raster;
}

async function sha(relative: string): Promise<string> {
  const bytes = await readFile(path.join(root, relative));
  return createHash("sha256").update(bytes).digest("hex");
}

function layer(name: Layer["name"], x: number, y: number, raster: Raster): Layer {
  return { name, url: `${name}.png`, x, y, w: raster.width, h: raster.height, z: 1 };
}

describe("eye rig", () => {
  it("moves the realistic iris inside the socket and leaves the original files untouched", async () => {
    const views = ["front", "three-quarter", "three-quarter-right"] as const;
    const before = await Promise.all(
      ["brows.png", "mouths/X.png", "eyes.png", "eye_white.png", "iris.png", "eye_socket.png"].map((name) => sha(`private/characters/einstein-realista/layers/front/${name}`)),
    );
    for (const view of views) {
      const base = `private/characters/einstein-realista/layers/${view}`;
      const [plate, iris, socket] = await Promise.all([png(`${base}/eye_white.png`), png(`${base}/iris.png`), png(`${base}/eye_socket.png`)]);
      const eyes = await png(`${base}/eyes.png`);
      assert.equal(Buffer.from(plate.data).equals(Buffer.from(eyes.data)), true, `${view} eye_white is still the baked eye plate`);
      const layers = [layer("eye_white", 0, 0, plate), layer("iris", 13, -4, iris), layer("eye_socket", 0, 0, socket)];
      if (view === "three-quarter") layers[1] = layer("iris", 11, -4, iris);
      if (view === "three-quarter-right") layers[1] = layer("iris", 20, -4, iris);
      const report = reportSeparable(layers, { eye_white: plate, iris, eye_socket: socket });
      assert.equal(report.gaze, "separable", report.reason);
      assert.ok(report.travel && report.travel[0] >= 4 && report.travel[1] >= 2, JSON.stringify(report.travel));
    }
    const after = await Promise.all(
      ["brows.png", "mouths/X.png", "eyes.png", "eye_white.png", "iris.png", "eye_socket.png"].map((name) => sha(`private/characters/einstein-realista/layers/front/${name}`)),
    );
    assert.deepEqual(after, before);
  });

  it("recovers the caricature pupils from the painted plate without moving the rest", async () => {
    const plate = await png("private/characters/einstein-charge/layers/front/body.png");
    const before = Buffer.from(plate.data);
    const report = reportPainted(plate);
    assert.equal(report.gaze, "recovered", report.reason);
    assert.equal(report.sockets?.length, 2);
    assert.deepEqual(Buffer.from(plate.data), before);
    assert.equal(eyesReady([report]), true);
  });

  it("rejects a repeated plate and a head shift that is not an eye", () => {
    const plate = blank(48, 32);
    paint(plate, 8, 10, 10, 12, [250, 240, 220, 255]);
    paint(plate, 30, 10, 10, 12, [250, 240, 220, 255]);
    paint(plate, 11, 13, 4, 5, [40, 30, 20, 255]);
    paint(plate, 33, 13, 4, 5, [40, 30, 20, 255]);
    paint(plate, 2, 2, 2, 2, [10, 20, 30, 255]);
    const eyes = recoverPaintedEyes(plate);
    assert.equal(eyes, null);
    const marker = blank(20, 12);
    paint(marker, 4, 4, 4, 4, [20, 20, 20, 255]);
    paint(marker, 0, 0, 1, 1, [255, 0, 0, 255]);
    const boxes = [{ x: 2, y: 2, w: 8, h: 8 }];
    const shifted = proveGaze((direction) => {
      if (direction === "center") return marker;
      const moved = { width: marker.width, height: marker.height, data: new Uint8ClampedArray(marker.data) };
      moved.data[0] = 0;
      return moved;
    }, boxes);
    assert.equal(shifted.ok, false);
    assert.match(shifted.reason ?? "", /outside|left gaze|same pixels/);
    assert.deepEqual(gazeVector("right"), [1, 0]);
    assert.equal(separableGaze([{ name: "head" }]), false);
    const socket = blank(12, 12);
    paint(socket, 1, 1, 10, 10, [255, 255, 255, 255]);
    const iris = blank(6, 6);
    paint(iris, 1, 1, 4, 4, [20, 20, 20, 255]);
    const fitted = fitTravel(socket, iris, 2, 2, [8, 4]);
    assert.ok(fitted && fitted[0] < 8 && fitted[0] >= 1);
  });

  it("keeps a separable compose from translating the plate", () => {
    const plate = blank(24, 16);
    paint(plate, 0, 0, 24, 16, [200, 190, 180, 255]);
    paint(plate, 4, 4, 6, 6, [30, 20, 20, 255]);
    const iris = blank(6, 6);
    paint(iris, 0, 0, 6, 6, [30, 20, 20, 255]);
    const socket = blank(24, 16);
    paint(socket, 0, 0, 24, 16, [255, 255, 255, 255]);
    const travel = fitTravel(socket, iris, 4, 4, [4, 2]);
    assert.ok(travel);
    const proof = proveGaze((direction: GazeDirection) => {
      const [vx, vy] = gazeVector(direction);
      return composeSeparable({
        plate,
        iris,
        socket,
        plateOrigin: [0, 0],
        irisOrigin: [4, 4],
        socketOrigin: [0, 0],
        offset: [Math.round(vx * travel![0]), Math.round(vy * travel![1])],
      });
    }, [{ x: 2, y: 2, w: 12, h: 10 }]);
    assert.equal(proof.ok, true, proof.reason);
    const moved = proveGaze((direction) => {
      const [vx] = gazeVector(direction);
      const copy = { width: plate.width, height: plate.height, data: new Uint8ClampedArray(plate.data) };
      if (vx === 0 && direction !== "up" && direction !== "down") return copy;
      const shifted = blank(plate.width, plate.height);
      shifted.data.set(plate.data.subarray(4));
      return shifted;
    }, [{ x: 2, y: 2, w: 12, h: 10 }]);
    assert.equal(moved.ok, false);
  });

  it("keeps the existing Einstein packs ready and holds an unproven rig", async () => {
    for (const name of ["einstein-realista", "einstein-charge"]) {
      const dir = path.join(root, "private/characters", name);
      const puppet = JSON.parse(await readFile(path.join(dir, "puppet.json"), "utf8")) as Record<string, unknown>;
      const files = await walk(dir);
      assert.equal(blockReadyWithoutEyes(puppet, files), false, name);
    }
    const ready = character({
      status: "ready",
      style: "rig",
      views: {
        front: view([{ name: "head", url: "head.png", x: 0, y: 0, w: 10, h: 10, z: 1 }]),
        left: view([]),
        right: view([]),
      },
    });
    assert.equal(holdUnprovenCharacter(ready).status, "placeholder");
    const proved = character({
      status: "ready",
      style: "rig",
      views: {
        front: view([
          { name: "eye_white", url: "eye_white.png", x: 0, y: 0, w: 10, h: 10, z: 1 },
          { name: "iris", url: "iris.png", x: 1, y: 1, w: 4, h: 4, z: 2 },
          { name: "eye_socket", url: "eye_socket.png", x: 0, y: 0, w: 10, h: 10, z: 2 },
        ]),
        left: view([]),
        right: view([]),
      },
    });
    assert.equal(holdUnprovenCharacter(proved).status, "ready");
    const photo = character({ status: "ready", style: "cutout", photo: { url: "a.png", jaw: { x: 0, y: 0, w: 1, h: 1 } } });
    assert.equal(holdUnprovenCharacter(photo).status, "ready");
    const library = {
      id: "chr_eye",
      ownerId: "usr",
      name: "Eyed",
      personaSheetRef: null,
      views: {},
      puppetUrl: "",
      layers: [],
      emotionSheetUrl: null,
      status: "ready",
      createdAt: "",
      updatedAt: "",
    } satisfies LibraryCharacter;
    const kept = puppetToRig(library, {
      views: {
        front: {
          canvas: { w: 20, h: 20 },
          layers: [{ name: "head", url: "head.png", x: 0, y: 0, w: 20, h: 20, z: 1 }],
          visemes: {},
          eyeRig: { maxShift: [8, 4], irises: [[10, 11, 3]] },
        },
      },
    });
    assert.deepEqual(kept.views.front.eyeRig, { maxShift: [8, 4], irises: [[10, 11, 3]] });
    const dropped = puppetToRig(library, {
      views: {
        front: {
          canvas: { w: 20, h: 20 },
          layers: [{ name: "head", url: "head.png", x: 0, y: 0, w: 20, h: 20, z: 1 }],
          visemes: {},
          eyeRig: { maxShift: ["wide", 4], irises: [] },
        },
      },
    });
    assert.equal(dropped.views.front.eyeRig, undefined);
  });

  it("removes the right-gaze black margin and keeps a half-pixel shift distinct", async () => {
    const base = "private/characters/einstein-realista/layers/front";
    const [plate, iris, socket] = await Promise.all([png(`${base}/eye_white.png`), png(`${base}/iris.png`), png(`${base}/eye_socket.png`)]);
    const shared = { plate, iris, socket, plateOrigin: [0, 0] as [number, number], irisOrigin: [13, -4] as [number, number], socketOrigin: [0, 0] as [number, number] };
    const center = composeSeparable({ ...shared, offset: [0, 0] });
    const right = composeSeparable({ ...shared, offset: [8, 0] });
    const half = composeSeparable({ ...shared, offset: [0.5, 0] });
    const step = composeSeparable({ ...shared, offset: [1, 0] });
    assert.equal(same(center, half), false, "a half pixel must change the iris");
    assert.equal(same(half, step), false, "a half pixel must differ from a whole pixel");
    assert.equal(contiguousDark(right, 0, 90), true, "left eye right-gaze has a separated black bar");
    assert.equal(contiguousDark(right, 110, right.width), true, "right eye right-gaze has a separated black bar");
    const charge = await png("private/characters/einstein-charge/layers/front/body.png");
    const eyes = recoverPaintedEyes(charge);
    assert.ok(eyes);
    const chargeRight = composeRecoveredOffset(charge, eyes, [eyes.travel[0], 0]);
    const chargeHalf = composeRecoveredOffset(charge, eyes, [0.5, 0]);
    const chargeCenter = composeRecoveredOffset(charge, eyes, [0, 0]);
    assert.equal(same(chargeHalf, chargeCenter), false);
    for (const box of eyes.sockets) assert.equal(contiguousDark(chargeRight, box.x, box.x + box.w), true, `charge eye ${box.x}`);
    for (const direction of ["center", "left", "right", "up", "down"] as const) {
      const [vx, vy] = gazeVector(direction);
      const frame = composeSeparable({ ...shared, offset: [vx * 8, vy * 2] });
      assert.equal(outsideUntouched(plate, frame, socket), true, direction);
    }
  });
});

function character(patch: Partial<Character>): Character {
  return {
    id: "chr_test",
    name: "Test",
    status: "placeholder",
    style: "rig",
    views: { front: view([]), left: view([]), right: view([]) },
    createdAt: "2026-11-07T00:00:00.000Z",
    ...patch,
  };
}

function view(layers: Layer[]): Character["views"]["front"] {
  return { canvas: { w: 64, h: 64 }, layers, visemes: {} };
}

async function walk(dir: string, prefix = ""): Promise<{ path: string; bytes: Uint8Array }[]> {
  const out: { path: string; bytes: Uint8Array }[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(dir, rel)));
    else if (entry.isFile() && (rel.endsWith(".png") || rel.endsWith(".json"))) out.push({ path: rel, bytes: await readFile(path.join(dir, rel)) });
  }
  return out;
}

function same(a: Raster, b: Raster): boolean {
  return Buffer.from(a.data).equals(Buffer.from(b.data));
}

function contiguousDark(frame: Raster, x0: number, x1: number): boolean {
  const columns: number[] = [];
  for (let x = x0; x < x1; x += 1) {
    let run = 0;
    let best = 0;
    for (let y = 0; y < frame.height; y += 1) {
      const i = (y * frame.width + x) * 4;
      const dark = frame.data[i + 3] > 32 && frame.data[i] + frame.data[i + 1] + frame.data[i + 2] < 50;
      if (dark) {
        run += 1;
        best = Math.max(best, run);
      } else run = 0;
    }
    if (best >= 4) columns.push(x);
  }
  if (columns.length < 2) return false;
  for (let i = 1; i < columns.length; i += 1) if (columns[i] - columns[i - 1] > 2) return false;
  return true;
}

function outsideUntouched(plate: Raster, frame: Raster, socket: Raster): boolean {
  for (let y = 0; y < socket.height; y += 1) {
    for (let x = 0; x < socket.width; x += 1) {
      if (socket.data[(y * socket.width + x) * 4 + 3] > 32) continue;
      const i = (y * frame.width + x) * 4;
      const p = (y * plate.width + x) * 4;
      if (frame.data[i + 3] !== 0 && (frame.data[i] !== plate.data[p] || frame.data[i + 1] !== plate.data[p + 1] || frame.data[i + 2] !== plate.data[p + 2])) return false;
    }
  }
  return true;
}

function blank(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function paint(raster: Raster, x: number, y: number, w: number, h: number, rgba: [number, number, number, number]) {
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      const i = (py * raster.width + px) * 4;
      raster.data.set(rgba, i);
    }
  }
}
