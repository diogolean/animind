import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttp, type Server } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { createAccount, upsertPilotSuperAdmin } from "../lib/accounts/store";
import { SPEND_PATHS } from "../lib/spend/catalog";
import {
  findReplay,
  insertEntry,
  listEntries,
  newSpendId,
  reconcileStale,
  reserve,
  saveReplay,
  settle,
  type SpendEntry,
} from "../lib/spend/ledger";
import { quoteCall, readSpendLimits, requestOverCap } from "../lib/spend/policy";
import { findPrice, parsePriceTable, PUBLISHED_PRICE_TABLE } from "../lib/spend/prices";
import { spendTotals } from "../lib/spend/totals";

const root = process.cwd();
const secretPrompt = "NAO-CHAMAR-PROVEDOR-xyz";

function entry(over: Partial<SpendEntry> = {}): SpendEntry {
  const now = new Date().toISOString();
  return {
    id: newSpendId(),
    requestId: "req_test",
    attempt: 1,
    jobRef: null,
    userId: "usr_a",
    operation: "render",
    provider: "core",
    model: "unspecified",
    status: "reserved",
    block: null,
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    thinkingTokens: null,
    imageCount: null,
    audioSeconds: null,
    videoSeconds: null,
    estimatedMinor: 1,
    reportedMinor: null,
    currency: "USD",
    priceVersion: "test",
    origin: "test",
    idempotencyKey: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function clearSpendEnv(): void {
  for (const name of [
    "ANIMINDLY_GENERATION",
    "ANIMIND_GENERATION",
    "ANIMINDLY_SPEND_BUDGET_CENTS",
    "ANIMINDLY_SPEND_USER_CENTS",
    "ANIMINDLY_SPEND_TIMEOUT_MS",
    "ANIMINDLY_SPEND_MAX_RETRIES",
    "ANIMINDLY_SPEND_RATE_PER_MIN",
    "ANIMINDLY_PRICE_TABLE_JSON",
    "ANIMINDLY_SPEND_LEDGER",
    "ANIMINDLY_GENERATION_CONCURRENCY",
    "ANIMINDLY_SPEND_MAX_INPUT_TOKENS",
    "ANIMINDLY_SPEND_MAX_OUTPUT_TOKENS",
    "ANIMINDLY_SPEND_MAX_TOTAL_TOKENS",
    "ANIMINDLY_SPEND_MAX_IMAGES",
    "ANIMINDLY_SPEND_MAX_AUDIO_SEC",
    "ANIMINDLY_SPEND_MAX_VIDEO_SEC",
    "ANIMINDLY_CORE_URL",
    "ANIMIND_CORE_URL",
    "CORE_URL",
    "DATABASE_URL",
    "POSTGRES_URL",
    "VERCEL",
  ]) delete process.env[name];
}

beforeEach(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "animind-spend-"));
  process.env.ANIMINDLY_DATA_DIR = dir;
  process.env.ANIMINDLY_SKIP_ENV_FILE = "1";
  clearSpendEnv();
});

after(async () => {
  if (process.env.ANIMINDLY_DATA_DIR?.includes("animind-spend-")) {
    await rm(process.env.ANIMINDLY_DATA_DIR, { recursive: true, force: true });
  }
});

