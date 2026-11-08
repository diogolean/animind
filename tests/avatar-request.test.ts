import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { addAvatarParticipant, avatarAttemptKey, avatarIssues, inferAvatarPlan, toggleAvatarParticipant } from "../lib/avatar-plan";
import { avatarJobReady, cancelAvatarAttempt, decideAvatarRequest, memoryAvatarStore } from "../lib/avatar-batch";
import { AVATAR_PAID_CALLS_AUTHORIZED } from "../lib/avatar-provider";
import { abortAvatarProgress, applyAvatarEvent, avatarBatchShape, avatarJobFeedback, avatarRunning, costIsReportedZero, emptyAvatarProgress } from "../lib/avatar-progress";
import { fill, translate } from "../lib/i18n";

describe("avatar plan", () => {
  it("reads one speaker for a monologue, a presentation, and a speech", () => {
    for (const prompt of ["A monologue by Ada about time", "Ada presents the library", "A speech by Ada Lovelace"]) {
      const plan = inferAvatarPlan(prompt, "en-US");
      assert.equal(plan.defaultCount, 1);
      assert.equal(plan.participants.length, 1);
      assert.match(plan.participants[0].name, /Ada/);
      assert.equal(plan.participants.some((person) => /library/i.test(person.name)), false);
      assert.deepEqual(avatarIssues(plan), []);
    }
    const portuguese = inferAvatarPlan("Uma apresentação de Marie Curie", "pt-BR");
    assert.equal(portuguese.intent, "presentation");
    assert.equal(portuguese.participants[0]?.name, "Marie Curie");
  });

  it("keeps a debate at two people and does not invent the missing one", () => {
    const missing = inferAvatarPlan("A debate with Ada", "en-US");
    assert.equal(missing.defaultCount, 2);
    assert.deepEqual(missing.participants.map((person) => person.name), ["Ada"]);
    assert.equal(missing.participants.some((person) => person.name === "Guest"), false);
    assert.ok(avatarIssues(missing).includes("second-identity"));
    const added = addAvatarParticipant(missing, "Grace Hopper");
    assert.deepEqual(avatarIssues(added), []);
    assert.deepEqual(added.participants.map((person) => person.name), ["Ada", "Grace Hopper"]);
  });

  it("keeps every named person when a debate names more than two", () => {
    const plan = inferAvatarPlan("A debate between Socrates, Plato and Aristotle about truth", "en-US");
    assert.deepEqual(plan.participants.map((person) => person.name), ["Socrates", "Plato", "Aristotle"]);
    assert.equal(plan.context, "truth");
    assert.ok(avatarIssues(plan).includes("selection"));
    const chosen = ["socrates", "plato"].reduce((current, id) => toggleAvatarParticipant(current, id), plan);
    assert.deepEqual(avatarIssues(chosen), []);
    assert.equal(chosen.participants.length, 3);
    assert.deepEqual(chosen.selectedIds, ["socrates", "plato"]);
  });

  it("does not turn scenery or a topic into a person", () => {
    const scenery = inferAvatarPlan("A debate between the library and the podium", "en-US");
    assert.deepEqual(scenery.participants, []);
    assert.ok(avatarIssues(scenery).includes("speaker"));
    const one = inferAvatarPlan("Socrates debates the library about courage", "en-US");
    assert.deepEqual(one.participants.map((person) => person.name), ["Socrates"]);
    assert.ok(avatarIssues(one).includes("second-identity"));
    assert.equal(addAvatarParticipant(one, "library"), one);
  });

  it("defaults to 1K and does not treat the word premium as an entitlement", () => {
    const premium = inferAvatarPlan("A premium speech by Ada", "en-US");
    assert.equal(premium.requestedResolution, "1k");
    const asked = inferAvatarPlan("A speech by Ada in 4K", "en-US");
    assert.equal(asked.requestedResolution, "4k");
    assert.ok(avatarIssues(asked).includes("resolution"));
    assert.equal(avatarAttemptKey(asked.prompt, ["Ada"]).includes("Ada"), false);
  });
});

