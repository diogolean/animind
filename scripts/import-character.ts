import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { databaseUrl, usesBlob } from "../lib/accounts/config";
import { productEnv } from "../lib/product-env";
import { loadLocalEnv } from "../lib/accounts/env-file";
import { ImportError } from "../lib/accounts/import-character";
import { importOwnedCharacter } from "../lib/accounts/import-owned";

/**
 * Loads a generated character folder or zip into a user's library.
 *   npm run import-character -- --dir /path/to/einstein --email "$SEED_SUPERADMIN_EMAIL"
 *   npm run import-character -- --zip /path/to/albert_einstein.zip --email "$SEED_SUPERADMIN_EMAIL"
 * Optional: --name, --persona, --status ready|draft|archived
 * Importing the same owner and display name again replaces that character.
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

export { importOwnedCharacter } from "../lib/accounts/import-owned";

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
