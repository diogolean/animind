import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { CharacterView } from "../lib/contract";
import { envelopeViseme, envelopeVisemes, packVoiceUrls, stageMouth, viewHasMouth } from "../lib/pack-voice";

const charge = {
  id: "voice_en.mp3",
  label: "voice_en.mp3",
  kind: "audio" as const,
  url: "/voice_en.mp3",
};
const english = { id: "demo/einstein_en.mp4", label: "einstein_en.mp4", kind: "video" as const, url: "/einstein_en.mp4" };
const portuguese = { id: "demo/einstein_pt.mp4", label: "einstein_pt.mp4", kind: "video" as const, url: "/einstein_pt.mp4" };

describe("pack voice", () => {
  it("maps silence to rest and loudness to the studio mouth shapes", () => {
    assert.equal(envelopeViseme(0), "X");
    assert.equal(envelopeViseme(0.1), "A");
    assert.equal(envelopeViseme(0.3), "B");
    assert.equal(envelopeViseme(0.5), "C");
    assert.equal(envelopeViseme(0.8), "D");
    assert.deepEqual(envelopeVisemes([0, 0.8]), ["X", "D"]);
  });

  it("uses the pack audio and does not invent a voice when the folder has none", () => {
    assert.deepEqual(packVoiceUrls(undefined, "en"), []);
    assert.deepEqual(packVoiceUrls([], "pt-BR"), []);
    assert.deepEqual(packVoiceUrls([charge, english, portuguese], "en"), ["/voice_en.mp3"]);
    assert.deepEqual(packVoiceUrls([charge, english, portuguese], "pt-BR"), ["/einstein_pt.mp4", "/voice_en.mp3"]);
  });

  it("keeps rest on X and swaps in a speaking sprite without replacing an expression", () => {
    const view: CharacterView = {
      canvas: { w: 10, h: 10 },
      layers: [],
      visemes: {
        X: { name: "mouth", url: "X.png", x: 0, y: 9, w: 1, h: 1, z: 1 },
        D: { name: "mouth", url: "D.png", x: 0, y: 8, w: 2, h: 2, z: 2 },
      },
      expressions: { happy: { name: "happy", url: "happy.png", x: 0, y: 0, w: 1, h: 1, z: 3 } },
    };
    assert.equal(viewHasMouth(view), true);
    assert.equal(viewHasMouth({ canvas: { w: 1, h: 1 }, layers: [], visemes: {} }), false);
    assert.equal(stageMouth(view, "rest", null).layer?.url, "X.png");
    assert.equal(stageMouth(view, "rest", null).speaking, false);
    assert.equal(stageMouth(view, "rest", "D").layer?.url, "D.png");
    assert.equal(stageMouth(view, "rest", "D").speaking, true);
    assert.equal(stageMouth(view, "happy", "D").layer?.url, "happy.png");
    assert.equal(stageMouth(view, "happy", "D").speaking, false);
  });

  it("does not start an avatar or a video render from the sheet", () => {
    const sheet = readFileSync(new URL("../components/composed-character.tsx", import.meta.url), "utf8");
    const player = readFileSync(new URL("../components/pack-voice.tsx", import.meta.url), "utf8");
    const stage = readFileSync(new URL("../components/avatar-stage.tsx", import.meta.url), "utf8");
    for (const source of [sheet, player, stage]) {
      assert.equal(source.includes("/api/avatars"), false);
      assert.equal(source.includes("/api/render"), false);
      assert.equal(source.includes("startRender"), false);
    }
    assert.match(sheet, /PackVoice/);
    assert.match(player, /packVoiceMissing/);
    assert.match(player, /packMouthMissing/);
    assert.match(stage, /stageMouth/);
  });
});
