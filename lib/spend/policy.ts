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
  concurrency: number | null;
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
  | "ledger";

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
  const prices = parsePriceTable(productEnv("PRICE_TABLE_JSON"));
  if (
    budget === null ||
    budget === "invalid" ||
    user === null ||
    user === "invalid" ||
    timeout === null ||
    timeout === "invalid" ||
    retries === null ||
    retries === "invalid" ||
    rate === null ||
    rate === "invalid" ||
    "error" in concurrency ||
    "error" in prices
  ) {
    return { ok: false, block: "unavailable" };
  }
  const switched = generationSwitch();
  if ("code" in switched && switched.code === "unavailable") return { ok: false, block: "unavailable" };
  return {
    ok: true,
    limits: {
      budgetMinor: budget,
      userMinor: user,
      timeoutMs: timeout,
      maxRetries: retries,
      ratePerMin: rate,
      concurrency: concurrency.cap,
      prices,
    },
  };
}

export function quoteCall(limits: SpendLimits, operation: SpendOperation, provider: string, model: string): PriceEntry | null {
  return findPrice(limits.prices, operation, provider, model);
}

export function providerForMode(mode: "core" | "mock" | "off"): { provider: string; model: string } {
  if (mode === "mock") return { provider: "mock", model: "mock" };
  if (mode === "core") return { provider: "core", model: "unspecified" };
  return { provider: "none", model: "none" };
}
