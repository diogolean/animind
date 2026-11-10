import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const header = readFileSync(new URL("../components/site-header.tsx", import.meta.url), "utf8");

describe("site header health", () => {
  it("drops a health response that belongs to an older locale", () => {
    assert.match(header, /let current = true;[\s\S]*if \(!current\) return;[\s\S]*current = false;/);
  });
});