describe("price table", () => {
  it("publishes no model and no rate", () => {
    assert.equal(PUBLISHED_PRICE_TABLE.entries.length, 0);
    assert.equal(findPrice(PUBLISHED_PRICE_TABLE, "render", "core", "unspecified"), null);
    assert.equal("error" in parsePriceTable("{"), true);
    assert.equal("error" in parsePriceTable(JSON.stringify({ version: "x", source: "y", sourceDate: "2026-11-07", entries: [{ operation: "render", provider: "core", model: "m", currency: "EUR", minor: 1, unit: "call", source: "s", sourceDate: "2026-11-07" }] })), true);
  });

  it("fails closed when any spend limit is missing", () => {
    assert.equal(readSpendLimits().ok, false);
    process.env.ANIMINDLY_GENERATION = "1";
    process.env.ANIMINDLY_SPEND_BUDGET_CENTS = "0";
    process.env.ANIMINDLY_SPEND_USER_CENTS = "0";
    process.env.ANIMINDLY_SPEND_TIMEOUT_MS = "1000";
    process.env.ANIMINDLY_SPEND_MAX_RETRIES = "0";
    process.env.ANIMINDLY_SPEND_RATE_PER_MIN = "2";
    assert.equal(readSpendLimits().ok, false);
    Object.assign(process.env, spendCaps());
    const limits = readSpendLimits();
    assert.equal(limits.ok, true);
    if (!limits.ok) return;
    assert.equal(quoteCall(limits.limits, "render", "core", "unspecified"), null);
    assert.equal(requestOverCap({ prompt: "unchanged", maxInputTokens: limits.limits.maxInputTokens + 1 }, limits.limits), "input");
    assert.equal(requestOverCap({ prompt: "unchanged" }, limits.limits), null);
  });
});

describe("ledger", () => {
  it("lets only one of two concurrent reserves take the last cent", async () => {
    const first = entry({ userId: "usr_a" });
    const second = entry({ userId: "usr_b" });
    const [a, b] = await Promise.all([
      reserve({ entry: first, globalLimit: 1, userLimit: 1, ratePerMin: 10, concurrency: 2 }),
      reserve({ entry: second, globalLimit: 1, userLimit: 1, ratePerMin: 10, concurrency: 2 }),
    ]);
    const oks = [a, b].filter((result) => result.ok);
    assert.equal(oks.length, 1);
    assert.equal([a, b].find((result) => !result.ok && "block" in result)?.block, "budget");
    const { holds } = await listEntries();
    assert.equal(holds.find((hold) => hold.scope === "global")?.reservedMinor, 1);
  });

  it("does not treat a second key from another user as a replay", async () => {
    await saveReplay("usr_a", "same-key-1", 504, "timeout");
    assert.deepEqual(await findReplay("usr_a", "same-key-1"), { status: 504, code: "timeout", bodyHash: "" });
    assert.equal(await findReplay("usr_b", "same-key-1"), null);
  });

  it("shares the last cent across two processes", async () => {
    const dir = process.env.ANIMINDLY_DATA_DIR ?? "";
    const run = (user: string) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", path.join(root, "tests", "spend-reserve-cli.ts"), user], {
          cwd: root,
          env: {
            ...process.env,
            ANIMINDLY_DATA_DIR: dir,
            ANIMINDLY_SKIP_ENV_FILE: "1",
            DATABASE_URL: "",
            POSTGRES_URL: "",
          },
        });
        let out = "";
        let err = "";
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => {
          out += chunk;
        });
        child.stderr?.on("data", (chunk) => {
          err += chunk;
        });
        child.on("exit", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err || out))));
      });
    const [left, right] = await Promise.all([run("usr_a"), run("usr_b")]);
    assert.deepEqual([left, right].sort(), ["budget", "ok"]);
  });

  it("blocks the second call in the same minute", async () => {
    const ok = await reserve({ entry: entry(), globalLimit: 10, userLimit: 10, ratePerMin: 1, concurrency: 2 });
    const blocked = await reserve({ entry: entry(), globalLimit: 10, userLimit: 10, ratePerMin: 1, concurrency: 2 });
    assert.equal(ok.ok, true);
    assert.deepEqual(blocked, { ok: false, block: "rate" });
  });

  it("reconciles a stale reservation as uncertain and does not sum a missing bill as zero", async () => {
    const stale = entry({ createdAt: new Date(Date.now() - 60_000).toISOString(), estimatedMinor: 4, reportedMinor: null });
    assert.equal((await reserve({ entry: stale, globalLimit: 10, userLimit: 10, ratePerMin: 10, concurrency: 2 })).ok, true);
    assert.equal(await reconcileStale(1000), 1);
    const { entries, holds } = await listEntries();
    assert.equal(entries[0]?.status, "uncertain");
    assert.equal(entries[0]?.reportedMinor, null);
    assert.equal(holds.find((hold) => hold.scope === "global")?.reservedMinor, 0);
    assert.equal(holds.find((hold) => hold.scope === "global")?.settledMinor, 4);
    const unknown = entry({ status: "succeeded", estimatedMinor: null, reportedMinor: null, currency: null });
    await insertEntry(unknown);
    const totals = spendTotals([...(await listEntries()).entries]);
    assert.equal(totals.estimated.find((row) => row.currency === "USD")?.minor, 4);
    assert.equal(totals.reported.length, 0);
    assert.equal(totals.estimatedUnknown, 1);
    assert.equal(totals.reportedUnknown, 2);
    await settle(stale.id, { status: "failed", reportedMinor: 9 });
    const released = await listEntries();
    assert.equal(released.holds.find((hold) => hold.scope === "global")?.settledMinor, 4);
  });
});

