import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { controlClass } from "../lib/control-class";
import type { CharacterView } from "../lib/contract";
import { recoverPaintedEyes } from "../lib/eye-rig";
import { visemeSitsOnMouth } from "../lib/mouth-place";
import { decodePngRgba, type Raster } from "../lib/png-rgba";
import { sceneryMatte } from "../lib/scenery";
import { SHEET_CELL, SHEET_GRID, sheetGroups } from "../lib/sheet";
import { closeFrame, FACE_TEMPLATE, fullBodyFrame, hasFullBody } from "../lib/stage-frame";

describe("stage template", () => {
  it("keeps a full body only when the asset already has one, and a close crop on the head", async () => {
    const realista = await puppet("private/characters/einstein-realista/puppet.json");
    const front = realista.views.front;
    assert.equal(hasFullBody(front), true);
    assert.deepEqual(fullBodyFrame(front), { x: 0, y: 0, w: front.canvas.w, h: front.canvas.h });
    const close = closeFrame(front);
    assert.ok(close.h < front.canvas.h, "the close crop is the head, not the canvas");
    assert.ok(close.y > 0);
    const headOnly: CharacterView = { canvas: { w: 100, h: 200 }, layers: [{ name: "head", url: "h.png", x: 10, y: 10, w: 40, h: 50, z: 1 }], visemes: {} };
    assert.equal(hasFullBody(headOnly), false);

    const chargeFile = await readFile(path.join(process.cwd(), "private/characters/einstein-charge/puppet.json"), "utf8");
    assert.equal(chargeFile.includes("body.png"), false);
    assert.equal(chargeFile.includes("ca8386e2"), false);
    const plate = await png("private/characters/einstein-charge/layers/front/body.png");
    const eyes = recoverPaintedEyes(plate);
    assert.ok(eyes);
    const legacy: CharacterView = { canvas: { w: 480, h: 620 }, layers: [{ name: "body", url: "layers/front/body.png", x: 0, y: 0, w: 480, h: 620, z: 1 }], visemes: {} };
    assert.equal(hasFullBody(legacy), false);
    const face = closeFrame(legacy, eyes.sockets);
    const left = realista.views["three-quarter"];
    const right = realista.views["three-quarter-right"];
    assert.ok(left && right);
    const fronts = [close, closeFrame(left), closeFrame(right), face];
    const aspects = fronts.map((frame) => frame.w / frame.h);
    for (const aspect of aspects) assert.ok(Math.abs(aspect - FACE_TEMPLATE.aspect) < 0.03, String(aspect));
    const eyeLine = (frame: { y: number; h: number }, eyeY: number) => (eyeY - frame.y) / frame.h;
    const lines = [
      eyeLine(close, 643),
      eyeLine(closeFrame(left), 645),
      eyeLine(closeFrame(right), 645),
      eyeLine(face, (eyes.sockets[0].y + eyes.sockets[1].y + eyes.sockets[1].h) / 2),
    ];
    for (const line of lines) assert.ok(Math.abs(line - FACE_TEMPLATE.eyeLine) < 0.04, String(line));
  });

  it("lists gaze, emotion, and lids that exist and does not invent the rest", async () => {
    const realista = await puppet("private/characters/einstein-realista/puppet.json");
    const groups = sheetGroups(realista.views.front, "separable");
    assert.deepEqual(groups.map((group) => group.category), ["gaze", "emotion", "lids"]);
    assert.deepEqual(groups[0].states.map((state) => state.gaze), ["center", "left", "right", "up", "down"]);
    assert.equal(groups[0].states.length, 5);
    assert.ok(groups[1].states.some((state) => state.emotion === "happy"));
    assert.equal(sheetGroups(realista.views.front, "pending").some((group) => group.category === "gaze"), false);
    const charge = await puppet("private/characters/einstein-charge/puppet.json");
    assert.deepEqual(sheetGroups(charge.views.front, "pending"), []);
    const recovered = sheetGroups(charge.views.front, "recovered");
    assert.deepEqual(recovered.map((group) => group.category), ["gaze"]);
    assert.equal(SHEET_GRID.includes("flex-wrap"), true);
    assert.equal(SHEET_GRID.includes("auto-fill"), false);
    assert.equal(SHEET_CELL.includes("calc(50%"), true);
    assert.equal(SHEET_CELL.includes("lg:w-[calc(25%"), true);
    assert.equal(SHEET_CELL.includes("lg:w-[calc(20%"), false);
  });

  it("mattes a flat background and refuses the charge room", async () => {
    const flat = blank(40, 40, [20, 30, 40, 255]);
    paint(flat, 14, 14, 12, 12, [180, 140, 90, 255]);
    const matte = sceneryMatte(flat);
    assert.ok(matte);
    assert.equal(matte.data[3], 0);
    assert.equal(matte.data[((20 * 40 + 20) * 4) + 3], 255);
    const charge = await png("private/characters/einstein-charge/layers/front/body.png");
    assert.equal(sceneryMatte(charge), null);
    const before = Buffer.from(charge.data);
    sceneryMatte(charge);
    assert.equal(Buffer.from(charge.data).equals(before), true);
  });

  it("does not keep the painted charge mouth on the character", async () => {
    const charge = await puppet("private/characters/einstein-charge/puppet.json");
    assert.equal(charge.views.front.visemes.X, undefined);
    assert.equal(JSON.stringify(charge).includes("mouths/"), false);
    const plate = await png("private/characters/einstein-charge/layers/front/body.png");
    const eyes = recoverPaintedEyes(plate);
    assert.ok(eyes);
    assert.equal(visemeSitsOnMouth({ y: eyes.sockets[0].y + eyes.sockets[0].h + 4 }, eyes.sockets, 0), true);
  });

  it("puts hover, focus, active, and reduced motion on the control class", () => {
    const idle = controlClass(false);
    const pressed = controlClass(true);
    for (const token of ["[@media(hover:hover)]:hover:", "focus-visible:outline", "active:scale-95", "motion-reduce:transition-none", "min-h-11"]) {
      assert.equal(idle.includes(token), true, token);
    }
    assert.equal(pressed.includes("bg-white"), true);
    assert.equal(idle.includes("outline-none"), false);
    assert.equal(idle.includes("focus-visible:outline-solid"), true);
  });
});

async function puppet(relative: string): Promise<{ views: Record<string, CharacterView> }> {
  const json = JSON.parse(await readFile(path.join(process.cwd(), relative), "utf8")) as { views: Record<string, CharacterView> };
  return json;
}

async function png(relative: string): Promise<Raster> {
  const raster = decodePngRgba(await readFile(path.join(process.cwd(), relative)));
  assert.ok(raster, relative);
  return raster;
}

function blank(width: number, height: number, rgba: [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

function paint(raster: Raster, x: number, y: number, w: number, h: number, rgba: [number, number, number, number]) {
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) raster.data.set(rgba, (py * raster.width + px) * 4);
  }
}
