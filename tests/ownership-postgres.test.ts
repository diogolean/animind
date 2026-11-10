import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { importCharacterPackage } from "../lib/accounts/import-character";
import { deleteObject, deleteObjectPrefix, keyFromAssetUrl } from "../lib/accounts/object-store";
import { rememberOwned } from "../lib/accounts/owned";
import { SESSION_TTL_SEC, signSession } from "../lib/accounts/session";
import { createAccount, saveAsset, upsertPilotSuperAdmin } from "../lib/accounts/store";
import type { PublicUser } from "../lib/accounts/types";
import { loadMockJob, newMockJobId, saveMockJob } from "../lib/mock-jobs";
import { isIsolatedPostgresHost } from "../lib/spend/sql";

/**
 * Two accounts against the CI Postgres service (postgres:16 in ci.yml).
 * tests/privacy.test.ts and tests/accounts.test.ts delete DATABASE_URL and use the file store.
 * tests/isolation-postgres.test.ts uses this database for status checks and deletes its rows.
 * tests/spend-postgres.test.ts uses this database for the ledger limits, not for ownership.
 */

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

type Hit = { status: number; text: string; contentType: string };
type App = { base: string; stop: () => Promise<void> };
type Accounts = {
  password: string;
  spendAdmin: PublicUser;
  a: PublicUser;
  b: PublicUser;
  roleAdmin: PublicUser;
  close: () => Promise<void>;
};

const skip = url ? false : "isolated DATABASE_URL is not set";
let dir = "";
let secret = "";
let app: App | null = null;
let core: { base: string; hits: string[]; close: () => Promise<void> } | null = null;

