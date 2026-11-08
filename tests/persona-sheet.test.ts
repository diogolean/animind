import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { presentCoreDebate, presentCoreSheet } from "../lib/avatar-core";
import { inferCreationPlan } from "../lib/planner";
import { cachedFixturePersona } from "../lib/persona-cache";
import { fixturePersona, sheetForScreen } from "../lib/persona-sheet";

const WIKI = /^https:\/\/(?:[a-z0-9-]+\.)?wiki(?:pedia|quote|source)\.org\/wiki\/\S+$/;

describe("verified persona fixture", () => {
  it("attaches a labeled sheet to a free English name and leaves an unknown name alone", () => {
    const plan = inferCreationPlan("Socrates explains wonder", "en-US");
    assert.equal(plan.language, "en-US");
    assert.equal(plan.characters[0]?.name, "Socrates");
    assert.match(plan.characters[0]?.prompt ?? "", /https:\/\/pt\.wikiquote\.org\/wiki\//);
    const sheet = plan.personaSheets?.[0];
    assert.equal(sheet?.source, "fixture");
    assert.equal(sheet?.found, true);
    assert.ok(sheet && sheet.quotes.length > 0);
    for (const quote of sheet?.quotes ?? []) {
      assert.match(quote.url, WIKI);
      assert.equal(quote.text.length > 0, true);
    }
    const unknown = inferCreationPlan("Ada explains circuits", "en-US");
    assert.equal(unknown.personaSheets, undefined);
    assert.equal(unknown.characters[0]?.prompt.includes("wikiquote.org"), false);
    const pair = inferCreationPlan("A talk between Socrates and Nietzsche about courage", "en-US");
    assert.deepEqual(pair.personaSheets?.map((item) => item.name), ["Sócrates", "Nietzsche"]);
  });

  it("serves the fixture from a file cache and does not call a provider", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "animind-persona-"));
    process.env.ANIMINDLY_DATA_DIR = dir;
    process.env.ANIMINDLY_SKIP_ENV_FILE = "1";
    const first = await cachedFixturePersona("Sócrates");
    assert.equal(first.source, "fixture");
    const file = path.join(dir, "persona-cache", `${first.cacheKey}.json`);
    const cached = JSON.parse(await readFile(file, "utf8")) as { license?: string; cacheKey: string };
    cached.license = "cached-fixture";
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, JSON.stringify(cached));
    const second = await cachedFixturePersona("socrates, de toga");
    assert.equal(second.license, "cached-fixture");
    assert.equal(second.cacheKey, first.cacheKey);
    assert.equal(fixturePersona("nobody").found, false);
    const route = await readFile("app/api/personas/sheet/route.ts", "utf8");
    assert.match(route, /if \(coreMode\(\) !== "core"\) return fixtureResponse/);
    assert.equal(route.includes("coreFetch"), false);
    assert.equal(route.includes("guardedGeneration"), false);
    assert.match(route, /presentCoreSheet/);
    assert.match(route, /coreUserHeader/);
  });

  it("shows fixture quotes for a known name and invents none for an unknown name", () => {
    const sheet = sheetForScreen(fixturePersona("Socrates"));
    assert.equal(sheet?.source, "fixture");
    assert.equal(sheet?.found, true);
    assert.ok(sheet && sheet.quotes.length > 0);
    for (const quote of sheet?.quotes ?? []) {
      assert.equal(quote.verification, "verified");
      assert.equal(quote.text.length > 0, true);
      assert.equal(quote.source.length > 0, true);
      assert.match(quote.url, WIKI);
    }
    assert.equal(sheetForScreen(fixturePersona("Albert Einstein")), null);
    const plan = inferCreationPlan("Albert Einstein explains relativity", "en-US");
    assert.equal(plan.personaSheets, undefined);
    assert.equal(JSON.stringify(plan).includes("wikiquote.org"), false);
    const studio = readFileSync(new URL("../components/creation-studio.tsx", import.meta.url), "utf8");
    assert.match(studio, /\/api\/personas\/sheet/);
    assert.match(studio, /sheetForScreen/);
    assert.match(studio, /data-source=\{sheet\.source\}/);
    assert.match(studio, /data-testid="persona-quote-url"/);
    assert.match(studio, /data-testid="persona-quote-source"/);
  });

  it("never speaks or cites a quote marked not_found", () => {
    const missing = "This sentence was not found and must not be spoken.";
    const spoken = presentCoreDebate({
      id: "abc123def456",
      theme: "wonder",
      language: "en",
      writer: "fixture",
      llm: { provider: "fixture", model: "fixture", live: false },
      lines: [
        {
          speaker: 0,
          name: "Ada",
          text: missing,
          kind: "quote",
          quote: {
            id: "q9",
            text: missing,
            source: "Wikiquote",
            url: "https://en.wikiquote.org/wiki/Ada",
            verification: "not_found",
          },
        },
      ],
    });
    assert.equal(spoken?.lines[0]?.text, null);
    assert.equal(spoken?.lines[0]?.source, null);
    assert.equal(spoken?.lines[0]?.url, null);
    assert.equal(JSON.stringify(spoken).includes(missing), false);
    const cited = presentCoreSheet({
      name: "Ada",
      found: true,
      fixture: "labeled",
      quotes: [
        { id: "q1", text: "A labeled fixture quote.", source: "Wikiquote", url: "https://pt.wikiquote.org/wiki/Ada", verification: "verified" },
        { id: "q2", text: missing, source: "Wikiquote", url: "https://pt.wikiquote.org/wiki/Ada", verification: "not_found" },
      ],
    });
    assert.equal(cited?.quotes.length, 1);
    assert.equal(cited?.quotes[0]?.verification, "verified");
    assert.equal(JSON.stringify(cited).includes(missing), false);
    const screen = sheetForScreen({
      name: "Ada",
      found: true,
      source: "fixture",
      quotes: [
        { id: "q1", text: "A labeled fixture quote.", source: "Wikiquote", url: "https://pt.wikiquote.org/wiki/Ada", verification: "verified" },
        { id: "q2", text: missing, source: "Wikiquote", url: "https://pt.wikiquote.org/wiki/Ada", verification: "not_found" },
      ],
    });
    assert.deepEqual(screen?.quotes.map((quote) => quote.text), ["A labeled fixture quote."]);
    assert.equal(JSON.stringify(screen).includes(missing), false);
  });
});
