import { existsSync, statSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { databaseUrl, usesBlob } from "../lib/accounts/config";
import { productEnv } from "../lib/product-env";
import { loadLocalEnv } from "../lib/accounts/env-file";
import { importCharacterPackage, ImportError, type ImportFile } from "../lib/accounts/import-character";
import { normalizeRel } from "../lib/accounts/paths";
import { listUsers } from "../lib/accounts/store";
import type { LibraryCharacter } from "../lib/accounts/types";
import { readZip } from "../lib/accounts/zip-package";

/**
 * Loads a generated character folder or zip into a user's library.
 *   npm run import-character -- --dir /path/to/einstein --email "$SEED_SUPERADMIN_EMAIL"
 *   npm run import-character -- --zip /path/to/albert_einstein.zip --email "$SEED_SUPERADMIN_EMAIL"
 * Optional: --name, --persona, --status ready|draft|archived
 * Importing the same owner and display name again replaces that character.
 */
const ALLOWED = new Set(["png", "webp", "jpg", "jpeg", "json", "txt", "md"]);
const MAX_FILE = 8 * 1024 * 1024;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

async function collect(dir: string): Promise<ImportFile[]> {
  const root = await realpath(dir);
  const files: ImportFile[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED.has(ext)) continue;
      const info = await stat(abs);
      if (info.size > MAX_FILE) throw new ImportError(`${entry.name} passa de 8 MB`, 413);
      const rel = normalizeRel(path.relative(root, abs).split(path.sep).join("/"));
      if (!rel) continue;
      files.push({ path: rel, bytes: await readFile(abs) });
    }
  }
  await walk(root);
  return files;
}

async function filesFromZip(zipPath: string): Promise<ImportFile[]> {
  const bytes = await readFile(zipPath);
  return readZip(bytes).map((entry) => ({ path: entry.path, bytes: entry.bytes }));
}

export async function importOwnedCharacter(options: {
  email: string;
  dir?: string;
  zip?: string;
  name?: string;
  persona?: string;
  status?: string;
}): Promise<LibraryCharacter> {
  const email = options.email.trim().toLowerCase();
  if (!email || Boolean(options.dir) === Boolean(options.zip)) {
    throw new ImportError("Informe o e-mail e exatamente um de --dir ou --zip");
  }
  const owner = (await listUsers()).find((user) => user.email === email);
  if (!owner) throw new ImportError("Usuário não encontrado. Rode npm run seed antes, ou crie a conta.");
  const source = options.zip ?? options.dir;
  if (!source || !existsSync(source)) throw new ImportError("Pasta ou zip não encontrado");
  const files = options.zip ? await filesFromZip(options.zip) : await collect(options.dir!);
  return importCharacterPackage({
    ownerId: owner.id,
    name: options.name,
    personaSheetRef: options.persona,
    status: options.status,
    files,
  });
}

/** Zip the seed should import for the pilot, when one is on disk. Absent means seed only the account. */
export function characterPackagePath(): string | null {
  if (productEnv("SKIP_CHARACTER_IMPORT") === "1") return null;
  const fromNew = process.env.ANIMINDLY_CHARACTER_ZIP?.trim() ?? "";
  const fromOld = process.env.ANIMIND_CHARACTER_ZIP?.trim() ?? "";
  const fromEnv = fromNew || fromOld;
  if (fromEnv) {
    if (!existsSync(fromEnv) || !statSync(fromEnv).isFile()) {
      const label = fromNew ? "ANIMINDLY_CHARACTER_ZIP" : "ANIMIND_CHARACTER_ZIP";
      throw new ImportError(`${label} não é um arquivo: ${fromEnv}`);
    }
    return fromEnv;
  }
  for (const candidate of [
    path.join(process.cwd(), "uploads", "albert_einstein.zip"),
    path.join(process.cwd(), ".data", "inbox", "albert_einstein.zip"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

async function main() {
  await loadLocalEnv();
  const dir = arg("dir");
  const zip = arg("zip");
  const email = arg("email")?.trim().toLowerCase();
  if (!email || Boolean(dir) === Boolean(zip)) {
    console.error(
      "Uso: npm run import-character -- --dir <pasta> | --zip <arquivo.zip> --email <dono> [--name <nome>] [--persona <ref>] [--status ready]",
    );
    process.exit(1);
  }
  try {
    const character = await importOwnedCharacter({
      email,
      dir,
      zip,
      name: arg("name"),
      persona: arg("persona"),
      status: arg("status"),
    });
    console.log(
      JSON.stringify(
        {
          id: character.id,
          name: character.name,
          ownerId: character.ownerId,
          puppetUrl: character.puppetUrl,
          views: character.views,
          status: character.status,
          store: databaseUrl() ? "postgres" : "file",
          assets: usesBlob() ? "blob" : "file",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof ImportError ? error.message : (error as Error).message);
    process.exit(1);
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked.endsWith(`${path.sep}import-character.ts`) || invoked.endsWith(`${path.sep}import-character.js`)) {
  void main();
}
