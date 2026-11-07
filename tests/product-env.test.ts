import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { productEnv } from "../lib/product-env";

const KEYS = ["ANIMINDLY_AUTH_SECRET", "ANIMIND_AUTH_SECRET", "ANIMINDLY_CORE_URL", "ANIMIND_CORE_URL"];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("productEnv", () => {
  it("prefers ANIMINDLY_ and falls back to ANIMIND_ when the new name is blank", () => {
    process.env.ANIMIND_AUTH_SECRET = "legacy-secret-value";
    assert.equal(productEnv("AUTH_SECRET"), "legacy-secret-value");
    process.env.ANIMINDLY_AUTH_SECRET = "   ";
    assert.equal(productEnv("AUTH_SECRET"), "legacy-secret-value");
    process.env.ANIMINDLY_AUTH_SECRET = "new-secret-value!!";
    assert.equal(productEnv("AUTH_SECRET"), "new-secret-value!!");
  });

  it("returns undefined when both names are unset", () => {
    assert.equal(productEnv("CORE_URL"), undefined);
  });
});