describe("postgres ownership", { skip, concurrency: false, timeout: 120_000 }, () => {
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "animind-own-"));
    secret = randomBytes(24).toString("base64url");
    process.env.ANIMINDLY_DATA_DIR = dir;
    process.env.ANIMINDLY_SKIP_ENV_FILE = "1";
    process.env.ANIMINDLY_AUTH_SECRET = secret;
    process.env.ANIMINDLY_SKIP_CHARACTER_IMPORT = "1";
    process.env.POSTGRES_URL = "";
    process.env.BLOB_STORE_ID = "";
    process.env.BLOB_READ_WRITE_TOKEN = "";
    process.env.VERCEL = "";
    core = await startCore();
    app = await startApp(dir, secret, core.base);
  }, { timeout: 60_000 });

  after(async () => {
    await app?.stop();
    await core?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("hides A's library, pack, and asset from B with the same response as a missing id", async () => {
    const accounts = await openAccounts();
    try {
      const pack = await importPack(accounts.a.id);
      const script = await saveAsset(accounts.a.id, {
        kind: "script",
        name: pack.name,
        text: pack.prompt,
        characterId: pack.id,
      });
      const scriptUrl = script.url ?? "";
      assert.match(scriptUrl, /^\/api\/library\/assets\/assets\//);
      const scriptKey = keyFromAssetUrl(scriptUrl);
      const base = appBase();
      const aCookie = await login(base, accounts.a.email, accounts.password);
      const bCookie = await login(base, accounts.b.email, accounts.password);
      const secrets = [pack.name, pack.prompt, pack.puppetKey, accounts.a.email, scriptUrl];

      const aList = await hit(base, "/api/library", aCookie);
      assert.equal(aList.status, 200, aList.text);
      assert.equal(aList.text.includes(pack.id), true);
      assert.equal(aList.text.includes(pack.name), true);
      const bList = await hit(base, "/api/library", bCookie);
      assert.equal(bList.status, 200, bList.text);
      assert.equal(bList.text.includes(pack.id), false);
      assertHidden(bList, secrets);
      const bCatalog = await hit(base, "/api/library/catalog", bCookie);
      assert.equal(bCatalog.status, 200, bCatalog.text);
      assert.equal(bCatalog.text.includes(pack.id), false);
      assertHidden(bCatalog, secrets);

      const missingId = `chr_${randomBytes(9).toString("hex")}`;
      await assertDenied(base, bCookie, `/api/library/${pack.id}`, `/api/library/${missingId}`);
      await assertDenied(base, bCookie, `/api/library/${pack.id}`, `/api/library/${missingId}`, "PATCH", { status: "archived" });
      await assertDenied(base, bCookie, `/api/library/${pack.id}`, `/api/library/${missingId}`, "DELETE");

      const missingAsset = `/api/library/assets/assets/ast_${randomBytes(9).toString("hex")}/text.txt`;
      const missingPuppet = `/api/library/assets/characters/${missingId}/puppet.json`;
      const missingFront = `/api/library/assets/characters/${missingId}/views/front.png`;
      await assertDenied(base, bCookie, scriptUrl, missingAsset);
      await assertDenied(base, bCookie, pack.puppetUrl, missingPuppet);
      await assertDenied(base, bCookie, pack.frontUrl, missingFront);
      for (const response of [
        await hit(base, scriptUrl, bCookie),
        await hit(base, pack.puppetUrl, bCookie),
        await hit(base, pack.frontUrl, bCookie),
      ]) {
        assertHidden(response, secrets);
      }

      const still = await hit(base, `/api/library/${pack.id}`, aCookie);
      assert.equal(still.status, 200, still.text);
      const character = JSON.parse(still.text).character as { name: string; status: string };
      assert.equal(character.name, pack.name);
      assert.equal(character.status, pack.status);
      const ownedScript = await hit(base, scriptUrl, aCookie);
      assert.equal(ownedScript.status, 200, ownedScript.text);
      assert.equal(ownedScript.text.includes(pack.prompt), true);
      const ownedPuppet = await hit(base, pack.puppetUrl, aCookie);
      assert.equal(ownedPuppet.status, 200, ownedPuppet.text);
      assert.equal(ownedPuppet.text.includes(pack.prompt), true);
      await deleteObjectPrefix(pack.id);
      if (scriptKey) await deleteObject(scriptKey);
    } finally {
      await accounts.close();
    }
  });

  it("hides A's job and render file from B with the same response as a missing id", async () => {
    const accounts = await openAccounts();
    const token = randomBytes(6).toString("hex");
    const name = `PackName${token}`;
    const prompt = `PromptSecret${token}`;
    const jobId = newMockJobId();
    const missingJob = newMockJobId();
    const fileKey = `clips/keysecret${token}.bin`;
    const missingFile = `clips/missing${token}.bin`;
    const request = {
      characters: [{ id: "c1", name }],
      template: "solo",
      scenario: "studio",
      topic: prompt,
    };
    const hitsBefore = core?.hits.length ?? 0;
    try {
      await saveMockJob({ id: jobId, userId: accounts.a.id, createdAt: Date.now() - 20_000, request });
      await rememberOwned(accounts.a.id, JSON.stringify({ id: jobId, status: "queued", videoUrl: `/api/files/${fileKey}` }));
      const base = appBase();
      const aCookie = await login(base, accounts.a.email, accounts.password);
      const bCookie = await login(base, accounts.b.email, accounts.password);
      const adminCookie = await login(base, accounts.spendAdmin.email, accounts.password);
      const secrets = [name, prompt, fileKey, accounts.a.email];

      await assertDenied(base, bCookie, `/api/jobs/${jobId}`, `/api/jobs/${missingJob}`);
      await assertDenied(base, bCookie, `/api/files/${fileKey}`, `/api/files/${missingFile}`);
      await assertDenied(base, adminCookie, `/api/jobs/${jobId}`, `/api/jobs/${missingJob}`);
      await assertDenied(base, adminCookie, `/api/files/${fileKey}`, `/api/files/${missingFile}`);
      assert.equal(core?.hits.length, hitsBefore);

      const render = await hit(base, "/api/render", bCookie, "POST", {
        characters: [{ id: "c1", name: "Other" }],
        template: "solo",
        scenario: "studio",
        topic: "unrelated",
      });
      assert.equal(render.status === 200 || render.status === 201 || render.status === 202, false, render.text);
      assertHidden(render, secrets);
      const removed = await hit(base, `/api/jobs/${jobId}`, bCookie, "DELETE");
      const missingRemoved = await hit(base, `/api/jobs/${missingJob}`, bCookie, "DELETE");
      assert.equal(removed.status, missingRemoved.status);
      assert.equal(removed.text, missingRemoved.text);
      const stored = await loadMockJob(jobId);
      assert.deepEqual(stored?.request, request);

      const ownJob = await hit(base, `/api/jobs/${jobId}`, aCookie);
      assert.equal(ownJob.status, 200, ownJob.text);
      assert.equal(ownJob.text.includes(prompt), true);
      assert.equal(ownJob.text.includes(name), true);
      const ownFile = await hit(base, `/api/files/${fileKey}`, aCookie);
      assert.equal(ownFile.status, 200, ownFile.text);
      assert.equal(ownFile.text, prompt);
      assert.equal(core?.hits.at(-1)?.includes(accounts.a.id), true);
      assert.equal(core?.hits.some((line) => line.includes(accounts.b.id) || line.includes(accounts.spendAdmin.id)), false);

      for (const response of [await hit(base, `/api/jobs/${jobId}`, bCookie), await hit(base, `/api/files/${fileKey}`, bCookie)]) {
        assertHidden(response, secrets);
      }
    } finally {
      await accounts.close();
    }
  });

  it("refuses spend to a user and an admin role, and lets a super_admin read", async () => {
    const accounts = await openAccounts();
    try {
      const base = appBase();
      const aCookie = await login(base, accounts.a.email, accounts.password);
      const bCookie = await login(base, accounts.b.email, accounts.password);
      const roleCookie = await login(base, accounts.roleAdmin.email, accounts.password);
      const adminCookie = await login(base, accounts.spendAdmin.email, accounts.password);
      const anon = await hit(base, "/api/admin/spend");
      const aSpend = await hit(base, "/api/admin/spend", aCookie);
      const bSpend = await hit(base, "/api/admin/spend", bCookie);
      const roleSpend = await hit(base, "/api/admin/spend", roleCookie);
      const adminSpend = await hit(base, "/api/admin/spend", adminCookie);
      assert.equal(anon.status, 401, anon.text);
      assert.equal(JSON.parse(anon.text).code, "auth_required");
      assert.equal(aSpend.status, 403, aSpend.text);
      assert.equal(bSpend.status, 403, bSpend.text);
      assert.equal(roleSpend.status, 403, roleSpend.text);
      assert.equal(aSpend.text, bSpend.text);
      assert.equal(roleSpend.text, bSpend.text);
      assert.equal(JSON.parse(bSpend.text).code, "forbidden");
      assert.equal(adminSpend.status, 200, adminSpend.text);
      assert.equal(JSON.parse(adminSpend.text).ledger, "ok");
      const hidden = [accounts.a.email, accounts.b.email, accounts.password];
      for (const response of [anon, aSpend, bSpend, roleSpend, adminSpend]) assertHidden(response, hidden);
    } finally {
      await accounts.close();
    }
  });

  it("treats an expired or tampered session the same as signed out", async () => {
    const accounts = await openAccounts();
    try {
      const pack = await importPack(accounts.a.id);
      const base = appBase();
      const aCookie = await login(base, accounts.a.email, accounts.password);
      const live = aCookie.slice("animind_session=".length);
      const expired = signSession(accounts.a.id, secret, Date.now() - SESSION_TTL_SEC * 1000 - 1000);
      const flipped = `${live.slice(0, -1)}${live.endsWith("a") ? "b" : "a"}`;
      const paths = [
        `/api/library/${pack.id}`,
        pack.puppetUrl,
        `/api/jobs/${newMockJobId()}`,
        "/api/admin/spend",
      ];
      const owned = await hit(base, `/api/library/${pack.id}`, aCookie);
      assert.equal(owned.status, 200, owned.text);
      assert.equal(owned.text.includes(pack.name), true);
      for (const urlPath of paths) {
        const anon = await hit(base, urlPath);
        const stale = await hit(base, urlPath, `animind_session=${expired}`);
        const tampered = await hit(base, urlPath, `animind_session=${flipped}`);
        assert.equal(anon.status, 401, anon.text);
        assert.equal(stale.status, anon.status, urlPath);
        assert.equal(stale.text, anon.text, urlPath);
        assert.equal(tampered.status, anon.status, urlPath);
        assert.equal(tampered.text, anon.text, urlPath);
        assertHidden(stale, [pack.name, pack.prompt, accounts.a.email, pack.puppetKey]);
        assertHidden(tampered, [pack.name, pack.prompt, accounts.a.email, pack.puppetKey]);
      }
      await deleteObjectPrefix(pack.id);
    } finally {
      await accounts.close();
    }
  });
});

async function openAccounts(): Promise<Accounts> {
  const password = randomBytes(18).toString("base64url");
  const token = randomBytes(4).toString("hex");
  const spendAdmin = await upsertPilotSuperAdmin(`own-admin-${token}@example.com`, password);
  const a = await createAccount(spendAdmin, { email: `own-a-${token}@example.com`, name: "Conta A", password, role: "user" });
  const b = await createAccount(spendAdmin, { email: `own-b-${token}@example.com`, name: "Conta B", password, role: "user" });
  const roleAdmin = await createAccount(spendAdmin, { email: `own-role-${token}@example.com`, name: "Papel admin", password, role: "admin" });
  assert.equal(a.ok && b.ok && roleAdmin.ok, true);
  if (!a.ok || !b.ok || !roleAdmin.ok) throw new Error("account create failed");
  const ids = [spendAdmin.id, a.value.id, b.value.id, roleAdmin.value.id];
  return {
    password,
    spendAdmin,
    a: a.value,
    b: b.value,
    roleAdmin: roleAdmin.value,
    close: () => removeAccounts(ids),
  };
}

async function importPack(ownerId: string): Promise<{ id: string; name: string; prompt: string; token: string; status: string; puppetUrl: string; puppetKey: string; frontUrl: string; frontKey: string }> {
  const token = randomBytes(6).toString("hex");
  const name = `PackName${token}`;
  const prompt = `PromptSecret${token}`;
  const imported = await importCharacterPackage({
    ownerId,
    name,
    files: [
      {
        path: "puppet.json",
        bytes: Buffer.from(JSON.stringify({
          name,
          prompt,
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
  const puppetUrl = imported.puppetUrl;
  const frontUrl = imported.views.front ?? "";
  const puppetKey = keyFromAssetUrl(puppetUrl) ?? "";
  const frontKey = keyFromAssetUrl(frontUrl) ?? "";
  assert.match(puppetUrl, /^\/api\/library\/assets\//);
  assert.match(frontUrl, /^\/api\/library\/assets\//);
  assert.equal(puppetKey.includes(prompt), false);
  return { id: imported.id, name, prompt, token, status: imported.status, puppetUrl, puppetKey, frontUrl, frontKey };
}

async function removeAccounts(ids: string[]): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const scopes = ids.map((id) => `user:${id}`);
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
      const params = statement.includes("animind_spend_holds") ? [scopes] : [ids];
      try {
        await client.query(statement, params);
      } catch (error) {
        if ((error as { code?: string }).code !== "42P01") throw error;
      }
    }
    const left = await client.query("SELECT id FROM animind_users WHERE id = ANY($1::text[])", [ids]);
    assert.equal(left.rows.length, 0);
  } finally {
    await client.end();
  }
}

function assertHidden(response: Hit, secrets: string[]) {
  for (const secretValue of secrets) {
    assert.equal(secretValue.length > 0 && response.text.includes(secretValue), false, response.text.slice(0, 400));
  }
}

async function assertDenied(base: string, cookie: string, ownedPath: string, missingPath: string, method = "GET", body?: unknown) {
  const owned = await hit(base, ownedPath, cookie, method, body);
  const missing = await hit(base, missingPath, cookie, method, body);
  assert.equal(owned.status, missing.status, `${method} ${ownedPath}\n${owned.text}\n${missing.text}`);
  assert.equal(owned.text, missing.text, `${method} ${ownedPath}`);
  assert.equal(owned.contentType, missing.contentType, `${method} ${ownedPath}`);
}

function appBase(): string {
  if (!app) throw new Error("app not started");
  return app.base;
}

async function hit(base: string, urlPath: string, cookie?: string, method = "GET", body?: unknown): Promise<Hit> {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  return { status: response.status, text: await response.text(), contentType: response.headers.get("content-type") ?? "" };
}

async function login(base: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  await response.text();
  const line = (response.headers.getSetCookie?.() ?? []).find((item) => item.startsWith("animind_session=")) ?? "";
  const match = line.match(/animind_session=([^;]+)/);
  assert.ok(match);
  return `animind_session=${match[1]}`;
}

async function startCore(): Promise<{ base: string; hits: string[]; close: () => Promise<void> }> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    const urlPath = req.url ?? "";
    const header = req.headers["x-animind-user"];
    const user = Array.isArray(header) ? header[0] ?? "" : header ?? "";
    if (urlPath.startsWith("/v1/files/")) hits.push(`${user} ${urlPath}`);
    req.resume();
    if (!urlPath.startsWith("/v1/files/")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing" }));
      return;
    }
    const rel = decodeURIComponent(urlPath.slice("/v1/files/".length).split("?")[0] ?? "");
    const prompt = rel.match(/keysecret([0-9a-f]+)\.bin/)?.[1];
    if (!prompt) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(`PromptSecret${prompt}`);
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  return {
    base: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function startApp(dataDir: string, authSecret: string, coreBase: string): Promise<App> {
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
      DATABASE_URL: url,
      POSTGRES_URL: "",
      ANIMINDLY_DATA_DIR: dataDir,
      ANIMINDLY_AUTH_SECRET: authSecret,
      ANIMIND_AUTH_SECRET: "",
      ANIMINDLY_COOKIE_SECURE: "0",
      ANIMINDLY_SKIP_ENV_FILE: "1",
      ANIMINDLY_SKIP_CHARACTER_IMPORT: "1",
      ANIMINDLY_GENERATION: "",
      ANIMIND_GENERATION: "",
      ANIMINDLY_CORE_URL: coreBase,
      ANIMIND_CORE_URL: "",
      CORE_URL: "",
      ANIMINDLY_CORE_MOCK: "",
      ANIMIND_CORE_MOCK: "",
      ANIMINDLY_CORE_KEY: "",
      ANIMIND_CORE_KEY: "",
      CORE_API_KEY: "",
      BLOB_STORE_ID: "",
      BLOB_READ_WRITE_TOKEN: "",
      VERCEL: "",
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
