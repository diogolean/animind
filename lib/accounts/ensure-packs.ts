import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { productEnv } from "../product-env";
import { importOwnedCharacter } from "./import-owned";
import { charactersFor } from "./store";
import type { PublicUser } from "./types";

const CHARGE_DIR = path.join(process.cwd(), "private/characters/einstein-charge");
const REALISTA_DIR = path.join(process.cwd(), "private/characters/einstein-realista");

let pending: Promise<void> | null = null;

function isCharge(name: string): boolean {
  const value = name.toLowerCase();
  return value.includes("charge") || value.includes("caricatura");
}

/**
 * The production library showed one realistic card and no caricature.
 * When the signed-in super admin opens the library, attach the missing charge
 * to that account and refresh the realistic files they already own.
 * Anonymous callers never reach this. A missing pack is skipped, not invented.
 */
export function ensurePrivatePacks(actor: PublicUser): Promise<void> {
  if (actor.role !== "super_admin") return Promise.resolve();
  if (productEnv("SKIP_CHARACTER_IMPORT") === "1") return Promise.resolve();
  if (!existsSync(CHARGE_DIR)) return Promise.resolve();
  pending ??= run(actor).catch((error: unknown) => {
    pending = null;
    console.error("private pack import failed", error instanceof Error ? error.name : "error");
  });
  return pending;
}

async function run(actor: PublicUser): Promise<void> {
  const mine = (await charactersFor(actor)).filter((character) => character.ownerId === actor.id);
  if (mine.some((character) => isCharge(character.name))) return;
  const realisticName = mine.some((character) => character.name === "Albert Einstein")
    ? "Albert Einstein"
    : mine.some((character) => character.name === "Einstein realista")
      ? "Einstein realista"
      : "Einstein realista";
  if (existsSync(REALISTA_DIR)) {
    await importOwnedCharacter({ email: actor.email, dir: REALISTA_DIR, name: realisticName, status: "ready" });
  }
  await importOwnedCharacter({ email: actor.email, dir: CHARGE_DIR, name: "Einstein charge", status: "draft" });
}