describe("route coverage", () => {
  it("classifies every route and guards only the paid ones", async () => {
    const files: Record<string, string> = {
      "/api/plan": "app/api/plan/route.ts",
      "/api/render": "app/api/render/route.ts",
      "/api/preview": "app/api/preview/route.ts",
      "/api/characters": "app/api/characters/route.ts",
      "/api/jobs/:id": "app/api/jobs/[id]/route.ts",
      "/api/files/*": "app/api/files/[...path]/route.ts",
      "/api/scenarios": "app/api/scenarios/route.ts",
      "/api/personas/deep": "app/api/personas/deep/route.ts",
      "/api/personas/sheet": "app/api/personas/sheet/route.ts",
      "/api/voices": "app/api/voices/route.ts",
      "/api/tones": "app/api/tones/route.ts",
      "/api/health": "app/api/health/route.ts",
    };
    for (const item of SPEND_PATHS) {
      const file = files[item.path];
      assert.ok(file, item.path);
      const source = await readFile(file, "utf8");
      if (item.guard === "beginGeneration") {
        const guardAt = source.indexOf("guardedGeneration");
        assert.ok(guardAt >= 0, file);
        const fetchAt = source.indexOf("coreFetch");
        if (fetchAt >= 0) assert.ok(guardAt < fetchAt, file);
      } else if (item.guard === "guardedRead") {
        assert.equal(source.includes("guardedRead"), true, file);
        assert.equal(source.includes("guardedGeneration"), false, file);
      } else if (item.operation === "health") {
        assert.equal(source.includes("guardedGeneration"), false, file);
      } else {
        assert.equal(source.includes("guardedGeneration"), false, file);
        assert.equal(source.includes("coreFetch"), false, file);
      }
    }
    const plan = await readFile("app/api/plan/route.ts", "utf8");
    assert.match(plan, /inferCreationPlan/);
    const render = await readFile("app/api/render/route.ts", "utf8");
    assert.match(render, /coreFetch\("\/tones"\)/);
  });
});

