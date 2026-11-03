import { databaseUrl, usesBlob } from "../lib/accounts/config";
import { loadLocalEnv } from "../lib/accounts/env-file";
import { upsertPilotSuperAdmin } from "../lib/accounts/store";
import { characterPackagePath, importOwnedCharacter } from "./import-character";

/**
 * Creates the pilot super admin (Diogo).
 * Credentials come only from the environment:
 *   SEED_SUPERADMIN_EMAIL
 *   SEED_SUPERADMIN_PASSWORD
 * With DATABASE_URL (or POSTGRES_URL) the account is written to Neon.
 * With BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN, later imports use Vercel Blob.
 * Locally, `.env.local` is loaded when those variables are not already set.
 * When a character zip is present, the same run imports it for that account.
 * A later seed with the same owner and display name replaces the character.
 *   ANIMIND_CHARACTER_ZIP, or uploads/albert_einstein.zip, or .data/inbox/albert_einstein.zip
 */
async function main() {
  await loadLocalEnv();
  const email = process.env.SEED_SUPERADMIN_EMAIL?.trim() ?? "";
  const password = process.env.SEED_SUPERADMIN_PASSWORD ?? "";
  if (!email || !password) {
    console.error("Defina SEED_SUPERADMIN_EMAIL e SEED_SUPERADMIN_PASSWORD.");
    process.exit(1);
  }
  try {
    const user = await upsertPilotSuperAdmin(email, password);
    const store = databaseUrl() ? "postgres" : "file";
    const assets = usesBlob() ? "blob" : "file";
    console.log(`${user.name} <${user.email}> role=${user.role} store=${store} assets=${assets}`);
    const zip = characterPackagePath();
    if (zip) {
      const character = await importOwnedCharacter({ email: user.email, zip });
      console.log(`character ${character.name} id=${character.id}`);
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

void main();
