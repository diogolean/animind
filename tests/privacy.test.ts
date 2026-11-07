import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { accountForVerifiedGoogle, assetFor, characterFor, charactersFor, createAccount, saveAsset, upsertPilotSuperAdmin } from "../lib/accounts/store";
import { importOwnedCharacter } from "../scripts/import-character";

const root = process.cwd();
let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "animind-privacy-"));
  process.env.ANIMINDLY_DATA_DIR = dir;
  delete process.env.ANIMIND_DATA_DIR;
  process.env.ANIMINDLY_SKIP_ENV_FILE = "1";
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  delete process.env.VERCEL;
  process.env.ANIMINDLY_AUTH_SECRET = randomBytes(24).toString("base64url");
  delete process.env.ANIMIND_AUTH_SECRET;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("private Einstein packs", () => {
  it("keeps the two packs out of public/ and does not mix their files", async () => {
    await assert.rejects(access(path.join(root, "public/characters/einstein_approved")));
    await access(path.join(root, "private/characters/einstein-realista/views/front.png"));
    await access(path.join(root, "private/characters/einstein-realista/views/three-quarter.png"));
    await access(path.join(root, "private/characters/einstein-realista/views/three-quarter-right.png"));
    await assert.rejects(access(path.join(root, "private/characters/einstein-realista/demo/einstein_en.mp4")));
    await access(path.join(root, "private/characters/einstein-charge/views/front.png"));
    await access(path.join(root, "private/characters/einstein-charge/demo/einstein_pt.mp4"));
    await access(path.join(root, "private/characters/einstein-charge/demo/einstein_en.mp4"));
    await assert.rejects(access(path.join(root, "private/characters/einstein-charge/views/three-quarter.png")));
    await assert.rejects(access(path.join(root, "private/characters/einstein-charge/views/three-quarter-right.png")));
    const realista = await readFile(path.join(root, "private/characters/einstein-realista/puppet.json"), "utf8");
    const charge = await readFile(path.join(root, "private/characters/einstein-charge/puppet.json"), "utf8");
    assert.match(realista, /Einstein realista/);
    assert.match(charge, /Einstein charge/);
    assert.doesNotMatch(realista, /einstein_en\.mp4|emotion-sheet-en/);
    assert.doesNotMatch(charge, /three-quarter-right/);
  });

  it("hides one account's characters and media from anonymous visitors and from another account", async () => {
    const password = randomBytes(18).toString("base64url");
    const owner = await upsertPilotSuperAdmin(`owner-${randomBytes(3).toString("hex")}@example.com`, password);
    assert.equal(owner.role, "super_admin");
    const other = await createAccount(owner, {
      email: `other-${randomBytes(3).toString("hex")}@example.com`,
      name: "Outra conta",
      password,
      role: "user",
    });
    assert.equal(other.ok, true);
    if (!other.ok) return;
    const newbie = await accountForVerifiedGoogle(`new-${randomBytes(3).toString("hex")}@example.com`, "Visitante");
    assert.equal(owner.generationEnabled, true);
    assert.equal(newbie?.role, "user");
    assert.equal(newbie?.generationEnabled, false);
    assert.notEqual(newbie?.id, owner.id);

    const imported = await importOwnedCharacter({
      email: owner.email,
      dir: path.join(root, "private/characters/einstein-charge"),
      name: "Einstein charge",
    });
    const realista = await importOwnedCharacter({
      email: owner.email,
      dir: path.join(root, "private/characters/einstein-realista"),
      name: "Einstein realista",
    });
    assert.equal(imported.ownerId, owner.id);
    assert.equal(realista.ownerId, owner.id);
    assert.notEqual(imported.id, realista.id);
    assert.equal(imported.name, "Einstein charge");
    assert.equal(imported.views.front ? true : false, true);
    assert.equal(imported.views.three_quarter_left, undefined);
    assert.equal(imported.views.three_quarter_right, undefined);
    assert.equal(Boolean(realista.views.front && realista.views.three_quarter_left && realista.views.three_quarter_right), true);
    assert.equal(realista.demos?.some((demo) => demo.kind === "video") ?? false, false);
    assert.ok(imported.demos?.some((demo) => demo.kind === "video" && demo.label.includes("einstein_pt")));
    assert.equal(imported.catalog, undefined);
    assert.equal(realista.layers.some((layer) => layer.url.includes("/expressions/")), true);
    assert.equal(imported.layers.some((layer) => layer.url.includes("three-quarter")), false);

    assert.ok(newbie);
    assert.equal(await characterFor(other.value, imported.id), null);
    assert.equal(await characterFor(other.value, realista.id), null);
    assert.equal(await characterFor(newbie, imported.id), null);
    assert.equal(await characterFor(newbie, realista.id), null);
    assert.equal(await characterFor(other.value, "chr_guessed"), null);
    assert.equal(await characterFor(newbie, "chr_einstein_approved"), null);
    const otherLibrary = await charactersFor(other.value);
    const newbieLibrary = await charactersFor(newbie);
    assert.equal(otherLibrary.some((character) => character.id === imported.id || character.id === realista.id), false);
    assert.equal(newbieLibrary.some((character) => character.id === imported.id || character.id === realista.id), false);
    assert.equal(otherLibrary.length, 0);
    assert.equal(newbieLibrary.length, 0);
    const visibleToOwner = await charactersFor(owner);
    assert.equal(visibleToOwner.some((character) => character.id === imported.id), true);
    assert.equal(visibleToOwner.some((character) => character.id === realista.id), true);

    const asset = await saveAsset(owner.id, {
      kind: "video",
      name: "demo privado",
      url: imported.demos?.find((demo) => demo.kind === "video")?.url ?? "/api/library/assets/characters/missing/demo.mp4",
      characterId: imported.id,
    });
    assert.equal(await assetFor(other.value, asset.id), null);
    assert.equal((await assetFor(owner, asset.id))?.id, asset.id);

    const app = await startApp();
    try {
      const front = realista.views.front ?? "";
      assert.match(front, /^\/api\/library\/assets\//);
      const anonLibrary = await hit(app.base, "/api/library");
      const anonApproved = await hit(app.base, "/api/library/approved");
      const anonRealista = await hit(app.base, `/api/library/${realista.id}`);
      const anonCharge = await hit(app.base, `/api/library/${imported.id}`);
      const anonAsset = await hit(app.base, front);
      const anonGuess = await hit(app.base, "/api/library/chr_einstein_approved");
      const anonStatic = await hit(app.base, "/characters/einstein_approved/views/front.png");
      for (const response of [anonLibrary, anonApproved, anonRealista, anonCharge, anonAsset, anonGuess]) {
        assert.equal(response.status, 401);
        assert.equal(response.text.includes("Einstein realista"), false);
        assert.equal(response.text.includes("Einstein charge"), false);
      }
      assert.equal(anonStatic.status, 404);

      const otherCookie = await login(app.base, other.value.email, password);
      const otherLibrary = await hit(app.base, "/api/library", otherCookie);
      assert.equal(otherLibrary.status, 200);
      const otherBody = JSON.parse(otherLibrary.text) as { characters: { id: string }[]; viewer: { role: string } };
      assert.deepEqual(otherBody.characters, []);
      assert.equal(otherBody.viewer.role, "user");
      assert.equal((await hit(app.base, `/api/library/${realista.id}`, otherCookie)).status, 404);
      assert.equal((await hit(app.base, `/api/library/${imported.id}`, otherCookie)).status, 404);
      assert.equal((await hit(app.base, front, otherCookie)).status, 404);
      assert.equal((await hit(app.base, "/api/library/chr_einstein_approved", otherCookie)).status, 404);
      const otherApproved = await hit(app.base, "/api/library/approved", otherCookie);
      assert.equal(otherApproved.status, 200);
      assert.deepEqual(JSON.parse(otherApproved.text), { characters: [] });
      assert.equal((await hit(app.base, `/api/library/${realista.id}`, otherCookie, "PATCH", { status: "ready" })).status, 404);
      assert.equal((await hit(app.base, `/api/library/${realista.id}`, otherCookie, "DELETE")).status, 404);

      const ownerCookie = await login(app.base, owner.email, password);
      const ownerLibrary = await hit(app.base, "/api/library", ownerCookie);
      assert.equal(ownerLibrary.status, 200);
      const ownerBody = JSON.parse(ownerLibrary.text) as { characters: { id: string; name: string }[]; viewer: { role: string; id: string } };
      assert.equal(ownerBody.viewer.role, "super_admin");
      assert.equal(ownerBody.viewer.id, owner.id);
      assert.equal(ownerBody.characters.some((character) => character.id === realista.id && character.name === "Einstein realista"), true);
      assert.equal(ownerBody.characters.some((character) => character.id === imported.id && character.name === "Einstein charge"), true);
      const ownerApproved = await hit(app.base, "/api/library/approved", ownerCookie);
      assert.deepEqual(JSON.parse(ownerApproved.text), { characters: [] });
      const detail = await hit(app.base, `/api/library/${realista.id}`, ownerCookie);
      assert.equal(detail.status, 200);
      assert.equal(detail.text.includes(realista.id), true);
      const media = await hit(app.base, front, ownerCookie);
      assert.equal(media.status, 200);
      assert.match(media.contentType, /^image\//);
    } finally {
      await app.stop();
    }
  });
});

async function hit(base: string, urlPath: string, cookie?: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await response.text();
  return { status: response.status, text, contentType: response.headers.get("content-type") ?? "" };
}

async function login(base: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const line = (response.headers.getSetCookie?.() ?? []).find((item) => item.startsWith("animind_session="))
    ?? response.headers.get("set-cookie")
    ?? "";
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

async function startApp(): Promise<{ base: string; stop: () => Promise<void> }> {
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root,
    env: { ...process.env, ANIMINDLY_COOKIE_SECURE: "0" },
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
      // The server is still binding the port.
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
