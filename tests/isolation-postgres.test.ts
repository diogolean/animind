import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import pg from "pg";
import { importCharacterPackage } from "../lib/accounts/import-character";
import { deleteObjectPrefix } from "../lib/accounts/object-store";
import { createAccount, upsertPilotSuperAdmin } from "../lib/accounts/store";
import { listEntries } from "../lib/spend/ledger";
import { isIsolatedPostgresHost } from "../lib/spend/sql";

const testEmails = [
  "iso-owner-%@example.com",
  "iso-user-%@example.com",
  "iso-admin-%@example.com",
  "owned-owner-%@example.com",
  "owned-user-%@example.com",
  "avatar-owner-%@example.com",
  "avatar-user-%@example.com",
  "avatar-admin-%@example.com",
];

const root = process.cwd();
const url = process.env.DATABASE_URL?.trim() || "";
if (url && !isIsolatedPostgresHost(url)) {
  throw new Error("DATABASE_URL is not an isolated Postgres host. This test will not open it.");
}
if (process.env.CI === "true" && !url) {
  throw new Error("CI requires DATABASE_URL pointing at the Postgres service container.");
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("postgres account isolation", { skip: url ? false : "isolated DATABASE_URL is not set", concurrency: false }, () => {
  it("keeps two accounts apart, denies non-admins, and does not render on login", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "animind-iso-"));
    process.env.ANIMINDLY_DATA_DIR = dir;
    process.env.ANIMINDLY_SKIP_ENV_FILE = "1";
    process.env.ANIMINDLY_AUTH_SECRET = randomBytes(24).toString("base64url");
    process.env.ANIMINDLY_SKIP_CHARACTER_IMPORT = "1";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_STORE_ID;
    delete process.env.VERCEL;
    const password = randomBytes(18).toString("base64url");
    const owner = await upsertPilotSuperAdmin(`iso-owner-${randomBytes(3).toString("hex")}@example.com`, password);
    const ids = [owner.id];
    try {
    const user = await createAccount(owner, {
      email: `iso-user-${randomBytes(3).toString("hex")}@example.com`,
      name: "Visitor",
      password,
      role: "user",
    });
    const admin = await createAccount(owner, {
      email: `iso-admin-${randomBytes(3).toString("hex")}@example.com`,
      name: "Admin",
      password,
      role: "admin",
    });
    assert.equal(user.ok && admin.ok, true);
    if (!user.ok || !admin.ok) return;
    ids.push(user.value.id, admin.value.id);
    assert.equal(user.value.generationEnabled, false);
    assert.equal(admin.value.generationEnabled, true);
    assert.equal(owner.generationEnabled, true);
    const imported = await importCharacterPackage({
      ownerId: owner.id,
      name: "Fixture Speaker",
      files: [
        {
          path: "puppet.json",
          bytes: Buffer.from(JSON.stringify({
            name: "Fixture Speaker",
            canvas: { w: 64, h: 80 },
            views: {
              front: {
                canvas: { w: 64, h: 80 },
                layers: [{ name: "head", url: "layers/head.png", x: 0, y: 0, w: 64, h: 80, z: 1 }],
                visemes: { X: { name: "mouth", url: "layers/mouth.png", x: 20, y: 40, w: 20, h: 10, z: 2 } },
              },
            },
          })),
        },
        { path: "layers/head.png", bytes: PNG },
        { path: "layers/mouth.png", bytes: PNG },
        { path: "views/front.png", bytes: PNG },
      ],
    });
    assert.equal(imported.status, "ready");
    const front = imported.views.front ?? "";
    assert.match(front, /^\/api\/library\/assets\//);
    const app = await startApp(dir);
    try {
      const anonLibrary = await hit(app.base, "/api/library");
      const anonCharacter = await hit(app.base, `/api/library/${imported.id}`);
      const anonAsset = await hit(app.base, front);
      const anonJob = await hit(app.base, "/api/jobs/job_missing");
      const anonFile = await hit(app.base, "/api/files/missing/file.bin");
      const anonSpend = await hit(app.base, "/api/admin/spend");
      const anonUsers = await hit(app.base, "/api/admin/users");
      for (const response of [anonLibrary, anonCharacter, anonAsset, anonJob, anonFile, anonSpend, anonUsers]) {
        assert.equal(response.status, 401);
        assert.equal(response.text.includes("Fixture Speaker"), false);
      }

      const userLogin = await login(app.base, user.value.email, password);
      assert.equal(userLogin.user.generationEnabled, false);
      assert.equal(userLogin.text.includes("render"), false);
      const adminLogin = await login(app.base, admin.value.email, password);
      assert.equal(adminLogin.user.generationEnabled, true);
      const ownerLogin = await login(app.base, owner.email, password);

      const userLibrary = await hit(app.base, "/api/library", userLogin.cookie);
      assert.equal(userLibrary.status, 200);
      assert.deepEqual(JSON.parse(userLibrary.text).characters, []);
      assert.equal((await hit(app.base, `/api/library/${imported.id}`, userLogin.cookie)).status, 404);
      assert.equal((await hit(app.base, front, userLogin.cookie)).status, 404);
      const userJob = await hit(app.base, "/api/jobs/job_missing", userLogin.cookie);
      const userFile = await hit(app.base, "/api/files/missing/file.bin", userLogin.cookie);
      assert.equal(userJob.status, 404);
      assert.equal(userFile.status, 404);
      assert.equal(userJob.text.includes("Fixture Speaker"), false);
      assert.equal(userJob.text.includes("job_missing"), false);
      assert.equal(userFile.text.includes("missing/file.bin"), false);
      const ownerMissing = await hit(app.base, "/api/jobs/job_missing", ownerLogin.cookie);
      assert.equal(ownerMissing.status, 404);
      assert.equal(ownerMissing.text.includes("Fixture Speaker"), false);
      assert.equal((await hit(app.base, "/api/admin/spend", userLogin.cookie)).status, 403);
      assert.equal((await hit(app.base, "/api/admin/users", userLogin.cookie)).status, 403);
      assert.equal((await hit(app.base, "/api/admin/spend", adminLogin.cookie)).status, 403);
      const adminUsers = await hit(app.base, "/api/admin/users", adminLogin.cookie);
      assert.equal(adminUsers.status, 200);
      assert.equal(adminUsers.text.includes("Fixture Speaker"), false);
      assert.equal((await hit(app.base, "/api/admin/spend", userLogin.cookie)).text.includes(owner.email), false);

      const ownerLibrary = await hit(app.base, "/api/library", ownerLogin.cookie);
      assert.equal(ownerLibrary.status, 200);
      assert.equal(JSON.parse(ownerLibrary.text).characters.some((character: { id: string }) => character.id === imported.id), true);
      assert.equal((await hit(app.base, front, ownerLogin.cookie)).status, 200);
      assert.equal((await hit(app.base, "/api/admin/spend", ownerLogin.cookie)).status, 200);

      const idea = { prompt: "A short labeled fixture about gravity", language: "en-US" };
      const anonPlan = await hit(app.base, "/api/plan", undefined, "POST", idea);
      assert.equal(anonPlan.status, 200);
      assert.equal(JSON.parse(anonPlan.text).source, "local");
      const anonRender = await hit(app.base, "/api/render", undefined, "POST", idea);
      const userRender = await hit(app.base, "/api/render", userLogin.cookie, "POST", idea);
      assert.equal(anonRender.status, 401);
      assert.equal(userRender.status, 403);
      assert.equal(JSON.parse(userRender.text).code, "unapproved");
      const rows = (await listEntries()).entries.filter((entry) => entry.userId === user.value.id || entry.userId === owner.id);
      assert.equal(rows.some((entry) => entry.operation === "render" && (entry.status === "reserved" || entry.status === "succeeded")), false);
      for (const response of [userLibrary, anonPlan, anonRender, userRender]) {
        assert.equal(response.text.includes(owner.email), false);
      }
    } finally {
      await app.stop();
    }
    } finally {
      await removeTestAccounts(ids);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("gives a job and its file only to the account that created them", { timeout: 180_000 }, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "animind-iso-owned-"));
    process.env.ANIMINDLY_DATA_DIR = dir;
    process.env.ANIMINDLY_SKIP_ENV_FILE = "1";
    process.env.ANIMINDLY_AUTH_SECRET = randomBytes(24).toString("base64url");
    process.env.ANIMINDLY_SKIP_CHARACTER_IMPORT = "1";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_STORE_ID;
    delete process.env.VERCEL;
    const password = randomBytes(18).toString("base64url");
    const owner = await upsertPilotSuperAdmin(`owned-owner-${randomBytes(3).toString("hex")}@example.com`, password);
    const ids = [owner.id];
    try {
    const user = await createAccount(owner, {
      email: `owned-user-${randomBytes(3).toString("hex")}@example.com`,
      name: "Outra conta",
      password,
      role: "user",
    });
    assert.equal(user.ok, true);
    if (!user.ok) return;
    ids.push(user.value.id);
    const jobId = `job_${randomBytes(6).toString("hex")}`;
    const filePath = `clips/FixtureSpeaker-${randomBytes(3).toString("hex")}.bin`;
    const seen: { path: string; user: string | null }[] = [];
    const core = createServer((req, res) => {
      const urlPath = req.url ?? "";
      const header = req.headers["x-animind-user"];
      seen.push({ path: urlPath, user: Array.isArray(header) ? header[0] ?? null : header ?? null });
      req.resume();
      const send = (status: number, body: unknown, type = "application/json") => {
        const text = typeof body === "string" ? body : JSON.stringify(body);
        res.writeHead(status, { "content-type": type });
        res.end(text);
      };
      if (urlPath.startsWith("/v1/health")) return send(200, { ok: true });
      if (urlPath.startsWith("/v1/tones")) return send(200, { tones: [] });
      if (urlPath.startsWith("/v1/plan")) return send(200, { topic: "gravity", characters: [{ name: "Fixture Speaker" }] });
      if (urlPath.startsWith("/v1/personas/sheet")) return send(200, { name: "Socrates", found: false, quotes: [] });
      if (urlPath.startsWith("/v1/characters")) return send(201, { id: "chr_owned", name: "Fixture Speaker" });
      if (urlPath.startsWith("/v1/render")) {
        return send(202, {
          id: jobId,
          status: "queued",
          provider: "deepseek",
          model: "deepseek-flash",
          usage: { inputTokens: 11, outputTokens: 4 },
          videoUrl: `http://127.0.0.1/v1/files/${filePath}`,
        });
      }
      if (urlPath.startsWith(`/v1/jobs/${jobId}`)) {
        return send(200, { id: jobId, status: "done", characters: [{ name: "Fixture Speaker" }] });
      }
      if (urlPath.startsWith(`/v1/files/${filePath}`)) return send(200, "clip-bytes", "application/octet-stream");
      return send(404, { error: "missing" });
    });
    const corePort = await new Promise<number>((resolve) => {
      core.listen(0, "127.0.0.1", () => {
        const address = core.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    const app = await startApp(dir, {
      ANIMINDLY_CORE_URL: `http://127.0.0.1:${corePort}`,
      ANIMINDLY_PRICE_TABLE_JSON: ownerPriceTable(),
      ANIMINDLY_SPEND_BUDGET_CENTS: "100",
      ANIMINDLY_SPEND_USER_CENTS: "100",
      ANIMINDLY_GENERATION_CONCURRENCY: "8",
      ANIMINDLY_SPEND_RATE_PER_MIN: "100",
    });
    try {
      const ownerLogin = await login(app.base, owner.email, password);
      const userLogin = await login(app.base, user.value.email, password);
      const plan = await hit(app.base, "/api/plan", ownerLogin.cookie, "POST", { prompt: "A short scene", language: "en-US" });
      assert.equal(plan.status, 200, plan.text);
      const sheet = await hit(app.base, "/api/personas/sheet?name=Socrates&lang=en", ownerLogin.cookie);
      assert.equal(sheet.status, 200, sheet.text);
      const character = await hit(app.base, "/api/characters", ownerLogin.cookie, "POST", {
        name: "Fixture Speaker",
        source: { kind: "prompt", prompt: "a speaker at a desk" },
      });
      assert.equal(character.status, 201, character.text);
      const render = await hit(app.base, "/api/render", ownerLogin.cookie, "POST", {
        characters: [{ id: "c1", name: "Fixture Speaker" }],
        template: "solo",
        scenario: "studio",
        topic: "opaque owner lock",
      });
      assert.equal(render.status, 202, render.text);
      const ownerCalls = seen.filter((call) => !call.path.startsWith("/v1/health") && !call.path.startsWith("/v1/tones"));
      assert.ok(ownerCalls.length >= 4);
      for (const call of ownerCalls) {
        assert.equal(call.user, owner.id);
        assert.equal(call.user.includes("@"), false);
        assert.equal(call.user === owner.email, false);
      }
      for (const call of seen.filter((item) => item.path.startsWith("/v1/health") || item.path.startsWith("/v1/tones"))) {
        assert.equal(call.user, null);
      }
      const ledger = (await listEntries()).entries.find((entry) => entry.userId === owner.id && entry.operation === "render" && entry.jobRef);
      assert.ok(ledger);
      assert.equal(ledger.provider, "deepseek");
      assert.equal(ledger.model, "deepseek-flash");
      assert.equal(ledger.inputTokens, 11);
      assert.equal(ledger.outputTokens, 4);
      assert.equal(ledger.reportedMinor, null);

      const before = seen.length;
      const anonJob = await hit(app.base, `/api/jobs/${jobId}`);
      const anonFile = await hit(app.base, `/api/files/${filePath}`);
      assert.equal(anonJob.status, 401);
      assert.equal(anonFile.status, 401);
      const otherJob = await hit(app.base, `/api/jobs/${jobId}`, userLogin.cookie);
      const otherFile = await hit(app.base, `/api/files/${filePath}`, userLogin.cookie);
      assert.equal(otherJob.status, 404);
      assert.equal(otherFile.status, 404);
      for (const response of [anonJob, anonFile, otherJob, otherFile]) {
        assert.equal(response.text.includes("Fixture Speaker"), false);
        assert.equal(response.text.includes(filePath), false);
        assert.equal(response.text.includes(owner.email), false);
      }
      assert.equal(seen.length, before);

      const ownJob = await hit(app.base, `/api/jobs/${jobId}`, ownerLogin.cookie);
      assert.equal(ownJob.status, 200, ownJob.text);
      assert.equal(ownJob.text.includes("Fixture Speaker"), true);
      const ownFile = await hit(app.base, `/api/files/${filePath}`, ownerLogin.cookie);
      assert.equal(ownFile.status, 200, ownFile.text);
      assert.equal(ownFile.text, "clip-bytes");
      const jobFetch = seen.filter((call) => call.path.startsWith(`/v1/jobs/${jobId}`));
      const fileFetch = seen.filter((call) => call.path.startsWith(`/v1/files/${filePath}`));
      assert.equal(jobFetch.length, 1);
      assert.equal(fileFetch.length, 1);
      assert.equal(jobFetch[0]?.user, owner.id);
      assert.equal(fileFetch[0]?.user, owner.id);
    } finally {
      await app.stop();
      await new Promise<void>((resolve) => core.close(() => resolve()));
    }
    } finally {
      await removeTestAccounts(ids);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lets an admin call the core mock once and does not write a web spend row", { timeout: 180_000 }, async () => {
    const posts: { user: string | undefined; generate: boolean; idempotency: string; requestId: string; reuse: boolean }[] = [];
    let ownerHeader = "";
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const layer = (name: string, x: number, y: number) => ({ name, url: png, x, y, w: 8, h: 8, z: 1 });
    const puppet = {
      id: "avmock01",
      schema: "animind.puppet.v3",
      name: "Ada",
      status: "review_required",
      ready: false,
      defects: ["provider_fixture", "view_profile_missing"],
      views: {
        front: {
          canvas: { w: 80, h: 100 },
          layers: [layer("head", 10, 8), layer("torso", 16, 70)],
          visemes: { X: layer("mouth_X", 30, 48) },
          expressions: { neutral: layer("expression_neutral", 30, 48) },
          eyeRig: { maxShift: [4, 3], irises: [[28, 36, 3], [48, 36, 3]] },
          mouthQA: { anchor: { x: 38, y: 52, nose: [40, 30], chin: [40, 70], view: "front", along: 0.5, moustacheBottom: 58 } },
        },
        left: { canvas: { w: 80, h: 100 }, layers: [layer("head", 12, 8)], visemes: { X: layer("mouth_X", 20, 48) } },
      },
      scenario: { embedded: false, control: "shared", states: ["on", "off"] },
      qa: { costUsd: null },
      provenance: { realImage: false },
      usage: { schema: "animind.usage.v1", calls: [], totals: { calls: 0, estimatedMicro: null, reportedMicro: null } },
    };
    const core = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const user = request.headers["x-animind-user"];
        const header = Array.isArray(user) ? user[0] : user;
        if (request.method === "POST" && request.url === "/v1/avatars") {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { generate?: unknown; reuse?: unknown; requestedResolution?: unknown };
          const idempotency = request.headers["idempotency-key"];
          const requestId = request.headers["x-request-id"];
          posts.push({
            user: header,
            generate: body.generate === true,
            reuse: body.reuse === false && !("requestedResolution" in body),
            idempotency: typeof idempotency === "string" ? idempotency : "",
            requestId: typeof requestId === "string" ? requestId : "",
          });
          ownerHeader = header ?? "";
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(puppet));
          return;
        }
        if (request.method === "GET" && request.url === "/v1/avatars/avmock01" && header && header === ownerHeader) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(puppet));
          return;
        }
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ detail: "avatar not found" }));
      });
    });
    const corePort = await new Promise<number>((resolve) => {
      core.listen(0, "127.0.0.1", () => {
        const address = core.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    const dir = await mkdtemp(path.join(os.tmpdir(), "animind-iso-avatar-"));
    process.env.ANIMINDLY_DATA_DIR = dir;
    process.env.ANIMINDLY_SKIP_ENV_FILE = "1";
    process.env.ANIMINDLY_AUTH_SECRET = randomBytes(24).toString("base64url");
    process.env.ANIMINDLY_SKIP_CHARACTER_IMPORT = "1";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_STORE_ID;
    delete process.env.VERCEL;
    const password = randomBytes(18).toString("base64url");
    const owner = await upsertPilotSuperAdmin(`avatar-owner-${randomBytes(3).toString("hex")}@example.com`, password);
    const ids = [owner.id];
    const price = ownerPriceTable().replace(
      '"entries":[',
      '"entries":[{"operation":"avatar","provider":"core","model":"unspecified","currency":"USD","minor":1,"unit":"call","source":"fixture, not an official rate","sourceDate":"2026-11-07"},',
    );
    try {
      const user = await createAccount(owner, {
        email: `avatar-user-${randomBytes(3).toString("hex")}@example.com`,
        name: "Visitor",
        password,
        role: "user",
      });
      const admin = await createAccount(owner, {
        email: `avatar-admin-${randomBytes(3).toString("hex")}@example.com`,
        name: "Admin",
        password,
        role: "admin",
      });
      assert.equal(user.ok && admin.ok, true);
      if (!user.ok || !admin.ok) return;
      ids.push(user.value.id, admin.value.id);
      const app = await startApp(dir, {
        ANIMINDLY_CORE_URL: `http://127.0.0.1:${corePort}`,
        ANIMINDLY_PRICE_TABLE_JSON: price,
      });
      try {
        const body = { prompt: "A speech by Ada", language: "en-US" };
        const anon = await hit(app.base, "/api/avatars", undefined, "POST", body);
        assert.equal(anon.status, 401);
        const userLogin = await login(app.base, user.value.email, password);
        const adminLogin = await login(app.base, admin.value.email, password);
        const visitor = await hit(app.base, "/api/avatars", userLogin.cookie, "POST", body);
        assert.equal(visitor.status, 403);
        assert.equal(JSON.parse(visitor.text).code, "unapproved");
        assert.equal(posts.length, 0);
        const first = await hit(app.base, "/api/avatars", adminLogin.cookie, "POST", body);
        assert.equal(first.status, 200, first.text);
        const made = JSON.parse(first.text) as {
          requestId: string;
          cost: string;
          coreMicro: number | null;
          review: { status: string; ready: boolean; defects: string[] };
          views: Record<string, { layers: unknown[] }>;
          scenery: { separate: boolean; embedded: boolean };
          anchors: { view: string; mouth: boolean; eyes: boolean }[];
        };
        assert.equal(made.requestId, "avmock01");
        assert.equal(made.review.status, "review_required");
        assert.equal(made.review.ready, false);
        assert.equal(made.review.defects.includes("provider_fixture"), true);
        assert.equal("profile" in made.views, false);
        assert.equal(made.views.front.layers.length, 2);
        assert.equal(made.scenery.separate, true);
        assert.equal(made.scenery.embedded, false);
        assert.equal(made.anchors.some((item) => item.view === "front" && item.mouth && item.eyes), true);
        assert.equal(made.cost, "unknown");
        assert.equal(made.coreMicro, null);
        assert.equal(first.text.includes("$0"), false);
        assert.equal(first.text.includes("\"ready\":true"), false);
        const again = await hit(app.base, "/api/avatars", adminLogin.cookie, "POST", body);
        assert.equal(again.status, 200, again.text);
        assert.equal(JSON.parse(again.text).requestId, "avmock01");
        assert.equal(posts.length, 1);
        assert.equal(posts[0]?.generate, true);
        assert.equal(posts[0]?.reuse, true);
        assert.match(posts[0]?.idempotency ?? "", /^[A-Za-z0-9_-]{8,80}$/);
        assert.match(posts[0]?.requestId ?? "", /^[A-Za-z0-9_-]{8,80}$/);
        const seen = await hit(app.base, "/api/avatars?requestId=avmock01", adminLogin.cookie);
        assert.equal(seen.status, 200, seen.text);
        assert.equal(JSON.parse(seen.text).review.ready, false);
        const hidden = await hit(app.base, "/api/avatars?requestId=avmock01", userLogin.cookie);
        assert.equal(hidden.status, 404);
        assert.equal(hidden.text.includes("provider_fixture"), false);
        assert.equal((await hit(app.base, "/api/admin/spend", adminLogin.cookie)).status, 403);
        assert.equal((await hit(app.base, "/api/admin/spend", userLogin.cookie)).status, 403);
        const rows = (await listEntries()).entries.filter((entry) => (
          (entry.userId === admin.value.id || entry.userId === user.value.id) && entry.operation === "avatar"
        ));
        assert.equal(rows.length, 0);
      } finally {
        await app.stop();
      }
    } finally {
      await new Promise<void>((resolve) => core.close(() => resolve()));
      await removeTestAccounts(ids);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves none of its accounts in postgres", async () => {
    await removeTestAccounts([]);
  });
});

async function removeTestAccounts(ids: string[]): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const found = await client.query<{ id: string }>(
      "SELECT id FROM animind_users WHERE id = ANY($1::text[]) OR email LIKE ANY($2::text[])",
      [ids, testEmails],
    );
    const all = [...new Set([...ids, ...found.rows.map((row) => row.id)])];
    if (all.length === 0) return;
    const characters = await client.query<{ id: string }>(
      "SELECT id FROM animind_characters WHERE owner_id = ANY($1::text[])",
      [all],
    );
    for (const row of characters.rows) await deleteObjectPrefix(row.id);
    const scopes = all.map((id) => `user:${id}`);
    for (const statement of [
      "DELETE FROM animind_assets WHERE owner_id = ANY($1::text[])",
      "DELETE FROM animind_characters WHERE owner_id = ANY($1::text[])",
      "DELETE FROM animind_owned WHERE user_id = ANY($1::text[])",
      "DELETE FROM animind_mock_jobs WHERE user_id = ANY($1::text[])",
      "DELETE FROM animind_spend_entries WHERE user_id = ANY($1::text[])",
      "DELETE FROM animind_spend_replay WHERE user_id = ANY($1::text[])",
      "DELETE FROM animind_spend_rates WHERE user_id = ANY($1::text[])",
      "DELETE FROM animind_spend_holds WHERE scope = ANY($1::text[])",
      "DELETE FROM animind_users WHERE id = ANY($1::text[])",
    ]) {
      const params = statement.includes("animind_spend_holds") ? [scopes] : [all];
      try {
        await client.query(statement, params);
      } catch (error) {
        if ((error as { code?: string }).code !== "42P01") throw error;
      }
    }
    const left = await client.query(
      "SELECT email FROM animind_users WHERE id = ANY($1::text[]) OR email LIKE ANY($2::text[])",
      [all, testEmails],
    );
    assert.equal(left.rows.length, 0, left.rows.map((row) => row.email).join(","));
  } finally {
    await client.end();
  }
}

