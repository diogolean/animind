import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import pg from "pg";
import {
  attachUsage,
  findReplay,
  listEntries,
  newSpendId,
  reconcileStale,
  reserve,
  reserveMore,
  saveReplay,
  settle,
  type SpendEntry,
} from "../lib/spend/ledger";
import { isIsolatedPostgresHost } from "../lib/spend/sql";
import { spendTotals } from "../lib/spend/totals";

const url = process.env.DATABASE_URL?.trim() || "";
if (url && !isIsolatedPostgresHost(url)) {
  throw new Error("DATABASE_URL is not an isolated Postgres host. This test will not open it.");
}
if (process.env.CI === "true" && !url) {
  throw new Error("CI requires DATABASE_URL pointing at the Postgres service container.");
}

function entry(over: Partial<SpendEntry> = {}): SpendEntry {
  const now = new Date().toISOString();
  return {
    id: newSpendId(),
    requestId: "req_pg",
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

async function reset(): Promise<void> {
  await listEntries();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("TRUNCATE animind_spend_entries, animind_spend_holds, animind_spend_replay, animind_spend_rates, animind_spend_inflight");
  await client.query("INSERT INTO animind_spend_inflight (id, slots) VALUES (1, 0)");
  await client.end();
}

describe("postgres spend ledger", { skip: url ? false : "isolated DATABASE_URL is not set" }, () => {
  beforeEach(reset);

  it("lets only one of two concurrent reserves take the last cent", async () => {
    const [a, b] = await Promise.all([
      reserve({ entry: entry({ userId: "usr_a" }), globalLimit: 1, userLimit: 1, ratePerMin: 10, concurrency: 2 }),
      reserve({ entry: entry({ userId: "usr_b" }), globalLimit: 1, userLimit: 1, ratePerMin: 10, concurrency: 2 }),
    ]);
    assert.equal([a, b].filter((result) => result.ok).length, 1);
    assert.equal([a, b].find((result) => !result.ok)?.block, "budget");
    const { holds } = await listEntries();
    assert.equal(holds.find((hold) => hold.scope === "global")?.reservedMinor, 1);
  });

  it("shares the last cent across two processes", async () => {
    const run = (user: string) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", path.join(process.cwd(), "tests", "spend-reserve-cli.ts"), user], {
          cwd: process.cwd(),
          env: { ...process.env, DATABASE_URL: url, POSTGRES_URL: "", ANIMINDLY_SKIP_ENV_FILE: "1" },
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
    const { holds } = await listEntries();
    assert.equal(holds.find((hold) => hold.scope === "global")?.reservedMinor, 1);
  });

  it("keeps a burst from two accounts inside the global and per-user limits", async () => {
    const users = ["usr_burst_a", "usr_burst_b"];
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        reserve({
          entry: entry({ id: `burst-${index}`, userId: users[index % 2], estimatedMinor: 1 }),
          globalLimit: 3,
          userLimit: 2,
          ratePerMin: 100,
          concurrency: 20,
        }),
      ),
    );
    const ok = results.filter((result) => result.ok);
    assert.equal(ok.length, 3);
    assert.equal(results.filter((result) => !result.ok).every((result) => result.block === "budget"), true);
    const { entries, holds } = await listEntries();
    const reserved = entries.filter((item) => item.id.startsWith("burst-") && item.status === "reserved");
    assert.equal(reserved.length, 3);
    for (const user of users) assert.ok(reserved.filter((item) => item.userId === user).length <= 2);
    assert.equal(holds.find((hold) => hold.scope === "global")?.reservedMinor, 3);
    for (const user of users) {
      const personal = holds.find((hold) => hold.scope === `user:${user}`)?.reservedMinor ?? 0;
      assert.ok(personal <= 2);
    }
  });

  it("keeps a burst from two accounts inside the per-minute window", async () => {
    const users = ["usr_rate_a", "usr_rate_b"];
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        reserve({
          entry: entry({ id: `rate-${index}`, userId: users[index % 2], estimatedMinor: 0 }),
          globalLimit: 100,
          userLimit: 100,
          ratePerMin: 2,
          concurrency: 20,
        }),
      ),
    );
    for (const user of users) {
      const mine = results.filter((_, index) => users[index % 2] === user);
      assert.equal(mine.filter((result) => result.ok).length, 2);
    }
    const { entries } = await listEntries();
    for (const user of users) {
      assert.equal(entries.filter((item) => item.userId === user && item.id.startsWith("rate-")).length, 2);
    }
  });

  it("blocks the second call in the same minute and the second slot", async () => {
    const first = await reserve({ entry: entry(), globalLimit: 10, userLimit: 10, ratePerMin: 1, concurrency: 2 });
    const rated = await reserve({ entry: entry(), globalLimit: 10, userLimit: 10, ratePerMin: 1, concurrency: 2 });
    assert.equal(first.ok, true);
    assert.deepEqual(rated, { ok: false, block: "rate" });

    await reset();
    const held = await reserve({ entry: entry({ userId: "usr_a" }), globalLimit: 10, userLimit: 10, ratePerMin: 10, concurrency: 1 });
    const busy = await reserve({ entry: entry({ userId: "usr_b" }), globalLimit: 10, userLimit: 10, ratePerMin: 10, concurrency: 1 });
    assert.equal(held.ok, true);
    assert.deepEqual(busy, { ok: false, block: "busy" });
    assert.equal((await listEntries()).inflight, 1);
  });

  it("refuses a retry that does not fit and keeps the first estimate", async () => {
    const row = entry();
    assert.equal((await reserve({ entry: row, globalLimit: 5, userLimit: 5, ratePerMin: 10, concurrency: 2 })).ok, true);
    assert.equal((await reserveMore(row.id, 1, 5, 5, 10)).ok, true);
    assert.deepEqual(await reserveMore(row.id, 100, 5, 5, 10), { ok: false, block: "budget" });
    const stored = (await listEntries()).entries.find((item) => item.id === row.id);
    assert.equal(stored?.estimatedMinor, 2);
    assert.equal(stored?.attempt, 2);
    assert.equal(stored?.reportedMinor, null);
    assert.equal((await listEntries()).holds.find((hold) => hold.scope === "global")?.reservedMinor, 2);
  });

  it("stores idempotency per user and does not treat another body as the same call", async () => {
    await saveReplay("usr_a", "same-key-1", 403, "price_unavailable", "hash-a");
    assert.deepEqual(await findReplay("usr_a", "same-key-1"), { status: 403, code: "price_unavailable", bodyHash: "hash-a" });
    assert.equal(await findReplay("usr_b", "same-key-1"), null);
    await saveReplay("usr_a", "same-key-1", 409, "idempotency_conflict", "hash-b");
    assert.equal((await findReplay("usr_a", "same-key-1"))?.bodyHash, "hash-b");
    await saveReplay("usr_b", "same-key-1", 200, "accepted", "hash-a");
    assert.equal((await findReplay("usr_b", "same-key-1"))?.bodyHash, "hash-a");
  });

  it("reconciles a stale reservation as unknown cost and releases a failed one", async () => {
    const stale = entry({ estimatedMinor: 4 });
    assert.equal((await reserve({ entry: stale, globalLimit: 10, userLimit: 10, ratePerMin: 10, concurrency: 2 })).ok, true);
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query("UPDATE animind_spend_entries SET created_at = $1 WHERE id = $2", [new Date(Date.now() - 60_000).toISOString(), stale.id]);
    await client.end();
    assert.equal(await reconcileStale(1000), 1);
    const after = await listEntries();
    const row = after.entries.find((item) => item.id === stale.id);
    assert.equal(row?.status, "uncertain");
    assert.equal(row?.block, "timeout");
    assert.equal(row?.reportedMinor, null);
    assert.equal(after.holds.find((hold) => hold.scope === "global")?.reservedMinor, 0);
    assert.equal(after.holds.find((hold) => hold.scope === "global")?.settledMinor, 4);
    assert.equal(after.inflight, 0);
    const totals = spendTotals(after.entries);
    assert.equal(totals.estimated.find((item) => item.currency === "USD")?.minor, 4);
    assert.equal(totals.reported.length, 0);
    assert.equal(totals.reportedUnknown, 1);

    await reset();
    const released = entry();
    assert.equal((await reserve({ entry: released, globalLimit: 10, userLimit: 10, ratePerMin: 10, concurrency: 2 })).ok, true);
    await settle(released.id, { status: "failed", reportedMinor: null });
    const gone = await listEntries();
    assert.equal(gone.holds.find((hold) => hold.scope === "global")?.settledMinor, 0);
    assert.equal(gone.holds.find((hold) => hold.scope === "global")?.reservedMinor, 0);
    assert.equal(gone.inflight, 0);
  });

  it("fills a missing usage report once and does not add a second report", async () => {
    const row = entry({ jobRef: "jobhash" });
    assert.equal((await reserve({ entry: row, globalLimit: 10, userLimit: 10, ratePerMin: 10, concurrency: 2 })).ok, true);
    await settle(row.id, { status: "uncertain", block: "timeout", jobRef: "jobhash" });
    assert.equal(await attachUsage("jobhash", { inputTokens: 3, outputTokens: 1, reportedMinor: null, provider: "deepseek", model: "deepseek-flash" }), true);
    assert.equal(await attachUsage("jobhash", { inputTokens: 9, outputTokens: 8, reportedMinor: 4, provider: "google" }), false);
    const stored = (await listEntries()).entries.find((item) => item.id === row.id);
    assert.equal(stored?.inputTokens, 3);
    assert.equal(stored?.outputTokens, 1);
    assert.equal(stored?.reportedMinor, null);
    assert.equal(stored?.provider, "deepseek");
    assert.equal(stored?.model, "deepseek-flash");
  });
});
