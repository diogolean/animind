import { productEnv } from "../product-env";
import { generationConcurrency, generationSwitch } from "../accounts/generation-policy";
import type { SpendOperation } from "./catalog";
import { findPrice, parsePriceTable, type PriceEntry, type PriceTable } from "./prices";

export interface SpendLimits {
  budgetMinor: number;
  userMinor: number;
  timeoutMs: number;
  maxRetries: number;
  ratePerMin: number;
  concurrency: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxTotalTokens: number;
  maxImages: number;
  maxAudioSeconds: number;
  maxVideoSeconds: number;
  prices: PriceTable;
}

export type SpendBlock =
  | "disabled"
  | "unapproved"
  | "price_unavailable"
  | "budget"
  | "rate"
  | "busy"
  | "unavailable"
  | "timeout"
  | "ledger"
  | "conflict"
  | "over_cap";

function integer(name: string, min: number, max: number): number | null | "invalid" {
  const value = productEnv(name);
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) return "invalid";
  const parsed = Number(value);
  if (parsed < min || parsed > max) return "invalid";
  return parsed;
}

/** Paid calls need every limit explicit. Missing config is not a default quota. */
export function readSpendLimits(): { ok: true; limits: SpendLimits } | { ok: false; block: "unavailable" } {
  const budget = integer("SPEND_BUDGET_CENTS", 0, 1_000_000_000);
  const user = integer("SPEND_USER_CENTS", 0, 1_000_000_000);
  const timeout = integer("SPEND_TIMEOUT_MS", 1, 120_000);
  const retries = integer("SPEND_MAX_RETRIES", 0, 2);
  const rate = integer("SPEND_RATE_PER_MIN", 1, 600);
  const concurrency = generationConcurrency();
  const maxInputTokens = integer("SPEND_MAX_INPUT_TOKENS", 1, 2_000_000);
  const maxOutputTokens = integer("SPEND_MAX_OUTPUT_TOKENS", 1, 2_000_000);
  const maxTotalTokens = integer("SPEND_MAX_TOTAL_TOKENS", 1, 4_000_000);
  const maxImages = integer("SPEND_MAX_IMAGES", 0, 100);
  const maxAudioSeconds = integer("SPEND_MAX_AUDIO_SEC", 0, 3_600);
  const maxVideoSeconds = integer("SPEND_MAX_VIDEO_SEC", 0, 3_600);
  const prices = parsePriceTable(productEnv("PRICE_TABLE_JSON"));
  const missing = [
    budget,
    user,
    timeout,
    retries,
    rate,
    maxInputTokens,
    maxOutputTokens,
    maxTotalTokens,
    maxImages,
    maxAudioSeconds,
    maxVideoSeconds,
  ];
  if (missing.some((value) => value === null || value === "invalid") || "error" in concurrency || "error" in prices) {
    return { ok: false, block: "unavailable" };
  }
  const switched = generationSwitch();
  if ("code" in switched && switched.code === "unavailable") return { ok: false, block: "unavailable" };
  return {
    ok: true,
    limits: {
      budgetMinor: budget as number,
      userMinor: user as number,
      timeoutMs: timeout as number,
      maxRetries: retries as number,
      ratePerMin: rate as number,
      concurrency: concurrency.cap,
      maxInputTokens: maxInputTokens as number,
      maxOutputTokens: maxOutputTokens as number,
      maxTotalTokens: maxTotalTokens as number,
      maxImages: maxImages as number,
      maxAudioSeconds: maxAudioSeconds as number,
      maxVideoSeconds: maxVideoSeconds as number,
      prices,
    },
  };
}

/** Reject a client ask that is already over the configured unit cap. Does not rewrite the prompt. */
export function requestOverCap(body: unknown, limits: SpendLimits): "input" | "output" | "total" | "images" | "audio" | "video" | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const ask = (key: string) => (typeof record[key] === "number" && Number.isFinite(record[key] as number) ? (record[key] as number) : null);
  const input = ask("maxInputTokens");
  const output = ask("maxOutputTokens");
  const total = ask("maxTotalTokens");
  const images = ask("maxImages");
  const audio = ask("maxAudioSeconds");
  const video = ask("maxVideoSeconds") ?? ask("targetDurationSec");
  if (input !== null && input > limits.maxInputTokens) return "input";
  if (output !== null && output > limits.maxOutputTokens) return "output";
  if (total !== null && total > limits.maxTotalTokens) return "total";
  if (images !== null && images > limits.maxImages) return "images";
  if (audio !== null && audio > limits.maxAudioSeconds) return "audio";
  if (video !== null && video > limits.maxVideoSeconds) return "video";
  return null;
}

export function quoteCall(limits: SpendLimits, operation: SpendOperation, provider: string, model: string): PriceEntry | null {
  return findPrice(limits.prices, operation, provider, model);
}

export function providerForMode(mode: "core" | "mock" | "off"): { provider: string; model: string } {
  if (mode === "mock") return { provider: "mock", model: "mock" };
  if (mode === "core") return { provider: "core", model: "unspecified" };
  return { provider: "none", model: "none" };
}
