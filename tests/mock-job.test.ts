import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import pg from "pg";
import type { RenderRequest } from "../lib/contract";
import { loadMockJob } from "../lib/mock-jobs";
import { mockCreateJob, mockGetJob } from "../lib/mock";
import { isIsolatedPostgresHost } from "../lib/spend/sql";

const SECRET = "fixture-topic-secret-9f3a";
const url = process.env.DATABASE_URL?.trim() || "";
if (url && !isIsolatedPostgresHost(url)) {
  throw new Error("DATABASE_URL is not an isolated Postgres host. This test will not open it.");
}
if (process.env.CI === "true" && !url) {
  throw new Error("CI requires DATABASE_URL pointing at the Postgres service container.");
}

const view = { canvas: { w: 1, h: 1 }, layers: [], visemes: {} };
const request = {
  characters: [{
    id: "chr_fixture",
    name: "Ada",
    status: "placeholder",
    style: "rig",
    views: { front: view, left: view, right: view },
  }],
  template: "solo",
  scenario: "studio",
  topic: SECRET,
} as unknown as RenderRequest;

function decoded(id: string): unknown {
  try {
    return JSON.parse(Buffer.from(id.slice("mock_".length), "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

async function assertOpaque(userId: string): Promise<void> {
  const job = await mockCreateJob(request, userId);
  assert.match(job.id, /^mock_[A-Za-z0-9_-]{16,80}$/);
  assert.equal(job.id.includes(SECRET), false);
  assert.equal(decoded(job.id), null);
  const stored = await loadMockJob(job.id);
  assert.equal(stored?.userId, userId);
  assert.equal((stored?.request as { topic?: string }).topic, SECRET);
  const owner = await mockGetJob(job.id, userId);
  assert.equal(owner?.status, "queued");
  assert.equal(JSON.stringify(owner).includes(SECRET), false);
  assert.equal(await mockGetJob(job.id, "usr_other"), null);
  const leaked = `mock_${Buffer.from(JSON.stringify({ r: { topic: SECRET }, c: 1 })).toString("base64url")}`;
  assert.equal(await mockGetJob(leaked, userId), null);
}

describe("opaque mock job ids", { concurrency: 1 }, () => {
  it("does not decode a postgres job id into the request", { skip: url ? false : "isolated DATABASE_URL is not set" }, async () => {
    await assertOpaque("usr_owner");
  });

  it("does not decode a file-store job id into the request", async () => {
    const previousDatabase = process.env.DATABASE_URL;
    const previousPostgres = process.env.POSTGRES_URL;
    const previousDir = process.env.ANIMINDLY_DATA_DIR;
    const dir = await mkdtemp(path.join(tmpdir(), "animind-mock-"));
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    process.env.ANIMINDLY_DATA_DIR = dir;
    process.env.ANIMINDLY_SKIP_ENV_FILE = "1";
    try {
      await assertOpaque("usr_file");
      const raw = await readFile(path.join(dir, "mock-jobs.json"), "utf8");
      assert.equal(raw.includes(SECRET), true);
      assert.equal(raw.includes("usr_file"), true);
    } finally {
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      if (previousPostgres === undefined) delete process.env.POSTGRES_URL;
      else process.env.POSTGRES_URL = previousPostgres;
      if (previousDir === undefined) delete process.env.ANIMINDLY_DATA_DIR;
      else process.env.ANIMINDLY_DATA_DIR = previousDir;
    }
  });

  it("reads the job only for the account passed by the route", () => {
    const route = readFileSync(new URL("../app/api/jobs/[id]/route.ts", import.meta.url), "utf8");
    const render = readFileSync(new URL("../app/api/render/route.ts", import.meta.url), "utf8");
    assert.match(route, /mockGetJob\(key, actor\.id\)/);
    assert.doesNotMatch(route, /base64/);
    assert.match(render, /mockCreateJob\(adaptedBody, userId\)/);
    assert.doesNotMatch(render, /base64/);
  });
});

beforeEach(async () => {
  if (!url) return;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("CREATE TABLE IF NOT EXISTS animind_mock_jobs (id text PRIMARY KEY, user_id text NOT NULL, created_ms bigint NOT NULL, request jsonb NOT NULL)");
  await client.query("TRUNCATE animind_mock_jobs");
  await client.end();
});
