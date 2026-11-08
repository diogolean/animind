import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { puppetToRig } from "../lib/accounts/rig";
import type { LibraryCharacter } from "../lib/accounts/types";
import { VISEMES } from "../lib/contract";
import { controllerSlots, normalizedAnchors, poseAt } from "../lib/puppet-controller";

function character(name: string, views: LibraryCharacter["views"]): LibraryCharacter {
  return {
    id: "chr_test",
    ownerId: "usr_test",
    name,
    personaSheetRef: null,
    views,
    puppetUrl: "puppet.json",
    layers: [],
    emotionSheetUrl: null,
    status: "ready",
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
  };
}

function pack(dir: string) {
  const puppet = JSON.parse(readFileSync(new URL(`../private/characters/${dir}/puppet.json`, import.meta.url), "utf8")) as unknown;
  const record = character(dir, {});
  return puppetToRig(record, puppet);
}

function inside(point: { x: number; y: number } | null) {
  assert.ok(point);
  assert.ok(point.x >= 0 && point.x <= 1);
  assert.ok(point.y >= 0 && point.y <= 1);
}

describe("puppet controller", () => {
  it("uses one slot list and does not turn the charge front plate into a 3/4", () => {
    const charge = pack("einstein-charge");
    const real = pack("einstein-realista");
    const chargeSlots = controllerSlots({}, charge);
    const realSlots = controllerSlots({}, real);
    assert.deepEqual(chargeSlots.map((slot) => slot.id), realSlots.map((slot) => slot.id));
    assert.deepEqual(chargeSlots.map((slot) => slot.id), ["front", "three_quarter_left", "three_quarter_right", "profile"]);
    assert.equal(chargeSlots.find((slot) => slot.id === "front")?.present, true);
    assert.equal(chargeSlots.find((slot) => slot.id === "three_quarter_left")?.present, false);
    assert.equal(chargeSlots.find((slot) => slot.id === "three_quarter_left")?.reason, "reused-front");
    assert.equal(chargeSlots.find((slot) => slot.id === "three_quarter_right")?.reason, "reused-front");
    assert.equal(chargeSlots.find((slot) => slot.id === "profile")?.reason, "absent");
    assert.equal(chargeSlots.some((slot) => slot.id !== "front" && slot.present), false);
    assert.equal(realSlots.find((slot) => slot.id === "front")?.present, true);
    assert.equal(realSlots.find((slot) => slot.id === "three_quarter_left")?.present, true);
    assert.equal(realSlots.find((slot) => slot.id === "three_quarter_right")?.present, true);
    assert.equal(realSlots.find((slot) => slot.id === "profile")?.present, false);
  });

  it("normalizes mouth and eye anchors for both canvases and leaves a missing part empty", () => {
    const charge = normalizedAnchors(pack("einstein-charge").views.front);
    const real = normalizedAnchors(pack("einstein-realista").views.front);
    inside(charge.mouth);
    assert.equal(charge.leftEye, null);
    assert.equal(charge.rightEye, null);
    inside(real.mouth);
    inside(real.leftEye);
    inside(real.rightEye);
    inside(real.head);
    assert.ok(real.leftEye && real.rightEye && real.leftEye.x < real.rightEye.x);
    const left = normalizedAnchors(pack("einstein-realista").views.left);
    inside(left.mouth);
    assert.equal(JSON.stringify(charge).includes("layers/front"), false);
  });

  it("blinks from the clock without a model", () => {
    assert.deepEqual(poseAt(0), { lids: "open", gaze: "center" });
    assert.equal(poseAt(3.5).lids, "closed");
    assert.equal(poseAt(1.2).gaze === "left" || poseAt(1.2).gaze === "right" || poseAt(1.2).gaze === "center", true);
    const source = readFileSync(new URL("../lib/puppet-controller.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("openai"), false);
    assert.equal(source.includes("generate_character_image"), false);
    assert.deepEqual(VISEMES.includes("X") && VISEMES.includes("A"), true);
  });

  it("puts the same controller before the emotion board and does not add a second viewer", () => {
    const screen = readFileSync(new URL("../components/composed-character.tsx", import.meta.url), "utf8");
    const controller = screen.indexOf('data-testid="puppet-controller"');
    const board = screen.indexOf('data-testid="emotion-sheet"');
    assert.ok(controller >= 0 && board > controller);
    assert.equal(screen.match(/<AvatarStage/g)?.length, 2);
    assert.match(screen, /controllerSlots/);
    assert.match(screen, /normalizedAnchors/);
    assert.match(screen, /data-missing/);
    assert.match(screen, /parametric-pose/);
    assert.equal(screen.includes('scenery={false}'), true);
  });
});