async function hit(base: string, urlPath: string, cookie?: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  return { status: response.status, text: await response.text() };
}

async function login(base: string, email: string, password: string) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const text = await response.text();
  const body = JSON.parse(text) as { user: { generationEnabled: boolean } };
  const line = (response.headers.getSetCookie?.() ?? []).find((item) => item.startsWith("animind_session=")) ?? "";
  const match = line.match(/animind_session=([^;]+)/);
  assert.ok(match);
  return { cookie: `animind_session=${match[1]}`, user: body.user, text };
}

function ownerPriceTable(): string {
  const entry = (operation: string) => ({
    operation,
    provider: "core",
    model: "unspecified",
    currency: "USD",
    minor: 1,
    unit: "call",
    source: "fixture, not an official rate",
    sourceDate: "2026-11-07",
  });
  return JSON.stringify({
    version: "test-2026-11-07",
    source: "fixture, not an official rate",
    sourceDate: "2026-11-07",
    entries: ["plan", "persona_sheet", "character", "render"].map(entry),
  });
}

async function startApp(dir: string, extra: Record<string, string> = {}): Promise<{ base: string; stop: () => Promise<void> }> {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const value = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(value));
    });
  });
  const child: ChildProcess = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root,
    env: {
      ...process.env,
      ANIMINDLY_DATA_DIR: dir,
      ANIMINDLY_COOKIE_SECURE: "0",
      ANIMINDLY_SKIP_CHARACTER_IMPORT: "1",
      ANIMINDLY_GENERATION: "1",
      ANIMINDLY_GENERATION_CONCURRENCY: "1",
      ANIMINDLY_SPEND_BUDGET_CENTS: "1",
      ANIMINDLY_SPEND_USER_CENTS: "1",
      ANIMINDLY_SPEND_TIMEOUT_MS: "1000",
      ANIMINDLY_SPEND_MAX_RETRIES: "0",
      ANIMINDLY_SPEND_RATE_PER_MIN: "10",
      ANIMINDLY_SPEND_MAX_INPUT_TOKENS: "100",
      ANIMINDLY_SPEND_MAX_OUTPUT_TOKENS: "100",
      ANIMINDLY_SPEND_MAX_TOTAL_TOKENS: "200",
      ANIMINDLY_SPEND_MAX_IMAGES: "0",
      ANIMINDLY_SPEND_MAX_AUDIO_SEC: "0",
      ANIMINDLY_SPEND_MAX_VIDEO_SEC: "0",
      ANIMINDLY_CORE_URL: "",
      ANIMIND_CORE_URL: "",
      CORE_URL: "",
      ANIMINDLY_CORE_MOCK: "",
      ANIMINDLY_PRICE_TABLE_JSON: "",
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => { log += chunk; });
  child.stderr?.on("data", (chunk) => { log += chunk; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 40_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${base}/api/health`)).ok) {
        ready = true;
        break;
      }
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error(`next start did not become ready: ${log}`);
  }
  return {
    base,
    stop: () => new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    }),
  };
}
