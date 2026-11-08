import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { importCharacterPackage } from "../lib/accounts/import-character";
import { createAccount, upsertPilotSuperAdmin } from "../lib/accounts/store";
import { listEntries } from "../lib/spend/ledger";
import { isIsolatedPostgresHost } from "../lib/spend/sql";

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
    const password = randomBytes(18).toString("base64url");
    const owner = await upsertPilotSuperAdmin(`iso-owner-${randomBytes(3).toString("hex")}@example.com`, password);
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
    assert.equal(user.value.generationEnabled, false);
    assert.equal(admin.value.generationEnabled, false);
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
      assert.equal(adminLogin.user.generationEnabled, false);
      const ownerLogin = await login(app.base, owner.email, password);

      const userLibrary = await hit(app.base, "/api/library", userLogin.cookie);
      assert.equal(userLibrary.status, 200);
      assert.deepEqual(JSON.parse(userLibrary.text).characters, []);
      assert.equal((await hit(app.base, `/api/library/${imported.id}`, userLogin.cookie)).status, 404);
      assert.equal((await hit(app.base, front, userLogin.cookie)).status, 404);
      assert.equal((await hit(app.base, "/api/jobs/job_missing", userLogin.cookie)).status, 404);
      assert.equal((await hit(app.base, "/api/files/missing/file.bin", userLogin.cookie)).status, 404);
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
  });
});

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

async function startApp(dir: string): Promise<{ base: string; stop: () => Promise<void> }> {
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