describe("paid routes with a fixture core", () => {
  it("denies with zero provider calls, then times out and replays without a new call", { timeout: 240_000 }, async () => {
    const dir = process.env.ANIMINDLY_DATA_DIR ?? "";
    const secret = randomBytes(24).toString("base64url");
    process.env.ANIMINDLY_AUTH_SECRET = secret;
    const password = randomBytes(18).toString("base64url");
    const admin = await upsertPilotSuperAdmin(`spend-admin-${randomBytes(3).toString("hex")}@example.com`, password);
    const user = await createAccount(admin, {
      email: `spend-user-${randomBytes(3).toString("hex")}@example.com`,
      name: "Sem geracao",
      password,
      role: "user",
    });
    assert.equal(user.ok, true);

    const closed = await listen((req, res) => {
      req.resume();
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "fixture" }));
    });
    const closedApp = await startApp(dir, secret, {
      ANIMINDLY_CORE_URL: closed.url,
      ANIMINDLY_GENERATION: "1",
      ANIMINDLY_SPEND_BUDGET_CENTS: "1",
      ANIMINDLY_SPEND_USER_CENTS: "1",
      ANIMINDLY_SPEND_TIMEOUT_MS: "1000",
      ANIMINDLY_SPEND_MAX_RETRIES: "0",
      ANIMINDLY_SPEND_RATE_PER_MIN: "10",
      ...spendCaps(),
    });
    try {
      const plan = await call(closedApp.base, "/api/plan", { prompt: secretPrompt });
      assert.equal(plan.status, 200);
      assert.match(plan.text, /"source":"local"/);
      assert.equal(plan.text.includes("gemini"), false);
      const render = await call(closedApp.base, "/api/render", renderBody());
      assert.equal(render.status, 401);
      const adminCookie = await login(closedApp.base, admin.email, password);
      const adminRender = await call(closedApp.base, "/api/render", renderBody(), adminCookie);
      assert.equal(adminRender.status, 403);
      assert.match(adminRender.text, /price_unavailable/);
      if (user.ok) {
        const userCookie = await login(closedApp.base, user.value.email, password);
        const userRender = await call(closedApp.base, "/api/render", renderBody(), userCookie);
        assert.equal(userRender.status, 403);
        assert.match(userRender.text, /unapproved/);
      }
      const voices = await fetch(`${closedApp.base}/api/voices`);
      assert.equal(voices.status, 200);
      const job = await fetch(`${closedApp.base}/api/jobs/job_existing`);
      assert.equal(job.status, 401);
      const same = await call(closedApp.base, "/api/render", renderBody(), adminCookie, "idem-body-1");
      assert.equal(same.status, 403);
      const replayed = await call(closedApp.base, "/api/render", renderBody(), adminCookie, "idem-body-1");
      assert.equal(replayed.status, 403);
      assert.match(replayed.text, /replay/);
      const conflict = await call(closedApp.base, "/api/render", { ...renderBody(), topic: `${secretPrompt}-other` }, adminCookie, "idem-body-1");
      assert.equal(conflict.status, 409);
      assert.match(conflict.text, /idempotency_conflict/);
      assert.equal(closed.hits(), 0);
      const ledger = await readFile(path.join(dir, "spend.json"), "utf8").catch(() => "");
      assert.equal(ledger.includes(secretPrompt), false);
    } finally {
      await closedApp.stop();
      await closed.close();
    }

    const priced = await listen((req, res) => {
      req.resume();
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "fixture" }));
    });
    const pricedApp = await startApp(dir, secret, {
      ANIMINDLY_CORE_URL: priced.url,
      ANIMINDLY_GENERATION: "1",
      ANIMINDLY_SPEND_BUDGET_CENTS: "0",
      ANIMINDLY_SPEND_USER_CENTS: "0",
      ANIMINDLY_SPEND_TIMEOUT_MS: "1000",
      ANIMINDLY_SPEND_MAX_RETRIES: "0",
      ANIMINDLY_SPEND_RATE_PER_MIN: "10",
      ANIMINDLY_PRICE_TABLE_JSON: priceTable(),
      ...spendCaps(),
    });
    try {
      const adminCookie = await login(pricedApp.base, admin.email, password);
      const over = await call(pricedApp.base, "/api/render", { ...renderBody(), maxInputTokens: 5000 }, adminCookie);
      assert.equal(over.status, 400);
      assert.match(over.text, /over_cap/);
      const denied = await call(pricedApp.base, "/api/render", renderBody(), adminCookie);
      assert.equal(denied.status, 403);
      assert.match(denied.text, /budget/);
      assert.equal(priced.hits(), 0);
    } finally {
      await pricedApp.stop();
      await priced.close();
    }

    const hanging = await listen((req, res) => {
      const url = req.url ?? "";
      if (url.includes("/tones") || url.includes("/health")) {
        req.resume();
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      req.resume();
    });
    const live = await startApp(dir, secret, {
      ANIMINDLY_CORE_URL: hanging.url,
      ANIMINDLY_GENERATION: "1",
      ANIMINDLY_SPEND_BUDGET_CENTS: "5",
      ANIMINDLY_SPEND_USER_CENTS: "5",
      ANIMINDLY_SPEND_TIMEOUT_MS: "200",
      ANIMINDLY_SPEND_MAX_RETRIES: "1",
      ANIMINDLY_SPEND_RATE_PER_MIN: "10",
      ANIMINDLY_PRICE_TABLE_JSON: priceTable(),
      ...spendCaps(),
    });
    try {
      const adminCookie = await login(live.base, admin.email, password);
      const key = "idem-key-1";
      const timed = await call(live.base, "/api/render", renderBody(), adminCookie, key);
      assert.equal(timed.status, 504);
      const afterTimeout = hanging.hits();
      assert.ok(afterTimeout >= 3, `expected tones plus two render attempts, got ${afterTimeout}`);
      const replay = await call(live.base, "/api/render", renderBody(), adminCookie, key);
      assert.equal(replay.status, 504);
      assert.match(replay.text, /replay/);
      assert.equal(hanging.hits(), afterTimeout);
      if (user.ok) {
        const userCookie = await login(live.base, user.value.email, password);
        const other = await call(live.base, "/api/render", renderBody(), userCookie, key);
        assert.equal(other.status, 403);
        assert.equal(other.text.includes("replay"), false);
        assert.equal(hanging.hits(), afterTimeout);
      }
      const ledger = JSON.parse(await readFile(path.join(dir, "spend.json"), "utf8")) as { entries: SpendEntry[] };
      const timedOut = ledger.entries.find((row) => row.block === "timeout" && row.status === "uncertain");
      assert.ok(timedOut);
      assert.ok((timedOut?.estimatedMinor ?? 0) >= 1);
      assert.equal(timedOut?.reportedMinor, null);
      assert.equal(JSON.stringify(ledger).includes(secretPrompt), false);
    } finally {
      await live.stop();
      await hanging.close();
    }

    const snapshot = JSON.parse(await readFile(path.join(dir, "spend.json"), "utf8")) as { holds?: { scope: string; settledMinor: number }[] };
    const settled = snapshot.holds?.find((hold) => hold.scope === "global")?.settledMinor ?? 0;
    const tight = await listen((req, res) => {
      const url = req.url ?? "";
      if (url.includes("/tones") || url.includes("/health")) {
        req.resume();
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      req.resume();
    });
    const tightApp = await startApp(dir, secret, {
      ANIMINDLY_CORE_URL: tight.url,
      ANIMINDLY_GENERATION: "1",
      ANIMINDLY_SPEND_BUDGET_CENTS: String(settled + 1),
      ANIMINDLY_SPEND_USER_CENTS: String(settled + 1),
      ANIMINDLY_SPEND_TIMEOUT_MS: "200",
      ANIMINDLY_SPEND_MAX_RETRIES: "1",
      ANIMINDLY_SPEND_RATE_PER_MIN: "10",
      ANIMINDLY_PRICE_TABLE_JSON: priceTable(),
      ...spendCaps(),
    });
    try {
      const adminCookie = await login(tightApp.base, admin.email, password);
      const refused = await call(tightApp.base, "/api/render", renderBody(), adminCookie, "idem-retry-1");
      assert.equal(refused.status, 504);
      assert.equal(tight.hits(), 2);
      const again = JSON.parse(await readFile(path.join(dir, "spend.json"), "utf8")) as { entries: SpendEntry[] };
      const row = again.entries.find((item) => item.idempotencyKey === "idem-retry-1");
      assert.equal(row?.status, "uncertain");
      assert.equal(row?.estimatedMinor, 1);
      assert.equal(row?.reportedMinor, null);
    } finally {
      await tightApp.stop();
      await tight.close();
    }

    const outage = await listen((req, res) => {
      req.resume();
      res.writeHead(500, { "content-type": "application/json" });
      res.end("{}");
    });
    const outageApp = await startApp(dir, secret, {
      ANIMINDLY_CORE_URL: outage.url,
      ANIMINDLY_GENERATION: "1",
      ANIMINDLY_SPEND_BUDGET_CENTS: "5",
      ANIMINDLY_SPEND_USER_CENTS: "5",
      ANIMINDLY_SPEND_TIMEOUT_MS: "1000",
      ANIMINDLY_SPEND_MAX_RETRIES: "1",
      ANIMINDLY_SPEND_RATE_PER_MIN: "10",
      ANIMINDLY_PRICE_TABLE_JSON: priceTable(),
      ANIMINDLY_SPEND_LEDGER: "unavailable",
      ...spendCaps(),
    });
    try {
      const adminCookie = await login(outageApp.base, admin.email, password);
      const down = await call(outageApp.base, "/api/render", renderBody(), adminCookie, "idem-ledger-1");
      assert.equal(down.status, 503);
      assert.match(down.text, /ledger/);
      assert.equal(outage.hits(), 0);
    } finally {
      await outageApp.stop();
      await outage.close();
    }
  });
});

