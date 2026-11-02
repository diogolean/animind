import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { importCharacterPackage, ImportError, type ImportFile } from "../lib/accounts/import-character";
import { normalizeRel } from "../lib/accounts/paths";
import { listUsers } from "../lib/accounts/store";

/**
 * Loads a generated character folder into a user's library.
 *   npm run import-character -- --dir /path/to/einstein --email "$SEED_SUPERADMIN_EMAIL"
 * Optional: --name, --persona, --status ready|draft|archived
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

async function main() {
  const dir = arg("dir");
  const email = arg("email")?.trim().toLowerCase();
  if (!dir || !email) {
    console.error("Uso: npm run import-character -- --dir <pasta> --email <dono> [--name <nome>] [--persona <ref>] [--status ready]");
    process.exit(1);
  }
  try {
    const owner = (await listUsers()).find((user) => user.email === email);
    if (!owner) {
      console.error("Usuário não encontrado. Rode npm run seed antes, ou crie a conta.");
      process.exit(1);
    }
    const character = await importCharacterPackage({
      ownerId: owner.id,
      name: arg("name"),
      personaSheetRef: arg("persona"),
      status: arg("status"),
      files: await collect(dir),
    });
    console.log(
      JSON.stringify(
        { id: character.id, name: character.name, ownerId: character.ownerId, puppetUrl: character.puppetUrl, views: character.views, status: character.status },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof ImportError ? error.message : (error as Error).message);
    process.exit(1);
  }
}

void main();
