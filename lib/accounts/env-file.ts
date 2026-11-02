import { readFile } from "node:fs/promises";
import path from "node:path";

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

async function readEnvFile(file: string): Promise<Record<string, string>> {
  try {
    return parseEnv(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/**
 * Loads `.env` then `.env.local` for the seed and import scripts.
 * Existing process variables win, so a shell export is never overwritten.
 * Tests set ANIMIND_SKIP_ENV_FILE=1.
 */
export async function loadLocalEnv(cwd = process.cwd()): Promise<void> {
  if (process.env.ANIMIND_SKIP_ENV_FILE === "1") return;
  const merged = { ...(await readEnvFile(path.join(cwd, ".env"))), ...(await readEnvFile(path.join(cwd, ".env.local"))) };
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
