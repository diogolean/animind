import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { presentAvatar } from "../lib/avatar-source";
import { blockReadyIncompleteHead, chargePlateRole } from "../lib/charge-approved";
import { pairPlates, replaceSharedScenery, sharedBackground, type PairPlate } from "../lib/library-pair";
import type { Raster } from "../lib/png-rgba";
import { translate } from "../lib/i18n";

const APPROVED = [
  "head_front.png",
  "head_3q_left.png",
  "head_3q_right.png",
  "rosto_front_2048h_aiwake.png",
  "rosto_3q_left_2048h_aiwake.png",
  "rosto_front_1440x2560_aiwake.png",
  "rosto_3q_left_1440x2560_aiwake.png",
];

describe("shared background", () => {
  it("keeps both off when either plate has no separate scenery", () => {
    const plates: PairPlate[] = [
      { id: "realista", transparent: true, sceneryIds: [] },
      { id: "charge", transparent: false, sceneryIds: [] },
    ];
    const pair = sharedBackground(plates, null, true);
    assert.equal(pair.mode, "off");
    assert.equal(pair.reason, "needs-original");
    assert.equal(pair.sceneryId, null);
    const transparent = sharedBackground(
      [
        { id: "realista", transparent: true, sceneryIds: [] },
        { id: "other", transparent: true, sceneryIds: [] },
      ],
      null,
      true,
    );
    assert.equal(transparent.reason, "needs-scenery");
    const saved = pairPlates([
      { id: "realista", layers: [{ name: "head", url: "head.png" }, { name: "torso", url: "torso.png" }] },
      { id: "charge", layers: [{ name: "body", url: "body.png" }] },
    ]);
    assert.equal(saved[0]?.transparent, true);
    assert.equal(saved[1]?.transparent, false);
    assert.equal(sharedBackground(saved, "room", true).reason, "needs-original");
  });

  it("turns both on only together and replaces the same layer without touching the plates", () => {
    const plates: PairPlate[] = [
      { id: "realista", transparent: true, sceneryIds: ["room", "studio"] },
      { id: "charge", transparent: true, sceneryIds: ["room", "studio"] },
    ];
    const before = JSON.stringify(plates);
    const off = sharedBackground(plates, "room", false);
    assert.equal(off.mode, "off");
    assert.deepEqual(off.choices, ["room", "studio"]);
    const on = replaceSharedScenery(plates, null, "studio", true);
    assert.equal(on.mode, "on");
    assert.equal(on.sceneryId, "studio");
    const again = replaceSharedScenery(plates, "studio", "room", true);
    assert.equal(again.sceneryId, "room");
    assert.equal(JSON.stringify(plates), before);
    const mixed = sharedBackground(
      [
        { id: "realista", transparent: true, sceneryIds: ["room"] },
        { id: "charge", transparent: false, sceneryIds: ["room"] },
      ],
      "room",
      true,
    );
    assert.equal(mixed.mode, "off");
    assert.equal(mixed.reason, "needs-original");
  });

  it("composites real alpha and leaves the source rasters unchanged", () => {
    const avatar = raster(2, 2, [0, 0, 0, 0]);
    avatar.data[0] = 9;
    avatar.data[1] = 8;
    avatar.data[2] = 7;
    avatar.data[3] = 255;
    const room = raster(2, 2, [20, 30, 40, 255]);
    const studio = raster(2, 2, [50, 60, 70, 255]);
    const avatarBefore = Buffer.from(avatar.data).toString("hex");
    const roomBefore = Buffer.from(room.data).toString("hex");
    const off = presentAvatar(avatar, room, false, "ready");
    assert.equal(off.data[4], 0);
    assert.equal(off.data[7], 0);
    const on = presentAvatar(avatar, room, true, "ready");
    assert.equal(on.data[4], 20);
    const replaced = presentAvatar(avatar, studio, true, "ready");
    assert.equal(replaced.data[4], 50);
    assert.equal(Buffer.from(avatar.data).toString("hex"), avatarBefore);
    assert.equal(Buffer.from(room.data).toString("hex"), roomBefore);
  });
});

describe("approved charge heads", () => {
  it("does not call a head-only folder ready", () => {
    for (const name of APPROVED) {
      assert.equal(chargePlateRole(name) === "head" || chargePlateRole(name) === "face", true);
      assert.equal(chargePlateRole(name) === "body", false);
    }
    assert.equal(blockReadyIncompleteHead(APPROVED), true);
    assert.equal(blockReadyIncompleteHead(["layers/front/body.png", "layers/front/mouths/A.png"]), false);
    const importer = readFileSync(new URL("../lib/accounts/import-character.ts", import.meta.url), "utf8");
    assert.match(importer, /blockReadyIncompleteHead/);
  });
});

describe("library pair layout", () => {
  it("uses the useful width, two contain columns, and one shared background", () => {
    const page = readFileSync(new URL("../components/my-characters.tsx", import.meta.url), "utf8");
    const viewer = readFileSync(new URL("../components/composed-character.tsx", import.meta.url), "utf8");
    const stage = readFileSync(new URL("../components/avatar-stage.tsx", import.meta.url), "utf8");
    assert.match(page, /data-testid="character-pair"/);
    assert.match(page, /sm:grid-cols-2/);
    assert.match(page, /lg:grid-cols-3/);
    assert.match(page, /max-w-5xl/);
    assert.equal(page.includes("min-h-[70dvh]"), false);
    assert.equal(page.includes("object-cover"), false);
    assert.equal(page.includes("mix-blend"), false);
    assert.equal(page.includes("mask-image"), false);
    assert.equal(page.includes("sceneryMatte"), false);
    assert.match(page, /object-contain/);
    assert.match(page, /data-template="face"/);
    assert.match(page, /framing="close"/);
    assert.match(page, /data-testid="shared-scenery"/);
    assert.match(page, /data-testid="replace-scenery"/);
    assert.match(viewer, /<figure[^>]*max-w-md/);
    assert.match(viewer, /data-fit="contain"/);
    assert.match(viewer, /data-template=\{framing === "close" \? "face" : "body"\}/);
    assert.match(viewer, /useState<Framing>\("close"\)/);
    assert.match(viewer, /data-testid="puppet-controller"/);
    assert.match(viewer, /data-testid="emotion-sheet"/);
    assert.match(stage, /sceneryId/);
    assert.match(stage, /data-template=\{framing === "close" \? "face" : "body"\}/);
    assert.equal(translate("en", "sharedPairOff").includes("Both stay off"), true);
    assert.equal(translate("pt-BR", "sharedPairOff").includes("Os dois ficam sem fundo"), true);
    assert.equal(translate("pt-BR", "sharedPairOriginal").includes("sem fundo"), false);
    assert.equal(translate("pt-BR", "sharedPairOriginal").includes("sala pintada"), true);
    assert.equal(translate("en", "sceneryNeedsOriginal").includes("painted room"), true);
    const ignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
    assert.match(ignore, /einstein-charge-approved/);
  });
});

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
