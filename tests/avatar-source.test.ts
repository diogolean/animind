import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assessImportedAvatar,
  authorizeResolution,
  FOUR_K_LONG_SIDE,
  MIN_LONG_SIDE,
  plateKind,
  pngSize,
  pointLayersAtAvatar,
  presentAvatar,
  productResolutionSupport,
  readRequestedResolution,
  resolutionRecord,
  retainAvatarSources,
  sceneryPreference,
  sceneryState,
  stageFringe,
} from "../lib/avatar-source";
import { decodePngRgba, type Raster } from "../lib/png-rgba";

describe("avatar source", () => {
  it("keeps the original bytes, records the real size, and does not call a small plate 1K", async () => {
    const charge = await readFile(path.join(process.cwd(), "private/characters/einstein-charge/layers/front/body.png"));
    const before = sha(charge);
    const size = pngSize(charge);
    assert.ok(size);
    assert.equal(size.width, 480);
    assert.equal(size.height, 620);
    assert.ok(Math.max(size.width, size.height) < MIN_LONG_SIDE);
    const raster = decodePngRgba(charge);
    assert.ok(raster);
    assert.equal(plateKind(raster), "baked");
    assert.equal(sceneryState("baked", true), "needs-original");
    assert.equal(sha(charge), before);
    const record = resolutionRecord({ requested: "1k", width: size.width, height: size.height, provenance: "source" });
    assert.equal(record.satisfies, "legacy-below-1k");

    const head = await readFile(path.join(process.cwd(), "private/characters/einstein-realista/layers/front/head.png"));
    const headRaster = decodePngRgba(head);
    assert.ok(headRaster);
    assert.equal(plateKind(headRaster), "transparent");
    assert.equal(sceneryState("transparent", false), "needs-scenery");
    const view = await readFile(path.join(process.cwd(), "private/characters/einstein-realista/views/front.png"));
    const viewRaster = decodePngRgba(view);
    assert.ok(viewRaster);
    assert.equal(plateKind(viewRaster), "opaque-black");
  });

  it("drops a flattened sibling and leaves a legacy folder unchanged", () => {
    const avatar = encodeRgba(raster(2, 2, [0, 0, 0, 0]));
    const flat = encodeRgba(raster(2, 2, [1, 2, 3, 255]));
    const body = encodeRgba(raster(2, 2, [4, 5, 6, 255]));
    const kept = retainAvatarSources([
      { path: "layers/front/avatar.png", bytes: avatar },
      { path: "layers/front/flattened.png", bytes: flat },
      { path: "layers/front/mouths/X.png", bytes: body },
    ]);
    assert.deepEqual(kept.map((file) => file.path), ["layers/front/avatar.png", "layers/front/mouths/X.png"]);
    assert.equal(sha(kept[0].bytes), sha(avatar));
    const legacy = retainAvatarSources([{ path: "layers/front/body.png", bytes: body }]);
    assert.equal(legacy[0].path, "layers/front/body.png");
    assert.equal(sha(legacy[0].bytes), sha(body));
    const puppet = { views: { front: { layers: [{ name: "body", url: "layers/front/flattened.png" }] } } };
    pointLayersAtAvatar(puppet, new Set(kept.map((file) => file.path)));
    assert.equal(puppet.views.front.layers[0].url, "layers/front/avatar.png");
  });

  it("blocks a transparent avatar that is under 1K or still carries a factory stage fringe", () => {
    const small = encodeRgba(transparentPlate(8, 8));
    const assessed = assessImportedAvatar([{ path: "layers/front/avatar.png", bytes: small }]);
    assert.equal(assessed?.block, "legacy-below-1k");
    assert.equal(assessed?.width, 8);
    assert.equal(sha(small), sha(assessImportedAvatar([{ path: "layers/front/avatar.png", bytes: small }]) ? small : small));
    const fringed = transparentPlate(8, 8);
    for (let y = 1; y < 7; y += 1) {
      for (let x = 1; x < 7; x += 1) {
        const edge = x === 1 || y === 1 || x === 6 || y === 6;
        if (!edge) continue;
        const index = (y * 8 + x) * 4;
        fringed.data[index] = 0x00;
        fringed.data[index + 1] = 0x33;
        fringed.data[index + 2] = 0xcc;
        fringed.data[index + 3] = 80;
      }
    }
    assert.equal(stageFringe(fringed).color, "chroma-blue");
    const blocked = assessImportedAvatar([{ path: "avatar.png", bytes: encodeRgba(fringed) }]);
    assert.equal(blocked?.block, "stage-fringe");
    assert.equal(assessImportedAvatar([{ path: "layers/front/body.png", bytes: small }]), null);
  });

  it("paints scenery only outside the avatar and leaves both sources untouched", () => {
    const avatar = raster(4, 4, [0, 0, 0, 0]);
    paint(avatar, 1, 1, 2, 2, [200, 10, 10, 255]);
    const scenery = raster(4, 4, [10, 80, 20, 255]);
    const avatarBefore = Buffer.from(avatar.data);
    const sceneryBefore = Buffer.from(scenery.data);
    const off = presentAvatar(avatar, scenery, false, "ready");
    const on = presentAvatar(avatar, scenery, true, "ready");
    for (let y = 1; y < 3; y += 1) {
      for (let x = 1; x < 3; x += 1) {
        const index = (y * 4 + x) * 4;
        assert.equal(off.data[index], on.data[index]);
        assert.equal(off.data[index + 1], on.data[index + 1]);
        assert.equal(on.data[index], 200);
      }
    }
    assert.equal(on.data[3], 255);
    assert.equal(on.data[1], 80);
    assert.equal(off.data[3], 0);
    const refused = presentAvatar(avatar, scenery, true, "needs-original");
    assert.equal(refused.data[0], 0);
    assert.equal(Buffer.from(avatar.data).equals(avatarBefore), true);
    assert.equal(Buffer.from(scenery.data).equals(sceneryBefore), true);
  });

  it("refuses 4K unless premium and a proven provider are both on, and never labels an upscale as native", () => {
    const support = productResolutionSupport();
    assert.equal(support.premium, false);
    assert.equal(support.providerSupports4k, false);
    assert.equal(authorizeResolution("4k", support).ok, false);
    assert.equal(authorizeResolution("4k", { premium: true, providerSupports4k: false }).ok, false);
    assert.equal(authorizeResolution("4k", { premium: false, providerSupports4k: true }).ok, false);
    assert.deepEqual(authorizeResolution("4k", { premium: true, providerSupports4k: true }), { ok: true, requested: "4k" });
    assert.deepEqual(authorizeResolution("absent", support), { ok: true, requested: "1k" });
    const browser = { requestedResolution: "4k", premium: true };
    assert.equal(readRequestedResolution(browser), "4k");
    assert.equal(authorizeResolution(readRequestedResolution(browser), support).ok, false);
    assert.equal(resolutionRecord({ requested: "4k", width: FOUR_K_LONG_SIDE, height: 2160, provenance: "upscale" }).satisfies, "not-native");
    assert.equal(resolutionRecord({ requested: "4k", width: FOUR_K_LONG_SIDE, height: 2160, provenance: "native" }).satisfies, "4k");
    assert.equal(resolutionRecord({ requested: "4k", width: 1920, height: 1080, provenance: "native" }).satisfies, "not-native");
    assert.equal(resolutionRecord({ requested: "1k", width: 1080, height: 1920, provenance: "source" }).satisfies, "1k");
    const memory = new Map<string, string>();
    const preference = sceneryPreference({
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, value),
    });
    preference.write(true);
    assert.deepEqual([...memory.values()], ["1"]);
    assert.equal(preference.read(), true);
  });

  it("asks the server before the spend guard and keeps the viewer on black without a gradient", async () => {
    const route = await readFile(path.join(process.cwd(), "app/api/characters/route.ts"), "utf8");
    const denied = route.indexOf("!resolution.ok");
    const guard = route.indexOf("guardedGeneration(req");
    assert.ok(denied >= 0 && guard > denied);
    assert.match(route, /requestedResolution/);
    const viewer = await readFile(path.join(process.cwd(), "components/composed-character.tsx"), "utf8");
    const stage = await readFile(path.join(process.cwd(), "components/avatar-stage.tsx"), "utf8");
    assert.match(viewer, /role="switch"/);
    assert.match(viewer, /data-testid="resolution-controls"/);
    assert.match(viewer, /data-testid="framing-controls"/);
    assert.equal(viewer.includes("linear-gradient"), false);
    assert.equal(viewer.includes("bg-gradient"), false);
    assert.match(viewer, /data-ground="black"/);
    assert.match(viewer, /scenery=\{false\}/);
    assert.equal(stage.includes("sceneryMatte"), false);
    assert.equal(stage.includes("applyMatte"), false);
  });
});

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function raster(width: number, height: number, pixel: [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = pixel[0];
    data[index + 1] = pixel[1];
    data[index + 2] = pixel[2];
    data[index + 3] = pixel[3];
  }
  return { width, height, data };
}

function paint(target: Raster, x: number, y: number, width: number, height: number, pixel: [number, number, number, number]) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const index = (row * target.width + column) * 4;
      target.data[index] = pixel[0];
      target.data[index + 1] = pixel[1];
      target.data[index + 2] = pixel[2];
      target.data[index + 3] = pixel[3];
    }
  }
}

function transparentPlate(width: number, height: number): Raster {
  const plate = raster(width, height, [0, 0, 0, 0]);
  paint(plate, 2, 2, width - 4, height - 4, [180, 140, 90, 255]);
  return plate;
}

function encodeRgba(source: Raster): Uint8Array {
  const raw = Buffer.alloc((source.width * 4 + 1) * source.height);
  for (let y = 0; y < source.height; y += 1) {
    const row = y * (source.width * 4 + 1);
    raw[row] = 0;
    Buffer.from(source.data.buffer, source.data.byteOffset + y * source.width * 4, source.width * 4).copy(raw, row + 1);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", Buffer.from([
      ...u32(source.width),
      ...u32(source.height),
      8, 6, 0, 0, 0,
    ])),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), 8 + data.length);
  return out;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function crc(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
