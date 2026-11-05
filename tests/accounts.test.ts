import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { canAssignRole, canSeeAll, canSeeCharacter } from "../lib/accounts/access";
import { StoreConfigError, databaseUrl, usesBlob } from "../lib/accounts/config";
import { importCharacterPackage } from "../lib/accounts/import-character";
import { isSafeObjectKey, keyFromAssetUrl, readObject } from "../lib/accounts/object-store";
import { GET as finishGoogle } from "../app/api/auth/google/callback/route";
import { GET as startGoogle } from "../app/api/auth/google/route";
import { authOrigin, googleAuthorizeUrl, readOAuthState, safeNext, signOAuthState } from "../lib/accounts/google";
import { PILOT_SUPERADMIN_NAME, accountForVerifiedGoogle, assetsFor, charactersFor, createAccount, deleteCharacterFor, saveAsset, updateCharacterStatus, upsertPilotSuperAdmin, verifyLogin } from "../lib/accounts/store";
import { captureGeneration } from "../lib/library-capture";
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
  delete process.env.ANIMIND_AUTH_SECRET;
  process.env.ANIMINDLY_AUTH_SECRET = value;
  return value;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "animind-accounts-"));
  process.env.ANIMINDLY_DATA_DIR = dir;
  delete process.env.ANIMIND_DATA_DIR;
  process.env.ANIMINDLY_SKIP_ENV_FILE = "1";
  delete process.env.ANIMIND_SKIP_ENV_FILE;
  delete process.env.ANIMINDLY_COOKIE_SECURE;
  delete process.env.ANIMIND_COOKIE_SECURE;
  delete process.env.SEED_SUPERADMIN_EMAIL;
  delete process.env.SEED_SUPERADMIN_PASSWORD;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  delete process.env.VERCEL;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.ANIMINDLY_AUTH_URL;
  delete process.env.ANIMIND_AUTH_URL;
  delete process.env.ANIMINDLY_CHARACTER_ZIP;
  delete process.env.ANIMIND_CHARACTER_ZIP;
  delete process.env.ANIMINDLY_SKIP_CHARACTER_IMPORT;
  delete process.env.ANIMIND_SKIP_CHARACTER_IMPORT;
  secret();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function run(script: string, env: Record<string, string>, args: string[] = []) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(path.join(root, "node_modules", ".bin", "tsx"), [script, ...args], {
      cwd: root,
      env: {
        ...process.env,
        ...env,
        ANIMINDLY_DATA_DIR: dir,
        ANIMIND_DATA_DIR: "",
        ANIMINDLY_SKIP_ENV_FILE: "1",
        ANIMIND_SKIP_ENV_FILE: "",
        DATABASE_URL: "",
        POSTGRES_URL: "",
        BLOB_READ_WRITE_TOKEN: "",
        BLOB_STORE_ID: "",
        VERCEL: "",
      },
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
    assert.match(ignore, /^\*\.zip$/m);
    assert.match(ignore, /^\/uploads\/$/m);
    const seed = await readFile(path.join(root, "scripts", "seed-superadmin.ts"), "utf8");
    const example = await readFile(path.join(root, ".env.example"), "utf8");
    assert.match(seed, /process\.env\.SEED_SUPERADMIN_EMAIL/);
    assert.match(seed, /process\.env\.SEED_SUPERADMIN_PASSWORD/);
    assert.doesNotMatch(seed, /password\s*[:=]\s*["'][^"']+["']/);
    assert.doesNotMatch(seed, /@[a-z0-9.-]+\.[a-z]{2,}/i);
    for (const name of [
      "SEED_SUPERADMIN_EMAIL",
      "SEED_SUPERADMIN_PASSWORD",
      "ANIMINDLY_AUTH_SECRET",
      "ANIMINDLY_DATA_DIR",
      "DATABASE_URL",
      "POSTGRES_URL",
      "BLOB_READ_WRITE_TOKEN",
      "BLOB_STORE_ID",
      "ANIMINDLY_AUTH_URL",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "ANIMINDLY_CHARACTER_ZIP",
    ]) {
      assert.match(example, new RegExp(`^${name}=$`, "m"));
    }
    assert.match(example, /ANIMIND_<NAME> is still read/);
    assert.doesNotMatch(example, /postgres:\/\/|vercel_blob|rw_/);
    const accountsDoc = await readFile(path.join(root, "docs", "ACCOUNTS.md"), "utf8");
    assert.match(accountsDoc, /animind-513520/);
    assert.match(accountsDoc, /Animind web/);
    assert.match(accountsDoc, /http:\/\/localhost:3000\/api\/auth\/google\/callback/);
    assert.match(accountsDoc, /diogolean\/animind/);
    assert.match(accountsDoc, /to confirm/);
    assert.doesNotMatch(accountsDoc, /GOCSPX-|AIza[0-9A-Za-z_-]{10}|sk-[A-Za-z0-9]{10}|postgres:\/\/|rw_[A-Za-z0-9]|BEGIN (RSA |OPENSSH )?PRIVATE KEY/);
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
    const seeded = await run("scripts/seed-superadmin.ts", {
      SEED_SUPERADMIN_EMAIL: email,
      SEED_SUPERADMIN_PASSWORD: password,
      ANIMINDLY_SKIP_CHARACTER_IMPORT: "1",
    });
    assert.equal(seeded.code, 0, seeded.stderr);
    assert.equal(seeded.stdout.includes(password), false);
    assert.equal(seeded.stderr.includes(password), false);
    assert.match(seeded.stdout, new RegExp(`${PILOT_SUPERADMIN_NAME} <${email}> role=super_admin`));

    const user = await verifyLogin(email, password);
    assert.equal(user?.name, "Diogo");
    assert.equal(user?.role, "super_admin");
    assert.equal(JSON.stringify(user).includes("passwordHash"), false);
    assert.equal(await verifyLogin(email, `${password}x`), null);

    const again = await run("scripts/seed-superadmin.ts", {
      SEED_SUPERADMIN_EMAIL: email,
      SEED_SUPERADMIN_PASSWORD: password,
      ANIMINDLY_SKIP_CHARACTER_IMPORT: "1",
    });
    assert.equal(again.code, 0, again.stderr);
    const accounts = JSON.parse(await readFile(path.join(dir, "accounts.json"), "utf8")) as { users: { email: string }[] };
    assert.equal(accounts.users.length, 1);
  });

  it("imports the character zip during seed and replaces that character on the next seed", async () => {
    const email = `pilot-${randomBytes(4).toString("hex")}@example.com`;
    const password = randomBytes(18).toString("base64url");
    const pack = path.join(dir, "pack");
    const zipPath = path.join(dir, "albert_einstein.zip");
    const puppet = {
      name: "Albert Einstein",
      views: {
        front: {
          base: "layers/front/",
          rest: "views/front.png",
          canvas: { w: 8, h: 8 },
          layers: [{ name: "torso", url: "torso.png", x: 0, y: 0, w: 1, h: 1, z: 0 }],
          visemes: {},
        },
        "three-quarter-left": {
          base: "layers/three-quarter-left/",
          rest: "views/three-quarter-left.png",
          canvas: { w: 8, h: 8 },
          layers: [{ name: "head", url: "head.png", x: 0, y: 0, w: 1, h: 1, z: 1 }],
          visemes: {},
        },
        "three-quarter-right": {
          base: "layers/three-quarter-right/",
          rest: "views/three-quarter-right.png",
          canvas: { w: 8, h: 8 },
          layers: [{ name: "head", url: "head.png", x: 0, y: 0, w: 1, h: 1, z: 1 }],
          visemes: {},
        },
      },
    };
    const packed: [string, Buffer][] = [
      ["puppet.json", Buffer.from(JSON.stringify(puppet))],
      ["views/front.png", PNG],
      ["views/three-quarter-left.png", PNG],
      ["views/three-quarter-right.png", PNG],
      ["layers/front/torso.png", PNG],
      ["layers/three-quarter-left/head.png", PNG],
      ["layers/three-quarter-right/head.png", PNG],
      ["emotion-sheet.png", PNG],
    ];
    for (const [rel, bytes] of packed) {
      const dest = path.join(pack, rel);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, bytes);
    }
    const zipped = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(
        "python3",
        [
          "-c",
          [
            "import os, zipfile",
            "root = os.environ['PACK']",
            "dest = os.environ['ZIP']",
            "archive = zipfile.ZipFile(dest, 'w', compression=zipfile.ZIP_DEFLATED)",
            "for current, dirs, names in os.walk(root):",
            "    for name in names:",
            "        full = os.path.join(current, name)",
            "        rel = os.path.relpath(full, root).replace(os.sep, '/')",
            "        archive.write(full, 'albert_einstein/' + rel)",
            "archive.close()",
          ].join("\n"),
        ],
        { env: { ...process.env, PACK: pack, ZIP: zipPath } },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stderr }));
    });
    assert.equal(zipped.code, 0, zipped.stderr);

    const env = { SEED_SUPERADMIN_EMAIL: email, SEED_SUPERADMIN_PASSWORD: password, ANIMINDLY_CHARACTER_ZIP: zipPath };
    const seeded = await run("scripts/seed-superadmin.ts", env);
    assert.equal(seeded.code, 0, seeded.stderr);
    assert.equal(seeded.stdout.includes(password), false);
    const id = seeded.stdout.match(/character Albert Einstein id=(chr_[A-Za-z0-9_-]+)/)?.[1];
    assert.ok(id);
    const again = await run("scripts/seed-superadmin.ts", env);
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, new RegExp(`character Albert Einstein id=${id}`));
    const stored = JSON.parse(await readFile(path.join(dir, "accounts.json"), "utf8")) as {
      characters: { id: string; views: Record<string, string>; emotionSheetUrl: string | null }[];
      assets: { characterId: string; kind: string }[];
    };
    assert.equal(stored.characters.length, 1);
    assert.equal(stored.characters[0]?.id, id);
    assert.ok(stored.characters[0]?.views.front?.endsWith("/views/front.png"));
    assert.ok(stored.characters[0]?.views.three_quarter_left?.endsWith("/views/three-quarter-left.png"));
    assert.ok(stored.characters[0]?.views.three_quarter_right?.endsWith("/views/three-quarter-right.png"));
    assert.ok(stored.characters[0]?.emotionSheetUrl?.endsWith("/emotion-sheet.png"));
    const kinds = stored.assets.filter((item) => item.characterId === id).map((item) => item.kind);
    assert.equal(kinds.filter((kind) => kind === "view").length, 3);
    assert.equal(kinds.filter((kind) => kind === "emotion_sheet").length, 1);
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
    assert.ok(imported.views.three_quarter_left?.includes("/views/three-quarter.png"));
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

  it("imports a view folder without a profile and resolves layers/<view>/ urls", async () => {
    const owner = await upsertPilotSuperAdmin(`views-${randomBytes(3).toString("hex")}@example.com`, randomBytes(12).toString("base64url"));
    const puppet = {
      name: "Albert Einstein",
      views: {
        front: {
          base: "layers/front/",
          rest: "views/front.png",
          canvas: { w: 32, h: 48 },
          layers: [{ name: "torso", url: "torso.png", x: 0, y: 0, w: 8, h: 8, z: 0 }],
          visemes: { X: { name: "mouth_X", url: "mouths/X.png", x: 1, y: 1, w: 4, h: 4, z: 10 } },
        },
        "three-quarter": {
          base: "layers/three-quarter/",
          rest: "views/three-quarter.png",
          canvas: { w: 32, h: 48 },
          layers: [{ name: "head", url: "head.png", x: 0, y: 0, w: 8, h: 8, z: 1 }],
          visemes: {},
        },
      },
    };
    const imported = await importCharacterPackage({
      ownerId: owner.id,
      files: [
        { path: "albert_einstein/puppet.json", bytes: Buffer.from(JSON.stringify(puppet)) },
        { path: "albert_einstein/layers/front/torso.png", bytes: PNG },
        { path: "albert_einstein/layers/front/mouths/X.png", bytes: PNG },
        { path: "albert_einstein/layers/three-quarter/head.png", bytes: PNG },
        { path: "albert_einstein/views/front.png", bytes: PNG },
        { path: "albert_einstein/views/three-quarter.png", bytes: PNG },
        { path: "albert_einstein/emotion-sheet.png", bytes: PNG },
        { path: "albert_einstein/persona.txt", bytes: Buffer.from("Albert Einstein: warm, playful theoretical physicist.\n") },
      ],
    });
    assert.equal(imported.views.profile, undefined);
    assert.ok(imported.views.front?.endsWith("/views/front.png"));
    assert.ok(imported.views.three_quarter_left?.endsWith("/views/three-quarter.png"));
    assert.ok(imported.emotionSheetUrl?.endsWith("/emotion-sheet.png"));
    assert.equal(imported.personaSheetRef, "Albert Einstein: warm, playful theoretical physicist.");
    const stored = JSON.parse((await readObject(keyFromAssetUrl(imported.puppetUrl)!))!.toString("utf8")) as {
      views: {
        front: { layers: { url: string }[]; visemes: { X: { url: string } } };
        "three-quarter": { layers: { url: string }[] };
      };
    };
    assert.match(stored.views.front.layers[0]!.url, /\/layers\/front\/torso\.png$/);
    assert.match(stored.views.front.visemes.X.url, /\/layers\/front\/mouths\/X\.png$/);
    assert.match(stored.views["three-quarter"].layers[0]!.url, /\/layers\/three-quarter\/head\.png$/);
    const rig = puppetToRig(imported, stored);
    assert.equal(rig.views.left.layers[0]?.name, "head");
    assert.equal(rig.views.right.layers.length, 0);

    const withRight = {
      ...puppet,
      views: {
        ...puppet.views,
        "three-quarter-right": {
          base: "layers/three-quarter-right/",
          rest: "views/three-quarter-right.png",
          canvas: { w: 32, h: 48 },
          layers: [{ name: "head", url: "head.png", x: 0, y: 0, w: 8, h: 8, z: 1 }],
          visemes: {},
        },
      },
    };
    const again = await importCharacterPackage({
      ownerId: owner.id,
      files: [
        { path: "puppet.json", bytes: Buffer.from(JSON.stringify(withRight)) },
        { path: "layers/front/torso.png", bytes: PNG },
        { path: "layers/front/mouths/X.png", bytes: PNG },
        { path: "layers/three-quarter/head.png", bytes: PNG },
        { path: "layers/three-quarter-right/head.png", bytes: PNG },
        { path: "views/front.png", bytes: PNG },
        { path: "views/three-quarter.png", bytes: PNG },
        { path: "views/three-quarter-right.png", bytes: PNG },
        { path: "emotion-sheet.png", bytes: PNG },
      ],
    });
    assert.equal(again.id, imported.id);
    assert.ok(again.views.three_quarter_right?.endsWith("/views/three-quarter-right.png"));
    const replaced = JSON.parse((await readObject(keyFromAssetUrl(again.puppetUrl)!))!.toString("utf8")) as {
      views: { "three-quarter-right": { layers: { name: string }[] } };
    };
    assert.equal(puppetToRig(again, replaced).views.right.layers[0]?.name, "head");
    const accounts = JSON.parse(await readFile(path.join(dir, "accounts.json"), "utf8")) as {
      characters: { id: string; name: string }[];
      assets: { characterId: string; kind: string }[];
    };
    assert.equal(accounts.characters.filter((item) => item.name === "Albert Einstein").length, 1);
    const kinds = accounts.assets.filter((item) => item.characterId === again.id).map((item) => item.kind);
    assert.equal(kinds.filter((kind) => kind === "view").length, 3);
    assert.equal(kinds.filter((kind) => kind === "emotion_sheet").length, 1);

    const bare = await importCharacterPackage({
      ownerId: owner.id,
      name: "Bare layers",
      files: [
        {
          path: "puppet.json",
          bytes: Buffer.from(
            JSON.stringify({
              name: "Bare layers",
              views: {
                "three-quarter-right": {
                  canvas: { w: 8, h: 8 },
                  layers: [{ name: "head", url: "head.png", x: 0, y: 0, w: 1, h: 1, z: 1 }],
                  visemes: {},
                },
              },
            }),
          ),
        },
        { path: "layers/three-quarter-right/head.png", bytes: PNG },
        { path: "views/three-quarter-right.png", bytes: PNG },
        { path: "emotion-sheet.jpg", bytes: PNG },
      ],
    });
    assert.ok(bare.views.three_quarter_right?.endsWith("/views/three-quarter-right.png"));
    assert.ok(bare.emotionSheetUrl?.endsWith("/emotion-sheet.jpg"));
    const barePuppet = JSON.parse((await readObject(keyFromAssetUrl(bare.puppetUrl)!))!.toString("utf8")) as {
      views: { "three-quarter-right": { base: string; layers: { url: string }[] } };
    };
    assert.equal(barePuppet.views["three-quarter-right"].base, "layers/three-quarter-right/");
    assert.match(barePuppet.views["three-quarter-right"].layers[0]!.url, /\/layers\/three-quarter-right\/head\.png$/);
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

  it("files every generated asset for its owner, and lets a super admin see all of them", async () => {
    const email = `pilot-${randomBytes(4).toString("hex")}@example.com`;
    const password = randomBytes(18).toString("base64url");
    const superAdmin = await upsertPilotSuperAdmin(email, password);
    const owner = await createAccount(superAdmin, {
      email: `maker-${randomBytes(3).toString("hex")}@example.com`,
      name: "Autor",
      password: randomBytes(12).toString("base64url"),
      role: "user",
    });
    const stranger = await createAccount(superAdmin, {
      email: `other-${randomBytes(3).toString("hex")}@example.com`,
      name: "Outra",
      password: randomBytes(12).toString("base64url"),
      role: "user",
    });
    assert.equal(owner.ok && stranger.ok, true);
    if (!owner.ok || !stranger.ok) return;
    const imported = await importCharacterPackage({ ownerId: owner.value.id, files: einsteinFiles() });
    const importedKinds = (await assetsFor(owner.value)).filter((asset) => asset.characterId === imported.id).map((asset) => asset.kind);
    assert.deepEqual(importedKinds.filter((kind) => kind === "character"), ["character"]);
    assert.equal(importedKinds.filter((kind) => kind === "view").length, 3);
    assert.equal(importedKinds.filter((kind) => kind === "emotion_sheet").length, 1);
    assert.equal((await assetsFor(stranger.value)).length, 0);

    const mono = captureGeneration({
      jobId: "job_mono",
      result: { template: "solo", topic: "aula", script: [{ text: "Uma linha." }], characters: [], audioUrl: null, videoUrl: null },
    });
    assert.equal(mono[0]?.kind, "script");
    const finished = captureGeneration({
      jobId: "job_debate",
      libraryCharacterId: imported.id,
      result: {
        template: "debate",
        topic: "relatividade",
        script: [{ text: "O tempo é relativo." }],
        characters: [{ id: "gen_1", name: "Einstein", imageUrl: "https://example.com/einstein.png" }],
        audioUrl: "https://example.com/voice.mp3",
        videoUrl: "https://example.com/cut.mp4",
      },
    });
    assert.deepEqual(
      finished.map((item) => item.kind),
      ["debate", "audio", "video", "image"],
    );
    for (const item of finished) await saveAsset(owner.value.id, item);
    const debate = await assetsFor(owner.value, "debate");
    assert.equal(debate.length, 1);
    assert.equal(debate[0]?.projectId, "job_debate");
    assert.equal(debate[0]?.characterId, imported.id);
    assert.match(debate[0]?.text ?? "", /O tempo é relativo/);
    const storedText = await readObject(keyFromAssetUrl(debate[0]!.url!)!);
    assert.match(storedText!.toString("utf8"), /O tempo é relativo/);
    assert.equal((await assetsFor(owner.value, "video"))[0]?.url, "https://example.com/cut.mp4");
    assert.equal((await assetsFor(stranger.value, "image")).length, 0);
    const everything = await assetsFor(superAdmin);
    const seen = everything.find((asset) => asset.kind === "debate");
    assert.equal(seen?.owner?.email, owner.value.email);
    assert.equal(await deleteCharacterFor(owner.value, imported.id), true);
    assert.equal((await assetsFor(superAdmin)).some((asset) => asset.characterId === imported.id), false);
  });

  it("keeps the file store unless a hosted database URL is set, and refuses disk on Vercel", async () => {
    assert.equal(databaseUrl(), null);
    assert.equal(usesBlob(), false);
    process.env.DATABASE_URL = "";
    process.env.POSTGRES_URL = "";
    process.env.BLOB_STORE_ID = "";
    process.env.BLOB_READ_WRITE_TOKEN = "   ";
    assert.equal(databaseUrl(), null);
    assert.equal(usesBlob(), false);
    process.env.DATABASE_URL = "  ";
    process.env.POSTGRES_URL = "";
    assert.equal(databaseUrl(), null);
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    process.env.VERCEL = "1";
    await assert.rejects(() => verifyLogin("pilot@example.com", "not-the-password"), StoreConfigError);
    delete process.env.VERCEL;
    const email = `pilot-${randomBytes(4).toString("hex")}@example.com`;
    const password = randomBytes(18).toString("base64url");
    const user = await upsertPilotSuperAdmin(email, password);
    assert.equal(user.role, "super_admin");
    const accounts = JSON.parse(await readFile(path.join(dir, "accounts.json"), "utf8")) as { users: { email: string }[] };
    assert.equal(accounts.users[0]?.email, email);
  });

  it("links a verified Google email to the seeded super admin and creates other people as user", async () => {
    const clientSecret = `secret-${randomBytes(8).toString("hex")}`;
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = clientSecret;
    delete process.env.ANIMIND_AUTH_URL;
    process.env.ANIMINDLY_AUTH_URL = "https://preview.example.com/ignored-path";
    const key = secret();
    const email = `pilot-${randomBytes(4).toString("hex")}@example.com`;
    const password = randomBytes(18).toString("base64url");
    await upsertPilotSuperAdmin(email, password);
    const before = JSON.parse(await readFile(path.join(dir, "accounts.json"), "utf8")) as {
      users: { email: string; role: string; name: string; passwordHash: string }[];
    };

    const local = await startGoogle(new Request("http://localhost:3000/api/auth/google?next=/biblioteca"));
    const localUrl = new URL(local.headers.get("location") ?? "");
    assert.equal(`${localUrl.origin}${localUrl.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(localUrl.searchParams.get("redirect_uri"), "http://localhost:3000/api/auth/google/callback");
    assert.equal(localUrl.searchParams.get("redirect_uri")?.includes("preview.example.com"), false);
    const localState = local.cookies.get("animind_google_state")?.value ?? "";
    assert.equal(localUrl.searchParams.get("state"), localState);

    const hashed = await startGoogle(new Request("https://animind-abc123.vercel.app/api/auth/google?next=/biblioteca"));
    assert.equal(hashed.status, 307);
    assert.equal(hashed.headers.get("location"), "https://preview.example.com/api/auth/google?next=%2Fbiblioteca");
    assert.equal(hashed.headers.get("set-cookie"), null);

    const started = await startGoogle(new Request("https://preview.example.com/api/auth/google?next=/biblioteca"));
    const authorize = new URL(started.headers.get("location") ?? "");
    assert.equal(`${authorize.origin}${authorize.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(authorize.searchParams.get("client_id"), "test-client");
    assert.equal(authorize.searchParams.get("redirect_uri"), "https://preview.example.com/api/auth/google/callback");
    assert.equal(authorize.searchParams.get("response_type"), "code");
    assert.equal(authorize.searchParams.get("scope"), "openid email profile");
    assert.equal(authorize.searchParams.has("client_secret"), false);
    const state = authorize.searchParams.get("state") ?? "";
    assert.equal(state.includes(clientSecret), false);
    assert.equal(started.headers.get("set-cookie")?.includes(clientSecret), false);
    const stateCookie = started.cookies.get("animind_google_state")?.value;
    assert.equal(stateCookie, state);

    const original = globalThis.fetch;
    const seen: string[] = [];
    let expectLocal = true;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const target = String(input);
      if (target === "https://oauth2.googleapis.com/token") {
        const params = new URLSearchParams(String(init?.body));
        assert.equal(params.get("client_secret"), clientSecret);
        assert.equal(params.get("grant_type"), "authorization_code");
        if (expectLocal) {
          assert.equal(params.get("code"), "local");
          assert.equal(params.get("redirect_uri"), "http://localhost:3000/api/auth/google/callback");
        } else {
          seen.push(target);
          assert.equal(params.get("redirect_uri"), "https://preview.example.com/api/auth/google/callback");
        }
        return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
      }
      if (target === "https://openidconnect.googleapis.com/v1/userinfo") {
        assert.equal((init?.headers as { authorization?: string }).authorization, "Bearer access-token");
        if (expectLocal) {
          expectLocal = false;
          return new Response(JSON.stringify({ email, email_verified: true, name: "Not Diogo" }), { status: 200 });
        }
        seen.push(target);
        return new Response(JSON.stringify({ email: email.toUpperCase(), email_verified: true, name: "Not Diogo" }), { status: 200 });
      }
      throw new Error(`unexpected ${target}`);
    }) as typeof fetch;
    try {
      const localDone = await finishGoogle(
        new Request(`http://localhost:3000/api/auth/google/callback?code=local&state=${encodeURIComponent(localState)}`, {
          headers: { cookie: `animind_google_state=${localState}` },
        }),
      );
      assert.equal(localDone.headers.get("location"), "http://localhost:3000/biblioteca");
      const done = await finishGoogle(
        new Request(`https://preview.example.com/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, {
          headers: { cookie: `animind_google_state=${state}` },
        }),
      );
      assert.equal(done.status, 307);
      assert.equal(done.headers.get("location"), "https://preview.example.com/biblioteca");
      const session = done.cookies.get("animind_session")?.value ?? "";
      assert.equal(readSession(session, key)?.sub.length ? true : false, true);
      const linked = await verifyLogin(email, password);
      assert.equal(linked?.role, "super_admin");
      assert.equal(linked?.name, "Diogo");
      assert.equal(readSession(session, key)?.sub, linked?.id);
      const after = JSON.parse(await readFile(path.join(dir, "accounts.json"), "utf8")) as typeof before;
      assert.equal(after.users.length, 1);
      assert.equal(after.users[0]?.passwordHash, before.users[0]?.passwordHash);
      assert.equal(after.users[0]?.role, "super_admin");

      const freshEmail = `new-${randomBytes(4).toString("hex")}@example.com`;
      globalThis.fetch = (async (input: string | URL | Request) => {
        const target = String(input);
        if (target === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
        if (target === "https://openidconnect.googleapis.com/v1/userinfo") {
          return new Response(JSON.stringify({ email: freshEmail, email_verified: true, name: "  Ada Lovelace  " }), { status: 200 });
        }
        throw new Error(`unexpected ${target}`);
      }) as typeof fetch;
      const created = await finishGoogle(
        new Request(`https://preview.example.com/api/auth/google/callback?code=def&state=${encodeURIComponent(state)}`, {
          headers: { cookie: `animind_google_state=${state}` },
        }),
      );
      assert.equal(created.headers.get("location"), "https://preview.example.com/biblioteca");
      const newbie = JSON.parse(await readFile(path.join(dir, "accounts.json"), "utf8")) as typeof before;
      const row = newbie.users.find((user) => user.email === freshEmail);
      assert.equal(row?.role, "user");
      assert.equal(row?.name, "Ada Lovelace");
      assert.equal(await verifyLogin(freshEmail, password), null);
      assert.equal(await verifyLogin(freshEmail, "not-a-real-password"), null);
    } finally {
      globalThis.fetch = original;
    }
    assert.deepEqual(seen, ["https://oauth2.googleapis.com/token", "https://openidconnect.googleapis.com/v1/userinfo"]);
  });

  it("refuses unverified Google emails, a mismatched state, and a missing client", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    delete process.env.ANIMIND_AUTH_URL;
    process.env.ANIMINDLY_AUTH_URL = "https://preview.example.com";
    const email = `pilot-${randomBytes(4).toString("hex")}@example.com`;
    await upsertPilotSuperAdmin(email, randomBytes(18).toString("base64url"));
    const started = await startGoogle(new Request("https://preview.example.com/api/auth/google"));
    const state = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? "";

    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls += 1;
      const target = String(input);
      if (target === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
      return new Response(JSON.stringify({ email: `other-${randomBytes(3).toString("hex")}@example.com`, email_verified: false, name: "Nope" }), { status: 200 });
    }) as typeof fetch;
    try {
      const unverified = await finishGoogle(
        new Request(`https://preview.example.com/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, {
          headers: { cookie: `animind_google_state=${state}` },
        }),
      );
      assert.equal(new URL(unverified.headers.get("location") ?? "").searchParams.get("error"), "google_unverified");
      const mismatch = await finishGoogle(
        new Request(`https://preview.example.com/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, {
          headers: { cookie: "animind_google_state=not-the-state" },
        }),
      );
      assert.equal(new URL(mismatch.headers.get("location") ?? "").searchParams.get("error"), "google_state");
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = original;
    }
    const accounts = JSON.parse(await readFile(path.join(dir, "accounts.json"), "utf8")) as { users: { email: string }[] };
    assert.equal(accounts.users.length, 1);

    delete process.env.GOOGLE_CLIENT_ID;
    const missing = await startGoogle(new Request("https://preview.example.com/api/auth/google?next=https://evil.example"));
    const missingUrl = new URL(missing.headers.get("location") ?? "");
    assert.equal(missingUrl.origin, "https://preview.example.com");
    assert.equal(missingUrl.pathname, "/login");
    assert.equal(missingUrl.searchParams.get("error"), "google_unconfigured");
    assert.equal(missingUrl.searchParams.get("next"), "/characters");
    assert.equal(missing.headers.get("location")?.includes("accounts.google.com"), false);

    const key = secret();
    assert.equal(readOAuthState(signSession("usr_123", key), key), null);
    assert.equal(readOAuthState(signOAuthState({ state: "nonce", next: "/biblioteca" }, key, 1_000), key, 1_000 + 11 * 60 * 1000), null);
    assert.equal(safeNext("//evil.example"), "/characters");
    assert.equal(authOrigin(new Request("http://localhost:3000/api/auth/google")), "http://localhost:3000");
    assert.equal(
      authOrigin(new Request("http://0.0.0.0:3000/api/auth/google", { headers: { "x-forwarded-host": "localhost:3000", "x-forwarded-proto": "http" } })),
      "http://localhost:3000",
    );
    assert.equal(authOrigin(new Request("http://localhost:3000/api/auth/google", { headers: { "x-forwarded-host": "localhost:3000" } })), "http://localhost:3000");
    assert.equal(authOrigin(new Request("https://animind-abc123.vercel.app/api/auth/google")), "https://preview.example.com");
    delete process.env.ANIMINDLY_AUTH_URL;
    delete process.env.ANIMIND_AUTH_URL;
    assert.equal(authOrigin(new Request("http://127.0.0.1:3000/api/auth/google")), "http://127.0.0.1:3000");
    const direct = await accountForVerifiedGoogle(`blank-${randomBytes(3).toString("hex")}@example.com`, "   ");
    assert.equal(direct?.role, "user");
    assert.equal(direct?.name, direct?.email.split("@")[0]);
    const built = googleAuthorizeUrl({ clientId: "test-client", redirectUri: "https://preview.example.com/api/auth/google/callback", state: "state" });
    assert.equal(built.includes("test-secret"), false);
  });

  it("signs a session and refuses a missing auth secret", () => {
    delete process.env.ANIMINDLY_AUTH_SECRET;
    delete process.env.ANIMIND_AUTH_SECRET;
    assert.equal(authSecret(), null);
    process.env.ANIMIND_AUTH_SECRET = "legacy-secret-value";
    assert.equal(authSecret(), "legacy-secret-value");
    const key = secret();
    assert.notEqual(authSecret(), "legacy-secret-value");
    const token = signSession("usr_123", key, 1_000);
    assert.deepEqual(readSession(token, key, 1_000), { sub: "usr_123" });
    assert.equal(readSession(token, key, 1_000 + 15 * 24 * 60 * 60 * 1000), null);
    assert.equal(readSession(`${token}x`, key, 1_000), null);
    assert.equal(cookieSecure(new Request("http://127.0.0.1/api/auth/login")), false);
    assert.equal(cookieSecure(new Request("http://localhost:3000/api/auth/login", { headers: { "x-forwarded-proto": "https" } })), false);
    assert.equal(cookieSecure(new Request("https://animind.example/api/auth/login")), true);
  });
});
