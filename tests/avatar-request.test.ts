import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { addAvatarParticipant, avatarAttemptKey, avatarIssues, inferAvatarPlan, toggleAvatarParticipant } from "../lib/avatar-plan";
import { avatarJobReady, cancelAvatarAttempt, decideAvatarRequest, memoryAvatarStore } from "../lib/avatar-batch";
import { AVATAR_PAID_CALLS_AUTHORIZED } from "../lib/avatar-provider";
import { realAvatarCall } from "../lib/accounts/generation-policy";
import { abortAvatarProgress, applyAvatarEvent, avatarBatchShape, avatarJobFeedback, avatarRunning, costIsReportedZero, emptyAvatarProgress, foldAvatarEvents } from "../lib/avatar-progress";
import { avatarReconnect, avatarTransport, coreAvatarIdentity, coreSpendMicro, labelOfflineAttempt, mapCoreAvatar, mapCoreStage, mapPuppetAvatar, presentCoreDebate, presentCorePayload, presentCoreSheet, presentCoreUsage, presentDebateCreated, presentDebateResponse, presentPlanUsage, promptForCore, rememberAvatarPoll, rememberedAvatarPoll, sanitizeAvatarError } from "../lib/avatar-core";
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

  it("names both people when the prompt says who debates whom", () => {
    const english = inferAvatarPlan("Socrates and Nietzsche debate wonder");
    assert.equal(english.language, "en-US");
    assert.deepEqual(english.participants.map((person) => person.name), ["Socrates", "Nietzsche"]);
    assert.deepEqual(avatarIssues(english), []);
    const portuguese = inferAvatarPlan("Sócrates e Nietzsche debatem sobre a verdade");
    assert.equal(portuguese.language, "pt-BR");
    assert.equal(portuguese.context, "a verdade");
    assert.deepEqual(portuguese.participants.map((person) => person.name), ["Sócrates", "Nietzsche"]);
    assert.deepEqual(avatarIssues(portuguese), []);
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
    assert.match(line, /Preview/);
    assert.equal(/fixture/i.test(line), false);
    assert.equal(line.includes("%"), false);
    assert.equal(line.toLowerCase().includes("generating"), false);
    assert.equal(avatarRunning({ 0: "image" }, "automatic"), true);
    assert.equal(avatarRunning({ 0: "plan" }, "automatic"), false);
    assert.equal(avatarBatchShape([{ disposition: "reused" }, { disposition: "blocked" }]), "partial");
    assert.equal(costIsReportedZero("unknown"), false);
    assert.equal(costIsReportedZero(0), true);
  });
});

