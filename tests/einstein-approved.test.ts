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
  it("ships the pack from public files and keeps every mouth inside the plate", async () => {
    await exists(layout.front);
    await exists(layout.body);
    await exists(layout.emotionSheet);
    await exists(layout.emotionSheetEn);
    await exists(layout.voiceEn);
    await exists(layout.demoEn);
    await exists(layout.demoPt);
    await exists("/characters/einstein_approved/dialog_en.txt");
    await exists("/characters/einstein_approved/puppet.json");
    for (const name of VISEMES) {
      const box = layout.visemes[name as keyof typeof layout.visemes];
      assert.ok(box, name);
      await exists(box.url);
      assert.ok(box.x >= 0 && box.y >= 0, name);
      assert.ok(box.x + box.w <= layout.canvas.w, name);
      assert.ok(box.y + box.h <= layout.canvas.h, name);
    }
    assert.match(layout.dialogEn, /speed of light/);
    assert.doesNotMatch(JSON.stringify(layout), /GOCSPX-|BLOB_READ_WRITE|postgres:\/\/|sk-/);
  });

  it("exposes one catalog character with the approved rig on every camera", () => {
    const character = approvedLibraryCharacter();
    assert.equal(character.catalog, true);
    assert.equal(character.name, "Albert Einstein");
    assert.equal(character.views.front, layout.front);
    assert.equal(character.layers.length, VISEMES.length);
    assert.equal(character.demos?.find((demo) => demo.id === "voice-en")?.url, layout.voiceEn);
    assert.equal(character.demos?.find((demo) => demo.id === "demo-en")?.url, layout.demoEn);

    const rig = approvedEinsteinRig();
    for (const view of [rig.views.front, rig.views.left, rig.views.right]) {
      assert.equal(view.layers[0]?.url, layout.body);
      for (const name of VISEMES) assert.equal(view.visemes[name]?.url, layout.visemes[name].url);
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
    assert.equal(restored[0]?.views.front.visemes.D?.url, layout.visemes.D.url);
    assert.equal(restored[0]?.views.right.layers[0]?.url, layout.body);
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
