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
  return user.role === "admin" || user.role === "super_admin";
}

export type RealAvatarDenial = "unapproved" | "core_off" | "disabled" | "price_unavailable";

/**
 * A real avatar proxy is allowed only for admin or super_admin, only while the
 * core is connected, only while generation is on, and only with a published price.
 * A user or a visitor never reaches it. No price means no call.
 */
export function realAvatarCall(input: {
  role: Role | "anonymous";
  mode: "core" | "mock" | "off";
  generationOn: boolean;
  priceMinor: number | null;
}): { allow: true } | { allow: false; code: RealAvatarDenial } {
  if (input.role !== "admin" && input.role !== "super_admin") return { allow: false, code: "unapproved" };
  if (input.mode !== "core") return { allow: false, code: "core_off" };
  if (!input.generationOn) return { allow: false, code: "disabled" };
  if (input.priceMinor === null || !Number.isInteger(input.priceMinor) || input.priceMinor < 0) return { allow: false, code: "price_unavailable" };
  return { allow: true };
}

const IDEMPOTENCY = /^[A-Za-z0-9_-]{8,80}$/;

export function idempotencyKey(header: string | null): { key: string | null } | { error: true } {
  if (header === null || header.trim() === "") return { key: null };
  if (!IDEMPOTENCY.test(header.trim())) return { error: true };
  return { key: header.trim() };
}