describe("avatar core contract", () => {
  const blockedPayload = {
    id: "abc123def456",
    requestId: "abc123def456",
    status: "blocked",
    progress: 40,
    story: "once upon a time",
    liveImage: false,
    charged: false,
    providerCalls: 0,
    costUsd: null,
    tokens: null,
    plan: { prompt: "Discurso de Ada sobre o mar", fixture: "plan", personas: ["Ada"] },
    participants: [{ name: "Ada", status: "blocked", idempotency: "aaaaaaaaaaaaaaaa" }],
    events: [
      { stage: "plan", status: "ready", participant: null, requestId: "abc123def456" },
      { stage: "queued", status: "ready", participant: null, requestId: "abc123def456" },
      { stage: "fail", status: "fail", participant: null, requestId: "abc123def456", blockedBefore: "image generation", error: { code: "generation_not_authorized", recoverable: true } },
      { stage: "image generation", status: "ready", participant: null, requestId: "abc123def456" },
    ],
  };

  it("maps the core blocked payload without a percent, a path, or a provider call", () => {
    assert.equal(mapCoreStage("QA"), "qa");
    assert.equal(mapCoreStage("image generation"), null);
    assert.equal(mapCoreStage("story"), null);
    assert.equal(avatarTransport("core"), "core");
    assert.equal(avatarTransport("off"), "fixture");
    assert.equal(avatarTransport("mock"), "fixture");
    const mapped = mapCoreAvatar(blockedPayload, "usr_a");
    assert.ok(mapped);
    assert.equal(mapped?.code, "generation_not_authorized");
    assert.equal(mapped?.transport, "core");
    assert.equal(mapped?.fixture, true);
    const priced = mapCoreAvatar({
      ...blockedPayload,
      plan: { ...blockedPayload.plan, resolution: { prices: { "1K": { usdPerImage: 0.039, model: "gemini-2.5-flash-image", where: "production/cost/pricing.py" } } } },
      events: blockedPayload.events.map((event, index) => index === 2 ? { ...event, error: { code: "price_unavailable", recoverable: true }, blockedBefore: "image generation" } : event),
    }, "usr_a");
    assert.equal(priced?.code, "price_unavailable");
    assert.equal(priced?.transport, "core");
    assert.deepEqual(priced?.events?.map((event) => event.stage), ["plan", "queued", "fail"]);
    assert.equal(priced?.jobs[0]?.stage, "fail");
    const pricedText = JSON.stringify(priced);
    assert.equal(pricedText.includes("0.039"), false);
    assert.equal(pricedText.includes("gemini"), false);
    assert.equal(pricedText.includes("production/cost"), false);
    assert.equal(pricedText.includes("image generation"), false);
    const sheet = presentCoreSheet({
      name: "Ada",
      found: true,
      owner: "abc123hashowner",
      fixture: "labeled",
      quotes: [{ id: "q1", text: "A labeled fixture quote.", source: "Wikiquote", url: "https://pt.wikiquote.org/wiki/Ada", verification: "verified" }],
    });
    assert.equal(sheet?.source, "core-fixture");
    assert.equal(sheet?.found, true);
    assert.equal(sheet?.quotes[0]?.verification, "verified");
    assert.equal(sheet?.quotes[0]?.url, "https://pt.wikiquote.org/wiki/Ada");
    assert.equal(JSON.stringify(sheet).includes("abc123hashowner"), false);
    assert.equal(JSON.stringify(sheet).includes("owner"), false);
    const pricedNull = mapCoreAvatar({
      ...blockedPayload,
      costUsd: null,
      plan: { resolution: { prices: null, usdPerImage: null } },
    }, "usr_a");
    assert.equal(pricedNull?.cost, "unknown");
    assert.equal(costIsReportedZero(pricedNull?.cost), false);
    assert.equal(JSON.stringify(pricedNull).includes("usdPerImage"), false);
    assert.equal(JSON.stringify(pricedNull).includes("$0"), false);
    assert.equal(JSON.stringify(pricedNull).includes("costUsd"), false);
    const leaked = presentCoreSheet({
      name: "Ada",
      found: true,
      quotes: [{ id: "q1", text: "users/secret", source: "labeled fixture", url: "https://pt.wikiquote.org/wiki/Ada", verification: "verified" }],
    });
    assert.equal(leaked?.quotes.length, 0);
    assert.equal(leaked?.found, false);
    assert.equal(mapped?.cost, "unknown");
    assert.equal(costIsReportedZero(mapped?.cost), false);
    assert.equal(mapped?.providerCalls, 0);
    assert.equal(mapped?.usage, null);
    assert.equal(mapped?.providerFunction, null);
    assert.equal(mapped?.keepsDraft, true);
    assert.equal("progress" in (mapped ?? {}), false);
    assert.deepEqual(mapped?.events?.map((event) => event.stage), ["plan", "queued", "fail"]);
    const text = JSON.stringify(mapped);
    assert.equal(text.includes("sobre o mar"), false);
    assert.equal(text.includes("40"), false);
    assert.equal(text.includes("image generation"), false);
    assert.equal(text.includes("costUsd"), false);
    assert.equal(text.includes("tokens"), false);
    let view = foldAvatarEvents(emptyAvatarProgress(), mapped, false);
    view = foldAvatarEvents(view, mapped, false);
    assert.equal(view.stages[0], "fail");
    view = foldAvatarEvents(view, { ...mapped!, events: [{ index: 0, stage: "queued", fixture: true }] }, false);
    assert.equal(view.stages[0], "fail");
    const aborted = foldAvatarEvents(view, mapped, true);
    assert.equal(aborted.aborted, true);
    const ignored = foldAvatarEvents(aborted, { ...mapped!, events: [{ index: 0, stage: "ready", fixture: true }] }, false);
    assert.equal(ignored.stages[0], "fail");
    assert.equal(sanitizeAvatarError({ code: "users/secret", recoverable: true }), null);
    assert.deepEqual(sanitizeAvatarError({ code: "generation_not_authorized", recoverable: true }), { code: "generation_not_authorized", recoverable: true });
  });

  it("keeps a partial avatar and does not leak another account's poll", () => {
    const partial = mapCoreAvatar({
      id: "abc123def456",
      requestId: "abc123def456",
      status: "partial",
      progress: null,
      liveImage: false,
      fixture: "plate",
      providerCalls: 0,
      charged: false,
      participants: [
        { name: "Ada", status: "ready", idempotency: "aaaaaaaaaaaaaaaa" },
        { name: "Bento", status: "rejected", idempotency: "bbbbbbbbbbbbbbbb" },
      ],
      events: [
        { stage: "plan", status: "ready", participant: null, requestId: "abc123def456" },
        { stage: "queued", status: "ready", participant: null, requestId: "abc123def456" },
        { stage: "cutout", status: "ready", participant: "aaaaaaaaaaaaaaaa", requestId: "abc123def456" },
        { stage: "QA", status: "ready", participant: "aaaaaaaaaaaaaaaa", requestId: "abc123def456" },
        { stage: "save", status: "ready", participant: "aaaaaaaaaaaaaaaa", requestId: "abc123def456" },
        { stage: "ready", status: "ready", participant: "aaaaaaaaaaaaaaaa", requestId: "abc123def456" },
        { stage: "cutout", status: "ready", participant: "bbbbbbbbbbbbbbbb", requestId: "abc123def456" },
        { stage: "QA", status: "fail", participant: "bbbbbbbbbbbbbbbb", requestId: "abc123def456", error: { code: "qa_rejected", recoverable: true } },
        { stage: "save", status: "ready", participant: "bbbbbbbbbbbbbbbb", requestId: "abc123def456" },
        { stage: "fail", status: "fail", participant: "bbbbbbbbbbbbbbbb", requestId: "abc123def456" },
      ],
    }, "usr_a");
    assert.equal(partial?.outcome, "partial");
    assert.equal(partial?.keepsDraft, true);
    assert.equal(partial?.jobs[0]?.stage, "ready");
    assert.equal(partial?.jobs[1]?.stage, "fail");
    const view = foldAvatarEvents(emptyAvatarProgress(), partial, false);
    assert.equal(view.stages[0], "ready");
    assert.equal(view.stages[1], "fail");
    const hidden = presentCorePayload(404, { detail: "Ada users/owner/avatars/secret costUsd", prompt: "Discurso de Ada" }, "usr_b");
    assert.equal(hidden.status, 404);
    const hiddenText = JSON.stringify(hidden.body);
    assert.equal(hiddenText.includes("Ada"), false);
    assert.equal(hiddenText.includes("users/"), false);
    assert.equal(hiddenText.includes("costUsd"), false);
    assert.equal(hiddenText.includes("Discurso"), false);
  });

  it("reconnects with the same GET and labels an offline attempt as a fixture", () => {
    const spec = avatarReconnect("abc123def456");
    assert.deepEqual(spec, { method: "GET", path: "/api/avatars?requestId=abc123def456" });
    assert.deepEqual(avatarReconnect("abc123def456"), spec);
    assert.equal(avatarReconnect("ada@example.com"), null);
    assert.equal(avatarReconnect("users/secret"), null);
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
    };
    rememberAvatarPoll(storage, "abc123def456");
    rememberAvatarPoll(storage, "abc123def456");
    assert.equal(rememberedAvatarPoll(storage), "abc123def456");
    assert.equal(memory.size, 1);
    const store = memoryAvatarStore();
    const made = decideAvatarRequest({
      ownerId: "usr_a",
      generationEnabled: true,
      prompt: "A speech by Ada",
      library: [],
      store,
      requestId: "req_offline",
    });
    if (!("jobs" in made.body)) return assert.fail("expected jobs");
    const labeled = labelOfflineAttempt(made.body);
    assert.equal(labeled.fixture, true);
    assert.equal(labeled.jobs[0]?.stage, "fail");
    assert.deepEqual(labeled.events?.map((event) => event.stage), ["plan", "fail"]);
    assert.equal(labeled.providerCalls, 0);
    assert.equal(labeled.providerFunction, null);
    assert.equal(labeled.keepsDraft, true);
    assert.equal(JSON.stringify(labeled).includes("image"), false);
    const again = decideAvatarRequest({
      ownerId: "usr_a",
      generationEnabled: true,
      prompt: "A speech by Ada",
      library: [],
      store,
      requestId: "req_other",
    });
    assert.equal("requestId" in again.body && again.body.requestId, "req_offline");
    assert.equal(promptForCore("A debate about truth", ["Ada", "Grace"]), "A debate about truth\nAda, Grace");
    assert.equal(promptForCore("A speech by Ada", ["Ada"]), "A speech by Ada");
  });
});

