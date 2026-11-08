import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { inferCreationPlan } from "../lib/planner";
import { cachedFixturePersona } from "../lib/persona-cache";
import { fixturePersona } from "../lib/persona-sheet";

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
  });
});
