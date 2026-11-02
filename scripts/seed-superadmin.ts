import { upsertPilotSuperAdmin } from "../lib/accounts/store";

/**
 * Creates the pilot super admin (Diogo).
 * Credentials come only from the environment:
 *   SEED_SUPERADMIN_EMAIL
 *   SEED_SUPERADMIN_PASSWORD
 */
const email = process.env.SEED_SUPERADMIN_EMAIL?.trim() ?? "";
const password = process.env.SEED_SUPERADMIN_PASSWORD ?? "";

async function main() {
  if (!email || !password) {
    console.error("Defina SEED_SUPERADMIN_EMAIL e SEED_SUPERADMIN_PASSWORD.");
    process.exit(1);
  }
  try {
    const user = await upsertPilotSuperAdmin(email, password);
    console.log(`${user.name} <${user.email}> role=${user.role}`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

void main();
