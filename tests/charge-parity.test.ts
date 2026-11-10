import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { puppetToRig } from "../lib/accounts/rig";
import type { LibraryCharacter } from "../lib/accounts/types";
import { CHARGE_COMPLETION, chargeCharacterRig, isChargeName, presentPairMember, type ApprovedHeads } from "../lib/charge-parity";
import { reservedMouthVariations } from "../lib/contract";
import { pairPlates, sharedBackground } from "../lib/library-pair";
import { decodePngRgba, encodePngRgba } from "../lib/png-rgba";
import { controllerSlots } from "../lib/puppet-controller";
import { paritySheet } from "../lib/sheet";
import { closeFrame, FACE_TEMPLATE } from "../lib/stage-frame";

function character(name: string, layers: LibraryCharacter["layers"] = []): LibraryCharacter {
  return {
    id: "chr_test",
    ownerId: "usr_test",
    name,
    personaSheetRef: null,
    views: { front: "/api/library/assets/characters/chr_test/views/front.png" },
    puppetUrl: "puppet.json",
    layers,
    emotionSheetUrl: "/api/library/assets/characters/chr_test/emotion-sheet.png",
    status: "ready",
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
  };
}

const heads: ApprovedHeads = {
  front: { file: "head_front.png", url: "/api/packs/charge-approved/head_front.png", canvas: { w: 760, h: 786 } },
  left: { file: "head_3q_left.png", url: "/api/packs/charge-approved/head_3q_left.png", canvas: { w: 740, h: 780 } },
  right: { file: "head_3q_right.png", url: "/api/packs/charge-approved/head_3q_right.png", canvas: { w: 750, h: 784 } },
};

describe("charge parity", () => {
  it("drops the painted plate and shows three distinct heads on the same face template", () => {
    const painted = character("Einstein charge", [
      { name: "body", url: "/files/layers/front/body.png" },
      { name: "mouth", url: "/files/layers/front/mouths/A.png" },
    ]);
    const shown = presentPairMember(painted, heads, "/api/packs/shared-scenery");
    assert.equal(shown.status, "draft");
    assert.equal(shown.emotionSheetUrl, null);
    assert.equal(shown.layers.some((layer) => layer.name === "body" || layer.url.includes("body.png")), false);
    assert.equal(shown.views.front, heads.front.url);
    assert.notEqual(shown.views.three_quarter_left, shown.views.front);
    assert.notEqual(shown.views.three_quarter_right, shown.views.front);
    const rig = chargeCharacterRig(shown, heads, "/api/packs/shared-scenery");
    const slots = controllerSlots(shown.views, rig);
    assert.equal(slots.find((slot) => slot.id === "front")?.present, true);
    assert.equal(slots.find((slot) => slot.id === "three_quarter_left")?.present, true);
    assert.equal(slots.find((slot) => slot.id === "three_quarter_right")?.present, true);
    assert.equal(slots.find((slot) => slot.id === "profile")?.reason, "absent");
    assert.equal(slots.some((slot) => slot.reason === "reused-front"), false);
    for (const view of [rig.views.front, rig.views.left, rig.views.right]) {
      assert.equal(view.layers.some((layer) => layer.name === "head"), true);
      assert.equal(view.layers.some((layer) => layer.name === "body"), false);
      assert.deepEqual(view.mouthVariations, reservedMouthVariations());
      const frame = closeFrame(view);
      assert.ok(Math.abs(frame.w / frame.h - FACE_TEMPLATE.aspect) < 0.03);
    }
    const real = puppetToRig(character("Einstein realista"), JSON.parse(readFileSync(new URL("../private/characters/einstein-realista/puppet.json", import.meta.url), "utf8")));
    const chargeSheet = paritySheet(rig.views.front, "unavailable").flatMap((group) => group.states.map((state) => state.id));
    const realSheet = paritySheet(real.views.front, "separable").flatMap((group) => group.states.map((state) => state.id));
    assert.deepEqual(chargeSheet, realSheet);
    assert.equal(paritySheet(rig.views.front, "unavailable").find((group) => group.category === "emotion")?.states.find((state) => state.id === "happy")?.ready, false);
    assert.equal(paritySheet(rig.views.front, "unavailable").find((group) => group.category === "emotion")?.states.find((state) => state.id === "neutral")?.ready, true);
    assert.equal(paritySheet(null, "unavailable").flatMap((group) => group.states).every((state) => state.ready === false), true);
  });

  it("shares one scenery layer and does not call the paid factory", () => {
    const scenery = "/api/packs/shared-scenery";
    const plates = pairPlates([
      presentPairMember(character("Einstein realista", [{ name: "head", url: "head.png" }, { name: "torso", url: "torso.png" }]), heads, scenery),
      presentPairMember(character("Einstein charge", [{ name: "body", url: "layers/front/body.png" }]), heads, scenery),
    ]);
    assert.equal(plates.every((plate) => plate.transparent), true);
    const off = sharedBackground(plates, scenery, false);
    assert.equal(off.mode, "off");
    assert.equal(off.reason, "ready");
    const on = sharedBackground(plates, scenery, true);
    assert.equal(on.mode, "on");
    assert.equal(on.sceneryId, scenery);
    assert.equal(CHARGE_COMPLETION.executed, false);
    assert.equal(CHARGE_COMPLETION.estimateUsd, null);
    assert.equal(CHARGE_COMPLETION.ceiling.images, 18);
    assert.equal(CHARGE_COMPLETION.ceiling.detectFeatures, 6);
    assert.equal(CHARGE_COMPLETION.request.body.generate, true);
    assert.equal(isChargeName("Einstein charge"), true);
    const source = readFileSync(new URL("../lib/charge-parity.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    const raster = decodePngRgba(encodePngRgba({ width: 2, height: 2, data: Uint8ClampedArray.from([0, 0, 0, 0, 9, 8, 7, 255, 0, 0, 0, 0, 1, 2, 3, 255]) }));
    assert.equal(raster?.data[7], 255);
    assert.equal(raster?.data[3], 0);
  });
});