function spendCaps(): Record<string, string> {
  return {
    ANIMINDLY_GENERATION_CONCURRENCY: "2",
    ANIMINDLY_SPEND_MAX_INPUT_TOKENS: "1000",
    ANIMINDLY_SPEND_MAX_OUTPUT_TOKENS: "1000",
    ANIMINDLY_SPEND_MAX_TOTAL_TOKENS: "2000",
    ANIMINDLY_SPEND_MAX_IMAGES: "1",
    ANIMINDLY_SPEND_MAX_AUDIO_SEC: "10",
    ANIMINDLY_SPEND_MAX_VIDEO_SEC: "10",
  };
}

function priceTable(): string {
  return JSON.stringify({
    version: "test-2026-11-07",
    source: "fixture, not an official rate",
    sourceDate: "2026-11-07",
    entries: [
      {
        operation: "render",
        provider: "core",
        model: "unspecified",
        currency: "USD",
        minor: 1,
        unit: "call",
        source: "fixture",
        sourceDate: "2026-11-07",
      },
    ],
  });
}

function renderBody() {
  return { characters: [{ id: "c", name: "A" }], template: "solo", scenario: "studio", topic: secretPrompt };
}

function listen(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void) {
  let hits = 0;
  const server: Server = createHttp((req, res) => {
    if (!(req.url ?? "").includes("/health")) hits += 1;
    handler(req, res);
  });
  return new Promise<{ url: string; hits: () => number; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        hits: () => hits,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function call(base: string, pathname: string, body: unknown, cookie = "", key = ""): Promise<{ status: number; text: string }> {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

async function login(base: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const line = (response.headers.getSetCookie?.() ?? []).find((item) => item.startsWith("animind_session=")) ?? response.headers.get("set-cookie") ?? "";
  const match = line.match(/animind_session=([^;]+)/);
  assert.ok(match, line);
  return `animind_session=${match[1]}`;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function startApp(dir: string, secret: string, extra: Record<string, string>): Promise<{ base: string; stop: () => Promise<void> }> {
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root,
    env: {
      ...process.env,
      ANIMINDLY_DATA_DIR: dir,
      ANIMIND_DATA_DIR: "",
      ANIMINDLY_AUTH_SECRET: secret,
      ANIMIND_AUTH_SECRET: "",
      ANIMINDLY_SKIP_ENV_FILE: "1",
      ANIMINDLY_COOKIE_SECURE: "0",
      DATABASE_URL: "",
      POSTGRES_URL: "",
      VERCEL: "",
      ANIMINDLY_CORE_MOCK: "",
      ANIMIND_CORE_URL: "",
      CORE_URL: "",
      ANIMINDLY_SPEND_LEDGER: "",
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    log += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    log += chunk;
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 40_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error(`next start did not become ready: ${log}`);
  }
  return {
    base,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
}