describe("avatar confirmation", () => {
  it("refuses before any provider call, reuses an owned avatar, and stays idempotent", () => {
    assert.equal(AVATAR_PAID_CALLS_AUTHORIZED, false);
    const store = memoryAvatarStore();
    let calls = 0;
    const library = [{ id: "chr_ada", ownerId: "usr_a", name: "Ada", status: "ready" }];
    const first = decideAvatarRequest({
      ownerId: "usr_a",
      generationEnabled: true,
      prompt: "A debate between Ada and Grace",
      library,
      store,
      requestId: "req_first",
      onProvider: () => { calls += 1; },
    });
    assert.equal(calls, 0);
    assert.equal(first.status, 403);
    assert.equal("jobs" in first.body && first.body.outcome, "partial");
    if (!("jobs" in first.body)) return;
    assert.equal(first.body.cost, "unknown");
    assert.equal(costIsReportedZero(first.body.cost), false);
    assert.equal(first.body.providerCalls, 0);
    assert.equal(first.body.providerFunction, null);
    assert.equal(first.body.jobs[0]?.disposition, "reused");
    assert.equal(first.body.jobs[0]?.stage, "plan");
    assert.equal(first.body.jobs[1]?.disposition, "blocked");
    assert.equal(first.body.fixture, false);
    const again = decideAvatarRequest({
      ownerId: "usr_a",
      generationEnabled: true,
      prompt: "A debate between Ada and Grace",
      library,
      store,
      requestId: "req_second",
      onProvider: () => { calls += 1; },
    });
    assert.equal(calls, 0);
    assert.equal("requestId" in again.body && again.body.requestId, "req_first");
    const cancelled = cancelAvatarAttempt(store, "usr_a", "req_first");
    assert.equal(cancelled?.jobs[1]?.disposition, "cancelled");
    assert.equal(cancelled?.jobs[0]?.disposition, "reused");
    assert.equal(cancelled?.providerCalls, 0);
    assert.equal(store.find("usr_b", "req_first"), undefined);
  });

  it("does not grant 4K or a generation from the browser, and does not mark a blocked plate ready", () => {
    const store = memoryAvatarStore();
    const denied = decideAvatarRequest({
      ownerId: "usr_a",
      generationEnabled: false,
      prompt: "A speech by Ada",
      library: [],
      store,
      requestId: "req_off",
    });
    assert.equal(denied.status, 403);
    assert.equal("code" in denied.body && denied.body.code, "unapproved");
    assert.equal(store.find("usr_a", "req_off"), undefined);
    const four = decideAvatarRequest({
      ownerId: "usr_a",
      generationEnabled: true,
      prompt: "A speech by Ada in 4K",
      library: [],
      store,
      requestId: "req_4k",
    });
    assert.equal(four.status, 403);
    assert.equal("code" in four.body && four.body.code, "resolution_unavailable");
    assert.equal(store.find("usr_a", "req_4k"), undefined);
    const stranger = decideAvatarRequest({
      ownerId: "usr_a",
      generationEnabled: true,
      prompt: "A speech by Ada",
      library: [{ id: "chr_other", ownerId: "usr_b", name: "Ada", status: "ready" }],
      store,
      requestId: "req_block",
    });
    if (!("jobs" in stranger.body)) return assert.fail("expected jobs");
    assert.equal(stranger.body.jobs[0]?.disposition, "blocked");
    assert.equal(avatarJobReady({ ...stranger.body.jobs[0], requestedResolution: "1k" }), false);
    assert.equal(avatarJobReady({
      stage: "ready",
      actual: { width: 3840, height: 2160, provenance: "upscale" },
      qa: { passed: true },
      rig: { id: "rig" },
      requestedResolution: "4k",
    }), false);
  });
});

describe("avatar progress", () => {
  it("moves only on a real later event and labels a fixture without calling it a real image", () => {
    let view = emptyAvatarProgress();
    view = applyAvatarEvent(view, { requestId: "req_a", index: 0, stage: "image", fixture: true, percent: 40 });
    view = applyAvatarEvent(view, { requestId: "req_a", index: 0, stage: "image", fixture: true });
    view = applyAvatarEvent(view, { requestId: "req_b", index: 0, stage: "ready", fixture: false });
    assert.equal(view.stages[0], "image");
    view = applyAvatarEvent(view, { requestId: "req_a", index: 0, stage: "fail", fixture: false });
    view = applyAvatarEvent(view, { requestId: "req_a", index: 0, stage: "queued", fixture: false });
    assert.equal(view.stages[0], "fail");
    view = abortAvatarProgress(view);
    view = applyAvatarEvent(view, { requestId: "req_a", index: 1, stage: "ready", fixture: false });
    assert.equal(view.stages[1], undefined);
    const line = fill(translate("en", avatarJobFeedback({ name: "Ada", disposition: "blocked", stage: "image", fixture: true }).key), { stage: "image" });
    assert.match(line, /Fixture/);
    assert.equal(line.includes("%"), false);
    assert.equal(line.toLowerCase().includes("generating"), false);
    assert.equal(avatarRunning({ 0: "image" }, "automatic"), true);
    assert.equal(avatarRunning({ 0: "plan" }, "automatic"), false);
    assert.equal(avatarBatchShape([{ disposition: "reused" }, { disposition: "blocked" }]), "partial");
    assert.equal(costIsReportedZero("unknown"), false);
    assert.equal(costIsReportedZero(0), true);
  });
});

describe("avatar routes", () => {
  it("keeps the avatar confirmation off the provider and the download on the owner", () => {
    const route = readFileSync(new URL("../app/api/avatars/route.ts", import.meta.url), "utf8");
    const button = readFileSync(new URL("../components/avatar-request.tsx", import.meta.url), "utf8");
    const studio = readFileSync(new URL("../components/creation-studio.tsx", import.meta.url), "utf8");
    const files = readFileSync(new URL("../app/api/files/[...path]/route.ts", import.meta.url), "utf8");
    assert.equal(route.includes("coreFetch"), false);
    assert.equal(route.includes("guardedGeneration"), false);
    assert.equal(route.includes("startRender"), false);
    assert.equal(route.includes("premium"), false);
    assert.equal(button.includes("startRender"), false);
    assert.equal(button.includes("createCharacter"), false);
    assert.equal(button.includes("Loader2"), false);
    assert.equal(button.includes("sessionStorage"), false);
    assert.equal(button.includes("opacity-25"), false);
    assert.match(button, /text-white/);
    assert.match(button, /waitingForSignIn/);
    assert.match(button, /setTimeout/);
    assert.equal(button.includes("requestId"), false);
    assert.equal(studio.includes("animindly-generate"), false);
    assert.match(studio, /AvatarRequest/);
    assert.match(studio, /setAwaitingSignIn\(true\)/);
    assert.ok(files.indexOf("ownsResource") < files.indexOf("coreFetch"));
  });
});
