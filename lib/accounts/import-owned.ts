import { existsSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { importCharacterPackage, ImportError, type ImportFile } from "./import-character";
import { normalizeRel } from "./paths";
import { listUsers } from "./store";
import type { LibraryCharacter } from "./types";
import { readZip } from "./zip-package";

const ALLOWED = new Set(["png", "webp", "jpg", "jpeg", "json", "txt", "md", "mp4", "mp3"]);
const MAX_FILE = 8 * 1024 * 1024;

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
