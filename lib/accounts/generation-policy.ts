import { productEnv } from "../product-env";
import type { Role } from "./types";

/**
 * Generation is fail-closed.
 * ANIMINDLY_GENERATION must be exactly "1". Unset denies everyone.
 * Any other value is a broken config and the API answers 503.
 * ANIMINDLY_GENERATION_CONCURRENCY is a required shared slot cap for paid calls.
 * Unset is not "unlimited".
 */
export function generationSwitch(): { state: "on" } | { state: "off"; code: "disabled" | "unavailable" } {
  const value = productEnv("GENERATION");
  if (value === undefined) return { state: "off", code: "disabled" };
  if (value === "1") return { state: "on" };
  return { state: "off", code: "unavailable" };
}

export function generationConcurrency(): { cap: number } | { error: true } {
  const value = productEnv("GENERATION_CONCURRENCY");
  if (value === undefined || !/^[1-9]\d{0,3}$/.test(value)) return { error: true };
  return { cap: Number(value) };
}

export function userMayGenerate(user: { role: Role; generationEnabled?: boolean }): boolean {
  if (typeof user.generationEnabled === "boolean") return user.generationEnabled;
  return user.role === "super_admin";
}

const IDEMPOTENCY = /^[A-Za-z0-9_-]{8,80}$/;

export function idempotencyKey(header: string | null): { key: string | null } | { error: true } {
  if (header === null || header.trim() === "") return { key: null };
  if (!IDEMPOTENCY.test(header.trim())) return { error: true };
  return { key: header.trim() };
}
