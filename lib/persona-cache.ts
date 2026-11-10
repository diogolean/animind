import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./accounts/paths";
import { fixturePersona, personaFold } from "./persona-sheet";
import type { PlanPersonaSheet } from "./contract";

interface CachedSheet extends PlanPersonaSheet {
  cacheKey: string;
}

function cacheKey(name: string): string {
  const sheet = fixturePersona(name);
  const identity = sheet.found ? sheet.name : name;
  return createHash("sha256").update(personaFold(identity)).digest("hex").slice(0, 24);
}

function isSheet(value: unknown, key: string): value is CachedSheet {
  if (!value || typeof value !== "object") return false;
  const sheet = value as Partial<CachedSheet>;
  return sheet.source === "fixture" && sheet.cacheKey === key && Array.isArray(sheet.quotes);
}

/** Shared file cache for the labeled fixture. The quotes are public; the file does not store an account. */
export async function cachedFixturePersona(name: string): Promise<CachedSheet> {
  const key = cacheKey(name);
  const file = path.join(dataDir(), "persona-cache", `${key}.json`);
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (isSheet(parsed, key)) return parsed;
  } catch {
    // The first lookup creates the file.
  }
  const fresh: CachedSheet = { ...fixturePersona(name), cacheKey: key };
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(fresh));
  } catch {
    // A read-only host still answers with the labeled fixture. The file is only a cache.
  }
  return fresh;
}