describe("avatar routes", () => {
  it("keeps the avatar confirmation off the provider and the download on the owner", () => {
    const route = readFileSync(new URL("../app/api/avatars/route.ts", import.meta.url), "utf8");
    const button = readFileSync(new URL("../components/avatar-request.tsx", import.meta.url), "utf8");
    const studio = readFileSync(new URL("../components/creation-studio.tsx", import.meta.url), "utf8");
    const files = readFileSync(new URL("../app/api/files/[...path]/route.ts", import.meta.url), "utf8");
    const getPart = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
    assert.equal(getPart.includes("decideAvatarRequest"), false);
    assert.match(getPart, /proxyJson\(`\/avatars\//);
    assert.match(route, /avatarTransport\(coreMode\(\)\) === "core"/);
    assert.equal(route.includes("coreFetch"), false);
    assert.equal(route.includes("guardedGeneration"), false);
    assert.equal(route.includes("startRender"), false);
    assert.equal(route.includes("generate_character_image"), false);
    assert.equal(route.includes("premium"), false);
    assert.equal(button.includes("startRender"), false);
    assert.equal(button.includes("createCharacter"), false);
    assert.equal(button.includes("Loader2"), false);
    assert.equal(button.includes("animindly-generate"), false);
    assert.match(button, /sessionStorage/);
    assert.match(button, /rememberedAvatarPoll/);
    assert.match(button, /readAvatarAttempt/);
    const poll = readFileSync(new URL("../lib/avatar-core.ts", import.meta.url), "utf8");
    assert.match(poll, /animindly-avatar-poll/);
    assert.equal(poll.includes("animindly-generate"), false);
    assert.equal(button.includes("opacity-25"), false);
    assert.match(button, /text-white/);
    assert.match(button, /waitingForSignIn/);
    assert.match(button, /setTimeout/);
    assert.equal(/\{[^}]*requestId/.test(button), false);
    const core = readFileSync(new URL("../lib/core.ts", import.meta.url), "utf8");
    assert.match(core, /avatars/);
    assert.equal(studio.includes("animindly-generate"), false);
    assert.match(studio, /AvatarRequest/);
    assert.match(studio, /setAwaitingSignIn\(true\)/);
    assert.ok(files.indexOf("ownsResource") < files.indexOf("coreFetch"));
    const post = route.slice(route.indexOf("export async function POST"));
    const gateAt = post.indexOf("realAvatarCall");
    const proxyAt = post.indexOf('proxyJson("/avatars"');
    assert.equal(post.includes("beginGeneration"), false);
    assert.equal(route.includes("beginGeneration"), false);
    assert.ok(gateAt >= 0 && proxyAt > gateAt);
    assert.match(post, /generate:\s*true/);
    assert.match(post, /reuse:\s*false/);
    assert.match(post, /coreAvatarIdentity\(coreBody\)/);
    const sent = post.slice(post.indexOf("const coreBody"), post.indexOf("Object.assign"));
    assert.equal(sent.includes("requestedResolution"), false);
    assert.match(post, /existing\?\.transport === "core"/);
    assert.equal(post.includes("generate_character_image"), false);
    assert.equal(post.includes("create_puppet"), false);
    assert.equal(post.includes("generate_view"), false);
    assert.equal(button.includes(': "ready"'), false);
    assert.match(button, /"confirm"/);
    assert.match(button, /"offline"/);
    assert.match(button, /mode === "core"/);
    assert.match(button, /super_admin/);
    assert.match(button, /data-state=\{state\}/);
    const spend = readFileSync(new URL("../app/api/admin/spend/route.ts", import.meta.url), "utf8");
    assert.match(spend, /role !== "super_admin"/);
  });

  it("lets only an admin or super_admin reach a priced core avatar call", () => {
    assert.equal(AVATAR_PAID_CALLS_AUTHORIZED, false);
    assert.deepEqual(realAvatarCall({ role: "anonymous", mode: "core", generationOn: true, priceMinor: 1 }), { allow: false, code: "unapproved" });
    assert.deepEqual(realAvatarCall({ role: "user", mode: "core", generationOn: true, priceMinor: 1 }), { allow: false, code: "unapproved" });
    assert.deepEqual(realAvatarCall({ role: "admin", mode: "mock", generationOn: true, priceMinor: 1 }), { allow: false, code: "core_off" });
    assert.deepEqual(realAvatarCall({ role: "admin", mode: "off", generationOn: true, priceMinor: 1 }), { allow: false, code: "core_off" });
    assert.deepEqual(realAvatarCall({ role: "super_admin", mode: "core", generationOn: false, priceMinor: 1 }), { allow: false, code: "disabled" });
    assert.deepEqual(realAvatarCall({ role: "admin", mode: "core", generationOn: true, priceMinor: null }), { allow: false, code: "price_unavailable" });
    assert.deepEqual(realAvatarCall({ role: "admin", mode: "core", generationOn: true, priceMinor: 1 }), { allow: true });
    assert.deepEqual(realAvatarCall({ role: "super_admin", mode: "core", generationOn: true, priceMinor: 0 }), { allow: true });
  });
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function puppetFixture(over: Record<string, unknown> = {}) {
  const layer = (name: string, x: number, y: number) => ({ name, url: PNG, x, y, w: 8, h: 8, z: 1 });
  return {
    id: "avmock01",
    schema: "animind.puppet.v3",
    name: "Ada",
    status: "review_required",
    ready: false,
    defects: ["view_profile_missing", "provider_fixture"],
    views: {
      front: {
        canvas: { w: 80, h: 100 },
        layers: [layer("head", 10, 8), layer("torso", 16, 70)],
        visemes: { X: layer("mouth_X", 30, 48) },
        expressions: { neutral: layer("expression_neutral", 30, 48) },
        eyeRig: { maxShift: [4, 3], irises: [[28, 36, 3], [48, 36, 3]] },
        mouthQA: { anchor: { x: 38, y: 52, nose: [40, 30], chin: [40, 70], view: "front", along: 0.5, moustacheBottom: 58 } },
      },
      left: {
        canvas: { w: 80, h: 100 },
        layers: [layer("head", 12, 8)],
        visemes: { X: layer("mouth_X", 20, 48) },
      },
    },
    scenario: { embedded: false, control: "shared", states: ["on", "off"] },
    qa: { costUsd: null },
    provenance: { realImage: false },
    usage: { schema: "animind.usage.v1", calls: [], totals: { calls: 0, estimatedMicro: null, reportedMicro: null } },
    ...over,
  };
}

describe("puppet v3 avatar", () => {
  it("keeps review_required, defects, views, layers, anchors, and separate scenery", () => {
    const mapped = mapPuppetAvatar(puppetFixture(), "usr_admin");
    assert.ok(mapped);
    assert.equal(mapped.review?.status, "review_required");
    assert.equal(mapped.review?.ready, false);
    assert.equal(mapped.code, "review_required");
    assert.deepEqual(mapped.review?.defects, ["provider_fixture", "view_profile_missing"]);
    assert.deepEqual(Object.keys(mapped.views ?? {}), ["front", "left"]);
    assert.equal(mapped.views?.front.layers.length, 2);
    assert.equal(mapped.views?.front.eyeRig?.maxShift[0], 4);
    assert.equal(mapped.anchors?.find((item) => item.view === "front")?.mouth, true);
    assert.equal(mapped.anchors?.find((item) => item.view === "front")?.eyes, true);
    assert.equal(mapped.anchors?.find((item) => item.view === "front")?.mouthAnchor?.x, 38);
    const plate = (name: string, x: number, y: number) => ({ name, url: PNG, x, y, w: 8, h: 8, z: 1 });
    const published = mapPuppetAvatar(puppetFixture({
      status: "ready",
      ready: true,
      review_required: true,
      defects: [],
      views: {
        front: {
          canvas: { w: 80, h: 100 },
          layers: [plate("head", 10, 8), plate("neck", 16, 40), plate("torso", 16, 70)],
          visemes: { X: plate("mouth_X", 30, 48) },
          anchors: {
            coordinateSpace: "canvas_px",
            mouth: [38, 52],
            eyes: [[28, 36], [48, 36]],
            neck: [40, 60],
            head: [40, 20],
            torso: [40, 80],
          },
        },
      },
    }), "usr_admin");
    assert.equal(published?.review?.ready, false);
    assert.equal(published?.review?.status, "review_required");
    const front = published?.anchors?.find((item) => item.view === "front");
    assert.equal(front?.mouth, true);
    assert.equal(front?.eyes, true);
    assert.deepEqual(front?.mouthAnchor && [front.mouthAnchor.x, front.mouthAnchor.y], [38, 52]);
    assert.deepEqual(front?.neck, [40, 60]);
    assert.deepEqual(front?.head, [40, 20]);
    assert.deepEqual(front?.torso, [40, 80]);
    const identity = coreAvatarIdentity('{"generate":true,"name":"Ada"}');
    assert.match(identity["idempotency-key"], /^[A-Za-z0-9_-]{8,80}$/);
    assert.match(identity["x-request-id"], /^[A-Za-z0-9_-]{8,80}$/);
    assert.deepEqual(identity, coreAvatarIdentity('{"generate":true,"name":"Ada"}'));
    assert.notEqual(identity["idempotency-key"], coreAvatarIdentity('{"generate":true,"name":"Bento"}')["idempotency-key"]);
    const blocked = presentCorePayload(403, { error: "spend:approval" }, "usr_admin");
    assert.equal(blocked.status, 403);
    assert.equal("code" in blocked.body && blocked.body.code, "approval");
    assert.equal(JSON.stringify(blocked.body).includes("\"ready\":true"), false);
    assert.equal(mapped.scenery?.embedded, false);
    assert.equal(mapped.scenery?.separate, true);
    assert.deepEqual(mapped.scenery?.states, ["on", "off"]);
    assert.equal(mapped.cost, "unknown");
    assert.equal(mapped.coreMicro, null);
    assert.equal(mapped.jobs[0]?.stage, "qa");
    assert.equal(JSON.stringify(mapped).includes("\"ready\":true"), false);
    assert.equal(JSON.stringify(mapped).includes("$0"), false);
    assert.equal(JSON.stringify(mapped).includes("costUsd"), false);
    const presented = presentCorePayload(200, puppetFixture(), "usr_admin");
    assert.equal(presented.status, 200);
    assert.equal("review" in presented.body && presented.body.review?.ready, false);
  });

  it("does not turn a ready flag with defects, or a zero cost, into a finished avatar", () => {
    const lying = mapPuppetAvatar(puppetFixture({ status: "ready", ready: true, defects: ["view_profile_missing"] }), "usr_admin");
    assert.equal(lying?.review?.ready, false);
    assert.equal(lying?.review?.status, "review_required");
    assert.equal(lying?.jobs[0]?.stage, "qa");
    const zero = mapPuppetAvatar(puppetFixture({
      usage: { schema: "animind.usage.v1", calls: [], totals: { calls: 0, estimatedMicro: 0, reportedMicro: 0 } },
    }), "usr_admin");
    assert.equal(zero?.coreMicro, null);
    assert.equal(zero?.cost, "unknown");
    assert.equal(coreSpendMicro({ usage: { schema: "animind.usage.v1", totals: { reportedMicro: 39000, estimatedMicro: null } } }), 39000);
    const honest = mapPuppetAvatar(puppetFixture({
      status: "ready",
      ready: true,
      defects: [],
      provenance: { realImage: true },
      usage: { schema: "animind.usage.v1", calls: [], totals: { calls: 1, estimatedMicro: null, reportedMicro: 39000 } },
    }), "usr_admin");
    assert.equal(honest?.review?.ready, true);
    assert.equal(honest?.review?.status, "ready");
    assert.equal(honest?.coreMicro, 39000);
    assert.equal(honest?.cost, "unknown");
    assert.equal(JSON.stringify(honest).includes("$0"), false);
    assert.equal(translate("en", "unknownCost").includes("$0"), false);
    assert.equal(translate("pt-BR", "unknownCost"), "Custo desconhecido");
    assert.match(translate("en", "avatarSpendApproval"), /has not approved/);
    assert.match(translate("pt-BR", "avatarSpendApproval"), /não aprovou/);
    assert.match(translate("en", "avatarReviewRequired"), /not ready/);
    assert.match(translate("pt-BR", "avatarReviewRequired"), /Não está pronto/);
    assert.match(translate("en", "avatarScenerySeparate"), /separate control/);
    assert.match(translate("pt-BR", "avatarScenerySeparate"), /controle separado/);
    assert.equal(translate("en", "avatarScenerySeparate").toLowerCase().includes("background off"), false);
  });
});

describe("core usage and fixture debate", () => {
  const quote = "A admiração é o sentimento de um filósofo, e a filosofia começa pela admiração.";

  it("shows attempts and provider calls and keeps a null or zero price unknown", () => {
    const job = presentCoreUsage({
      providerCalls: 0,
      usage: {
        schema: "animind.usage.v1",
        userRef: "aaaaaaaaaaaaaaaaaaaaaaaa",
        calls: [{ attempt: 1, provider: "together", model: "Qwen/Qwen-Image", status: "blocked", cost: { currency: "USD", estimatedMicro: null, reportedMicro: null } }],
        totals: { calls: 1, blocked: 1, estimatedMicro: null, reportedMicro: null, holdCents: 0 },
      },
    });
    assert.deepEqual(job, { attempts: 1, providerCalls: 0, cost: "unknown" });
    const text = JSON.stringify(job);
    assert.equal(text.includes("together"), false);
    assert.equal(text.includes("Qwen"), false);
    assert.equal(text.includes("USD"), false);
    assert.equal(text.includes("$0"), false);
    assert.equal(text.includes("aaaaaaaa"), false);
    assert.equal(text.includes("estimatedMicro"), false);
    const zero = presentCoreUsage({
      usage: { schema: "animind.usage.v1", calls: [], totals: { calls: 0, estimatedMicro: 0, reportedMicro: 0 } },
    });
    assert.deepEqual(zero, { attempts: 0, providerCalls: 0, cost: "unknown" });
    assert.equal(JSON.stringify(zero).includes("$0"), false);
    assert.equal(costIsReportedZero(zero?.cost), false);
    assert.equal(presentCoreUsage({
      providerCalls: 0,
      usage: { schema: "animind.usage.v1", calls: [{}], totals: { calls: 1, estimatedMicro: 842, reportedMicro: null } },
    }), null);
    const plan = presentPlanUsage(200, {
      personas: ["Ada"],
      usage: { schema: "animind.usage.v1", userRef: "bbbbbbbbbbbbbbbbbbbbbbbb", calls: [], totals: { calls: 0, estimatedMicro: null, reportedMicro: null } },
    });
    assert.deepEqual(plan.body, { usage: { attempts: 0, providerCalls: 0, cost: "unknown" } });
    assert.equal(JSON.stringify(plan.body).includes("bbbbbbbb"), false);
    const hidden = presentPlanUsage(404, { detail: "users/secret usdPerImage 0" });
    assert.equal(hidden.status, 502);
    assert.equal(JSON.stringify(hidden.body).includes("users/"), false);
    assert.equal(JSON.stringify(hidden.body).includes("usdPerImage"), false);
  });

  it("keeps a verified debate quote and leaves a null line empty", () => {
    const script = presentCoreDebate({
      id: "abc123def456",
      theme: "a admiração",
      language: "pt",
      writer: "fixture",
      llm: { provider: "fixture", model: "fixture", live: false },
      _owner: "aaaaaaaaaaaaaaaaaaaaaaaa",
      _engine: { spoken: ["fixture.", "fixture."], path: "users/aaaaaaaaaaaaaaaaaaaaaaaa/debates/abc123def456.json" },
      lines: [
        {
          speaker: 0,
          name: "Sócrates",
          text: quote,
          kind: "quote",
          quote: { id: "q3", text: quote, source: "Platão · Teeteto 150c", url: "https://pt.wikiquote.org/wiki/S%C3%B3crates", verification: "verified" },
        },
        {
          speaker: 1,
          name: "Ada",
          text: null,
          kind: "fixture",
          quote: { text: "A labeled fixture quote.", source: "fixture rotulada", url: "https://pt.wikiquote.org/wiki/Ada" },
        },
      ],
    });
    assert.equal(script?.writer, "fixture");
    assert.equal(script?.live, false);
    assert.equal(script?.lines[0]?.text, quote);
    assert.equal(script?.lines[0]?.source, "Platão · Teeteto 150c");
    assert.equal(script?.lines[0]?.url, "https://pt.wikiquote.org/wiki/S%C3%B3crates");
    assert.equal(script?.lines[0]?.verification, "verified");
    assert.equal(script?.lines[1]?.text, null);
    assert.equal(script?.lines[1]?.source, null);
    assert.equal(script?.lines[1]?.url, null);
    const saved = JSON.stringify(script);
    assert.equal(saved.includes("A labeled fixture quote."), false);
    assert.equal(saved.includes("users/"), false);
    assert.equal(saved.includes("fixture."), false);
    assert.equal(saved.includes("_owner"), false);
    assert.equal(presentCoreDebate({
      id: "abc123def456", theme: "mar", language: "en", writer: "fixture",
      llm: { provider: "fixture", model: "fixture", live: true }, lines: [],
    }), null);
    const denied = presentDebateResponse(404, {
      detail: "debate not found",
      name: "Sócrates",
      text: quote,
      path: "users/aaaaaaaaaaaaaaaaaaaaaaaa/debates/abc123def456.json",
    });
    assert.equal(denied.status, 404);
    const deniedText = JSON.stringify(denied.body);
    assert.equal(deniedText.includes("Sócrates"), false);
    assert.equal(deniedText.includes(quote.slice(0, 24)), false);
    assert.equal(deniedText.includes("users/"), false);
    const created = presentDebateCreated(200, {
      id: "abc123def456", theme: "a admiração", language: "pt", writer: "fixture",
      llm: { live: false }, lines: [{ speaker: 0, name: "Sócrates", text: quote, kind: "quote", quote: { text: quote, source: "Platão", url: "https://pt.wikiquote.org/wiki/S%C3%B3crates", verification: "verified" } }],
    });
    assert.deepEqual(created.body, { id: "abc123def456" });
    assert.equal(JSON.stringify(created.body).includes(quote.slice(0, 12)), false);
  });

  it("keeps the fixture debate off the video render control", () => {
    const screen = readFileSync(new URL("../components/fixture-debate.tsx", import.meta.url), "utf8");
    const route = readFileSync(new URL("../app/api/debates/route.ts", import.meta.url), "utf8");
    const plan = readFileSync(new URL("../app/api/avatars/plan/route.ts", import.meta.url), "utf8");
    const button = readFileSync(new URL("../components/avatar-request.tsx", import.meta.url), "utf8");
    const core = readFileSync(new URL("../lib/core.ts", import.meta.url), "utf8");
    assert.match(screen, /debateFixtureLabel/);
    assert.match(screen, /debateFixtureEmpty/);
    assert.match(screen, /fixture-debate-text/);
    assert.match(screen, /fixture-debate-url/);
    assert.equal(screen.includes("startRender"), false);
    assert.equal(screen.includes("createCharacter"), false);
    assert.equal(screen.includes("$0"), false);
    assert.match(route, /writer: "fixture"/);
    assert.match(route, /live: false/);
    assert.match(route, /presentDebateResponse/);
    assert.equal(route.includes("startRender"), false);
    assert.equal(route.includes("guardedGeneration"), false);
    assert.match(plan, /presentPlanUsage/);
    assert.equal(plan.includes("guardedGeneration"), false);
    assert.match(button, /unknownCost/);
    assert.match(button, /FixtureDebate/);
    assert.equal(button.includes("$0"), false);
    assert.match(core, /debates/);
  });
});
