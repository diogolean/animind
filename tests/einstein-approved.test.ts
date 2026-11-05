import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { VISEMES } from "../lib/contract";
import { applyApprovedCharacters, approvedEinsteinRig, approvedLibraryCharacter, isApprovedCharacterId, mergeApproved } from "../lib/approved/einstein";
import layout from "../lib/approved/einstein-layout.json";

const root = process.cwd();

async function exists(urlPath: string) {
  assert.ok(urlPath.startsWith("/characters/einstein_approved/"), urlPath);
  await access(path.join(root, "public", urlPath));
}

describe("approved Einstein catalog", () => {
  it("ships the three views, the Rhubarb mouths, and the PT/EN demos", async () => {
    await exists(layout.front);
    await exists(layout.threeQuarterLeft);
    await exists(layout.threeQuarterRight);
    await exists(layout.emotionSheet);
    await exists(layout.emotionSheetEn);
    await exists(layout.voiceEn);
    await exists(layout.demoEn);
    await exists(layout.demoPt);
    await exists("/characters/einstein_approved/dialog_en.txt");
    await exists("/characters/einstein_approved/puppet.json");
    for (const name of VISEMES) await exists(`/characters/einstein_approved/mouths/${name}.png`);
    for (const camera of [layout.views.front, layout.views.left, layout.views.right]) {
      const torso = camera.layers.find((layer) => layer.name === "torso");
      assert.ok(torso, "torso");
      await exists(torso.url);
      for (const name of VISEMES) {
        const box = camera.visemes[name];
        assert.ok(box, name);
        await exists(box.url);
        assert.ok(box.x >= 0 && box.y >= 0, name);
        assert.ok(box.x + box.w <= camera.canvas.w, name);
        assert.ok(box.y + box.h <= camera.canvas.h, name);
      }
    }
    assert.match(layout.views.front.layers.find((layer) => layer.name === "torso")!.url, /\/layers\/front\/torso\.png$/);
    assert.match(layout.views.left.layers.find((layer) => layer.name === "torso")!.url, /\/layers\/three-quarter\/torso\.png$/);
    assert.match(layout.views.right.layers.find((layer) => layer.name === "torso")!.url, /\/layers\/three-quarter-right\/torso\.png$/);
    assert.notEqual(layout.views.left.visemes.D.url, layout.views.front.visemes.D.url);
    assert.notEqual(layout.views.right.visemes.D.url, layout.views.front.visemes.D.url);
    assert.match(layout.dialogEn, /speed of light/);
    assert.doesNotMatch(JSON.stringify(layout), /GOCSPX-|BLOB_READ_WRITE|postgres:\/\/|sk-/);
  });

  it("exposes one catalog character and a different plate for each camera", () => {
    const character = approvedLibraryCharacter();
    assert.equal(character.catalog, true);
    assert.equal(character.name, "Albert Einstein");
    assert.equal(character.views.front, layout.front);
    assert.equal(character.views.three_quarter_left, layout.threeQuarterLeft);
    assert.equal(character.views.three_quarter_right, layout.threeQuarterRight);
    assert.equal(character.layers.length, VISEMES.length);
    assert.equal(character.demos?.find((demo) => demo.id === "voice-en")?.url, layout.voiceEn);
    assert.equal(character.demos?.find((demo) => demo.id === "demo-en")?.url, layout.demoEn);
    assert.equal(character.demos?.find((demo) => demo.id === "demo-pt")?.url, layout.demoPt);

    const rig = approvedEinsteinRig();
    assert.match(rig.views.front.layers.find((layer) => layer.name === "torso")!.url, /\/layers\/front\//);
    assert.match(rig.views.left.layers.find((layer) => layer.name === "torso")!.url, /\/layers\/three-quarter\//);
    assert.match(rig.views.right.layers.find((layer) => layer.name === "torso")!.url, /\/layers\/three-quarter-right\//);
    assert.doesNotMatch(rig.views.left.layers.find((layer) => layer.name === "torso")!.url, /three-quarter-right/);
    for (const name of VISEMES) {
      assert.equal(rig.views.front.visemes[name]?.url, layout.views.front.visemes[name].url);
      assert.equal(rig.views.left.visemes[name]?.url, layout.views.left.visemes[name].url);
      assert.equal(rig.views.right.visemes[name]?.url, layout.views.right.visemes[name].url);
    }

    const merged = mergeApproved([{ ...character, id: "chr_other", name: "Outro", catalog: false }]);
    assert.equal(merged[0]?.id, "chr_other");
    assert.equal(merged.at(-1)?.id, character.id);
    assert.equal(mergeApproved(merged).length, merged.length);
  });

  it("puts the plate back on a mock render and refuses edits", async () => {
    const restored = applyApprovedCharacters([
      {
        id: layout.id,
        name: "Albert Einstein",
        status: "ready",
        style: "rig",
        views: {
          front: { canvas: { w: 1, h: 1 }, layers: [], visemes: {} },
          left: { canvas: { w: 1, h: 1 }, layers: [], visemes: {} },
          right: { canvas: { w: 1, h: 1 }, layers: [], visemes: {} },
        },
        createdAt: layout.createdAt,
      },
    ]);
    assert.equal(restored[0]?.views.front.visemes.D?.url, layout.views.front.visemes.D.url);
    assert.equal(restored[0]?.views.right.visemes.D?.url, layout.views.right.visemes.D.url);
    assert.equal(restored[0]?.views.left.layers.find((layer) => layer.name === "head")?.url, layout.views.left.layers.find((layer) => layer.name === "head")?.url);
    assert.equal(isApprovedCharacterId(layout.id), true);

    const route = await readFile(path.join(root, "app/api/library/[id]/route.ts"), "utf8");
    const approvedRoute = await readFile(path.join(root, "app/api/library/approved/route.ts"), "utf8");
    assert.match(route, /isApprovedCharacterId/);
    assert.match(route, /não pode ser alterado/);
    assert.match(route, /não pode ser apagado/);
    assert.match(approvedRoute, /approvedLibraryCharacter/);
    const mock = await readFile(path.join(root, "lib/mock.ts"), "utf8");
    assert.match(mock, /applyApprovedCharacters\(r\.characters\)/);
  });
});
