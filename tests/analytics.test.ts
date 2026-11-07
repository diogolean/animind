import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { pageLocation, pageTitle, sanitizeEvent, sanitizePath } from "../lib/analytics";

describe("ga4 sanitizer", () => {
  it("keeps an allowlisted path and drops the query", () => {
    assert.equal(sanitizePath("/characters/chr_secret?next=/&prompt=ideia"), "/characters/item");
    assert.equal(sanitizePath("/login?error=google_denied"), "/login");
    assert.equal(sanitizePath("/biblioteca"), "/biblioteca");
    assert.equal(sanitizePath("/admin/gastos"), "/other");
    assert.equal(pageTitle("/characters/item"), "Personagem");
    assert.equal(pageLocation("https://animindly.com", "/"), "https://animindly.com/");
  });

  it("drops unknown events and raw text", () => {
    assert.equal(sanitizeEvent("login", { method: "google" })?.params.method, "google");
    assert.equal(sanitizeEvent("create_attempt", { result: "login_required", prompt: "ideia secreta" })?.params.prompt, undefined);
    assert.equal(sanitizeEvent("access_denied", { reason: "the prompt was hello" }), null);
    assert.equal(sanitizeEvent("page_view", { page_path: "/" }), null);
  });

  it("does not hardcode the measurement id or a GTM container", async () => {
    const layout = await readFile("app/layout.tsx", "utf8");
    const banner = await readFile("components/analytics.tsx", "utf8");
    const config = await readFile("app/api/analytics/config/route.ts", "utf8");
    assert.equal(layout.includes("G-M5DBWNFQVV"), false);
    assert.equal(banner.includes("G-M5DBWNFQVV"), false);
    assert.equal(config.includes("G-M5DBWNFQVV"), false);
    assert.equal(`${layout}${banner}${config}`.includes("GTM-"), false);
    assert.match(banner, /gtag\/js\?id=/);
    assert.match(config, /G-\[A-Z0-9\]\+/);
  });
});
