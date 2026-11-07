import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

describe("Einstein routes stay private", () => {
  it("does not merge a public catalog into the library or the character page", async () => {
    const library = await readFile(path.join(root, "app/api/library/route.ts"), "utf8");
    const approved = await readFile(path.join(root, "app/api/library/approved/route.ts"), "utf8");
    const detail = await readFile(path.join(root, "app/api/library/[id]/route.ts"), "utf8");
    const page = await readFile(path.join(root, "components/my-characters.tsx"), "utf8");
    const mock = await readFile(path.join(root, "lib/mock.ts"), "utf8");
    assert.doesNotMatch(library, /mergeApproved|approvedLibraryCharacter/);
    assert.match(approved, /requireUser/);
    assert.doesNotMatch(approved, /approvedLibraryCharacter|einstein_approved/);
    assert.doesNotMatch(detail, /approvedEinsteinRig|isApprovedCharacterId/);
    assert.match(detail, /requireUser/);
    assert.doesNotMatch(page, /\/api\/library\/approved/);
    assert.doesNotMatch(mock, /applyApprovedCharacters/);
  });
});
