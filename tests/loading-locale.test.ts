import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("loading copy follows the locale", () => {
  it("asks the character list and the library for the loading message", () => {
    for (const file of ["components/my-characters.tsx", "components/biblioteca.tsx"]) {
      const source = readFileSync(file, "utf8");
      const loader = source.slice(source.indexOf("<Loader2"));
      assert.match(loader, /t\("loading"\)/);
    }
  });
});
