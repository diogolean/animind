import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { puppetToRig } from "../lib/accounts/rig";
import type { LibraryCharacter } from "../lib/accounts/types";
import { capsFromView, emotionTags, hoverTag, initialMap, leaveMap, pinTag, shownPose, tagSupported } from "../lib/emotion-map";
import { translate } from "../lib/i18n";
import { stageMouth } from "../lib/pack-voice";

function pack(dir: string) {
  const puppet = JSON.parse(readFileSync(new URL(`../private/characters/${dir}/puppet.json`, import.meta.url), "utf8")) as unknown;
  const record = {
    id: "chr_test",
    ownerId: "usr_test",
    name: dir,
    personaSheetRef: null,
    views: {},
    puppetUrl: "puppet.json",
    layers: [],
    emotionSheetUrl: null,
    status: "ready",
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
  } as LibraryCharacter;
  return puppetToRig(record, puppet);
}

describe("neutral is the same home for both packs", () => {
  it("starts neutral and does not open a smile by default", () => {
    const real = pack("einstein-realista").views.front;
    const charge = pack("einstein-charge").views.front;
    const home = initialMap();
    for (const view of [real, charge]) {
      const pose = shownPose(home, capsFromView(view, false));
      assert.equal(pose.emotion, "neutral");
      assert.equal(pose.gaze, "center");
      assert.equal(pose.lids, "open");
    }
    assert.equal(stageMouth(real, "neutral", null).layer?.url.includes("neutral"), true);
    assert.equal(stageMouth(real, "neutral", null).layer?.url.includes("happy"), false);
    assert.equal(stageMouth(charge, "neutral", null).layer, undefined);
    assert.equal(charge.mouthVariations?.length, 3);
    assert.equal(charge.mouthVariations?.every((slot) => slot.visemes === null), true);
    assert.equal(Boolean(charge.expressions?.happy), false);
    assert.equal(tagSupported("happy", capsFromView(charge, false)), false);
    assert.equal(tagSupported("happy", capsFromView(real, false)), true);
  });

  it("walks neighboring tags and returns to neutral unless the tag is pinned", () => {
    const real = capsFromView(pack("einstein-realista").views.front, true);
    let state = initialMap();
    state = hoverTag(state, "happy", real);
    assert.equal(shownPose(state, real).emotion, "happy");
    state = hoverTag(state, "sad", real);
    assert.equal(shownPose(state, real).emotion, "sad");
    state = hoverTag(state, "gaze:left", real);
    assert.equal(shownPose(state, real).gaze, "left");
    assert.equal(shownPose(state, real).emotion, "neutral");
    state = leaveMap(state);
    assert.equal(shownPose(state, real).emotion, "neutral");
    assert.equal(shownPose(state, real).gaze, "center");
    state = pinTag(hoverTag(initialMap(), "ironic", real), "ironic", real);
    state = leaveMap(state);
    assert.equal(shownPose(state, real).emotion, "ironic");
    state = pinTag(state, "ironic", real);
    assert.equal(shownPose(state, real).emotion, "neutral");
    const charge = capsFromView(pack("einstein-charge").views.front, false);
    assert.equal(shownPose(hoverTag(initialMap(), "happy", charge), charge).emotion, "neutral");
    assert.equal(emotionTags(charge).some((tag) => tag.id === "happy" && tag.supported), false);
    assert.equal(emotionTags(real).some((tag) => tag.id === "happy" && tag.supported), true);
  });
});

describe("the map stays on the page and off the network", () => {
  it("wires pointer, keyboard, touch, and reduced motion without a model call", () => {
    const screen = readFileSync(new URL("../components/composed-character.tsx", import.meta.url), "utf8");
    const map = readFileSync(new URL("../lib/emotion-map.ts", import.meta.url), "utf8");
    const stage = readFileSync(new URL("../components/avatar-stage.tsx", import.meta.url), "utf8");
    assert.match(screen, /data-testid="emotion-map"/);
    assert.match(screen, /onPointerEnter/);
    assert.match(screen, /onPointerLeave/);
    assert.match(screen, /onPointerDown/);
    assert.match(screen, /onKeyDown/);
    assert.match(screen, /initialMap\(\)/);
    assert.equal(screen.includes('setEmotion("rest")'), false);
    assert.match(stage, /prefers-reduced-motion/);
    assert.equal(map.includes("fetch("), false);
    assert.equal(map.includes("openai"), false);
    assert.equal(screen.includes("/api/avatars"), false);
    assert.equal(translate("en", "neutral"), "Neutral");
    assert.equal(translate("pt-BR", "neutral"), "Neutro");
    assert.equal(translate("en", "unsupportedTag"), "Unavailable");
    assert.equal(translate("pt-BR", "unsupportedTag"), "Indisponível");
    assert.match(screen, /surprised: "Surpreso"/);
    assert.match(screen, /thoughtful: "Thoughtful"/);
  });
});
