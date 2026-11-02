import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { canAssignRole, canSeeAll, canSeeCharacter } from "../lib/accounts/access";
import { importCharacterPackage } from "../lib/accounts/import-character";
import { isSafeObjectKey, keyFromAssetUrl, readObject } from "../lib/accounts/object-store";
import { PILOT_SUPERADMIN_NAME, charactersFor, createAccount, deleteCharacterFor, updateCharacterStatus, upsertPilotSuperAdmin, verifyLogin } from "../lib/accounts/store";
import { puppetToRig } from "../lib/accounts/rig";
import { authSecret, cookieSecure, readSession, signSession } from "../lib/accounts/session";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const root = process.cwd();

let dir = "";

function secret(): string {
  const value = randomBytes(24).toString("base64url");
  process.env.ANIMIND_AUTH_SECRET = value;
  return value;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "animind-accounts-"));
  process.env.ANIMIND_DATA_DIR = dir;
  delete process.env.ANIMIND_COOKIE_SECURE;
  delete process.env.SEED_SUPERADMIN_EMAIL;
  delete process.env.SEED_SUPERADMIN_PASSWORD;
  secret();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function run(script: string, env: Record<string, string>, args: string[] = []) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(path.join(root, "node_modules", ".bin", "tsx"), [script, ...args], {
      cwd: root,
      env: { ...process.env, ...env, ANIMIND_DATA_DIR: dir },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function einsteinFiles(persona = "wikiquote:Albert_Einstein") {
  const puppet = {
    name: "Albert Einstein",
    personaSheetRef: "from-puppet",
    canvas: { w: 64, h: 80 },
    views: {
      front: {
        canvas: { w: 64, h: 80 },
        layers: [{ name: "head", url: "layers/head.png", x: 0, y: 0, w: 64, h: 80, z: 1 }],
        visemes: { X: { name: "mouth", url: "layers/mouth.png", x: 20, y: 40, w: 20, h: 10, z: 2 } },
      },
    },
  };
  return [
    { path: "puppet.json", bytes: Buffer.from(JSON.stringify(puppet)) },
    { path: "persona.txt", bytes: Buffer.from(persona) },
    { path: "layers/head.png", bytes: PNG },
    { path: "layers/mouth.png", bytes: PNG },
    { path: "views/front.png", bytes: PNG },
    { path: "views/three-quarter.png", bytes: PNG },
    { path: "views/profile.png", bytes: PNG },
    { path: "emotion-sheet.png", bytes: PNG },
    { path: "notes/readme.md", bytes: Buffer.from("not a secret") },
    { path: "ignore.psd", bytes: Buffer.from("nope") },
  ];
}

describe("accounts and character library", { concurrency: false }, () => {
  it("keeps object storage and the pilot password out of the repo", async () => {
    const ignore = await readFile(path.join(root, ".gitignore"), "utf8");
    assert.match(ignore, /^\.data\/$/m);
    const seed = await readFile(path.join(root, "scripts", "seed-superadmin.ts"), "utf8");
    const example = await readFile(path.join(root, ".env.example"), "utf8");
    assert.match(seed, /process\.env\.SEED_SUPERADMIN_EMAIL/);
    assert.match(seed, /process\.env\.SEED_SUPERADMIN_PASSWORD/);
    assert.doesNotMatch(seed, /password\s*[:=]\s*["'][^"']+["']/);
    assert.doesNotMatch(seed, /@[a-z0-9.-]+\.[a-z]{2,}/i);
    for (const name of ["SEED_SUPERADMIN_EMAIL", "SEED_SUPERADMIN_PASSWORD", "ANIMIND_AUTH_SECRET", "ANIMIND_DATA_DIR"]) {
      assert.match(example, new RegExp(`^${name}=$`, "m"));
    }
    assert.equal(canSeeAll("user"), false);
    assert.equal(canSeeAll("admin"), false);
    assert.equal(canSeeAll("super_admin"), true);
    assert.equal(canAssignRole("admin", "user"), true);
    assert.equal(canAssignRole("admin", "admin"), false);
    assert.equal(canAssignRole("user", "user"), false);
    assert.equal(canAssignRole("super_admin", "super_admin"), true);
  });

  it("seeds Diogo as super_admin from the environment only", async () => {
    const missing = await run("scripts/seed-superadmin.ts", {});
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /SEED_SUPERADMIN_EMAIL/);
    assert.match(missing.stderr, /SEED_SUPERADMIN_PASSWORD/);

    const email = `pilot-${randomBytes(4).toString("hex")}@example.com`;
    const password = randomBytes(18).toString("base64url");
    const seeded = await run("scripts/seed-superadmin.ts", { SEED_SUPERADMIN_EMAIL: email, SEED_SUPERADMIN_PASSWORD: password });
    assert.equal(seeded.code, 0, seeded.stderr);
    assert.equal(seeded.stdout.includes(password), false);
    assert.equal(seeded.stderr.includes(password), false);
    assert.match(seeded.stdout, new RegExp(`${PILOT_SUPERADMIN_NAME} <${email}> role=super_admin`));

    const user = await verifyLogin(email, password);
    assert.equal(user?.name, "Diogo");
    assert.equal(user?.role, "super_admin");
    assert.equal(JSON.stringify(user).includes("passwordHash"), false);
    assert.equal(await verifyLogin(email, `${password}x`), null);

    const again = await run("scripts/seed-superadmin.ts", { SEED_SUPERADMIN_EMAIL: email, SEED_SUPERADMIN_PASSWORD: password });
    assert.equal(again.code, 0, again.stderr);
    const accounts = JSON.parse(await readFile(path.join(dir, "accounts.json"), "utf8")) as { users: { email: string }[] };
    assert.equal(accounts.users.length, 1);
  });

  it("lets a super_admin see and manage every library, and nobody else", async () => {
    const email = `pilot-${randomBytes(4).toString("hex")}@example.com`;
    const password = randomBytes(18).toString("base64url");
    const superAdmin = await upsertPilotSuperAdmin(email, password);
    assert.equal(superAdmin.name, "Diogo");
    const other = await createAccount(superAdmin, {
      email: `other-${randomBytes(3).toString("hex")}@example.com`,
      name: "Outra",
      password: randomBytes(12).toString("base64url"),
      role: "user",
    });
    const admin = await createAccount(superAdmin, {
      email: `admin-${randomBytes(3).toString("hex")}@example.com`,
      name: "Admin",
      password: randomBytes(12).toString("base64url"),
      role: "admin",
    });
    assert.equal(other.ok && admin.ok, true);
    if (!other.ok || !admin.ok) return;
    const blocked = await createAccount(admin.value, {
      email: `nope-${randomBytes(3).toString("hex")}@example.com`,
      name: "Nope",
      password: randomBytes(12).toString("base64url"),
      role: "admin",
    });
    assert.equal(blocked.ok, false);

    const imported = await importCharacterPackage({ ownerId: other.value.id, name: "Einstein", files: einsteinFiles() });
    assert.equal(imported.name, "Einstein");
    assert.equal(imported.ownerId, other.value.id);
    assert.equal(imported.personaSheetRef, "wikiquote:Albert_Einstein");
    assert.equal(imported.status, "ready");
    assert.ok(imported.views.front?.startsWith("/api/library/assets/"));
    assert.ok(imported.views.three_quarter?.includes("/views/three-quarter.png"));
    assert.ok(imported.views.profile?.includes("/views/profile.png"));
    assert.ok(imported.emotionSheetUrl?.includes("/emotion-sheet.png"));
    assert.equal(imported.layers.some((layer) => layer.name === "head"), true);

    const puppetKey = keyFromAssetUrl(imported.puppetUrl);
    assert.ok(puppetKey);
    const storedPuppet = JSON.parse((await readObject(puppetKey!))!.toString("utf8")) as {
      views: { front: { layers: { url: string }[]; visemes: { X: { url: string } } } };
    };
    assert.match(storedPuppet.views.front.layers[0]!.url, /^\/api\/library\/assets\//);
    assert.match(storedPuppet.views.front.visemes.X.url, /mouth\.png$/);
    const rig = puppetToRig(imported, storedPuppet);
    assert.equal(rig.name, "Einstein");
    assert.equal(rig.status, "ready");
    assert.equal(rig.views.front.layers[0]?.url, storedPuppet.views.front.layers[0]!.url);
    assert.equal(rig.imageUrl, imported.views.front);

    const raw = await readFile(path.join(dir, "accounts.json"), "utf8");
    assert.equal(raw.includes(PNG.toString("base64")), false);
    assert.equal(raw.includes("iVBORw0KGgo"), false);
    const head = await readObject(keyFromAssetUrl(imported.layers.find((layer) => layer.name === "head")!.url)!);
    assert.ok(head && head.equals(PNG));
    assert.equal(isSafeObjectKey("characters/chr_x/../../etc/passwd"), false);
    assert.equal(await readObject(`${puppetKey}/../../../etc/passwd`), null);

    assert.equal(canSeeCharacter(other.value, imported), true);
    assert.equal(canSeeCharacter(admin.value, imported), false);
    assert.equal(canSeeCharacter(superAdmin, imported), true);
    assert.equal((await charactersFor(other.value)).length, 1);
    assert.equal((await charactersFor(admin.value)).length, 0);
    const all = await charactersFor(superAdmin);
    assert.equal(all.length, 1);
    assert.equal(all[0]?.owner?.email, other.value.email);
    assert.equal(await updateCharacterStatus(admin.value, imported.id, "archived"), null);
    assert.equal((await updateCharacterStatus(superAdmin, imported.id, "archived"))?.status, "archived");
    assert.equal(await deleteCharacterFor(admin.value, imported.id), false);
    assert.equal(await deleteCharacterFor(superAdmin, imported.id), true);
    assert.equal(await readObject(puppetKey!), null);
    assert.deepEqual(await charactersFor(superAdmin), []);
  });

  it("imports a character folder from the script into Diogo's account", async () => {
    const email = `pilot-${randomBytes(4).toString("hex")}@example.com`;
    const password = randomBytes(18).toString("base64url");
    await upsertPilotSuperAdmin(email, password);
    const folder = path.join(dir, "einstein");
    await mkdir(path.join(folder, "layers"), { recursive: true });
    await mkdir(path.join(folder, "views"), { recursive: true });
    const files = einsteinFiles();
    for (const file of files) {
      if (file.path === "ignore.psd") continue;
      const dest = path.join(folder, file.path);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, file.bytes);
    }
    const imported = await run("scripts/import-character.ts", {}, ["--dir", folder, "--email", email, "--name", "Einstein"]);
    assert.equal(imported.code, 0, imported.stderr);
    assert.equal(imported.stdout.includes(password), false);
    const summary = JSON.parse(imported.stdout) as { name: string; views: { front?: string }; status: string };
    assert.equal(summary.name, "Einstein");
    assert.equal(summary.status, "ready");
    assert.ok(summary.views.front?.startsWith("/api/library/assets/"));
    const owner = await verifyLogin(email, password);
    assert.equal(owner && (await charactersFor(owner))[0]?.name, "Einstein");
  });

  it("accepts the folder prefix a directory picker adds", async () => {
    const owner = await upsertPilotSuperAdmin(`picker-${randomBytes(3).toString("hex")}@example.com`, randomBytes(12).toString("base64url"));
    const imported = await importCharacterPackage({
      ownerId: owner.id,
      files: einsteinFiles().filter((file) => file.path !== "ignore.psd").map((file) => ({ ...file, path: `einstein/${file.path}` })),
    });
    assert.ok(imported.views.front?.endsWith("/views/front.png"));
    const puppet = JSON.parse((await readObject(keyFromAssetUrl(imported.puppetUrl)!))!.toString("utf8")) as {
      views: { front: { layers: { url: string }[] } };
    };
    assert.match(puppet.views.front.layers[0]!.url, /\/layers\/head\.png$/);
  });

  it("signs a session and refuses a missing auth secret", () => {
    delete process.env.ANIMIND_AUTH_SECRET;
    assert.equal(authSecret(), null);
    const key = secret();
    const token = signSession("usr_123", key, 1_000);
    assert.deepEqual(readSession(token, key, 1_000), { sub: "usr_123" });
    assert.equal(readSession(token, key, 1_000 + 15 * 24 * 60 * 60 * 1000), null);
    assert.equal(readSession(`${token}x`, key, 1_000), null);
    assert.equal(cookieSecure(new Request("http://127.0.0.1/api/auth/login")), false);
    assert.equal(cookieSecure(new Request("https://animind.example/api/auth/login")), true);
  });
});
