import type { SpendOperation } from "./catalog";

export interface PriceEntry {
  operation: SpendOperation;
  provider: string;
  model: string;
  currency: "USD";
  /** Integer cents for one call. Never a guessed production price. */
  minor: number;
  unit: "call";
  source: string;
  sourceDate: string;
}

export interface PriceTable {
  version: string;
  source: string;
  sourceDate: string;
  entries: PriceEntry[];
}

/**
 * This repository does not name a Gemini/DeepSeek/OpenRouter model id.
 * There is no official price to attach. Unknown price is not zero.
 * An operator can supply ANIMINDLY_PRICE_TABLE_JSON; tests use a fixture table.
 */
export const PUBLISHED_PRICE_TABLE: PriceTable = {
  version: "2026-11-07-unpublished",
  source: "none — this repo does not publish a provider model id or an official rate card",
  sourceDate: "2026-11-07",
  entries: [],
};

const OPERATIONS = new Set<string>([
  "plan",
  "render",
  "preview",
  "character",
  "job",
  "file",
  "scenario",
  "persona_deep",
  "persona_sheet",
  "voice",
  "tone",
]);

export function parsePriceTable(raw: string | undefined): PriceTable | { error: string } {
  if (raw === undefined || raw.trim() === "") return PUBLISHED_PRICE_TABLE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "price-json" };
  }
  if (!parsed || typeof parsed !== "object") return { error: "price-shape" };
  const table = parsed as Partial<PriceTable>;
  if (typeof table.version !== "string" || !table.version.trim()) return { error: "price-version" };
  if (typeof table.source !== "string" || !table.source.trim()) return { error: "price-source" };
  if (typeof table.sourceDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(table.sourceDate)) return { error: "price-date" };
  if (!Array.isArray(table.entries)) return { error: "price-entries" };
  const entries: PriceEntry[] = [];
  for (const entry of table.entries) {
    if (!entry || typeof entry !== "object") return { error: "price-entry" };
    const row = entry as Partial<PriceEntry>;
    if (typeof row.operation !== "string" || !OPERATIONS.has(row.operation)) return { error: "price-operation" };
    if (typeof row.provider !== "string" || !row.provider.trim()) return { error: "price-provider" };
    if (typeof row.model !== "string" || !row.model.trim()) return { error: "price-model" };
    if (row.currency !== "USD") return { error: "price-currency" };
    if (typeof row.minor !== "number" || !Number.isInteger(row.minor) || row.minor < 0) return { error: "price-minor" };
    if (row.unit !== "call") return { error: "price-unit" };
    if (typeof row.source !== "string" || !row.source.trim()) return { error: "price-entry-source" };
    if (typeof row.sourceDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.sourceDate)) return { error: "price-entry-date" };
    entries.push({
      operation: row.operation as SpendOperation,
      provider: row.provider,
      model: row.model,
      currency: "USD",
      minor: row.minor,
      unit: "call",
      source: row.source,
      sourceDate: row.sourceDate,
    });
  }
  return { version: table.version.trim(), source: table.source.trim(), sourceDate: table.sourceDate, entries };
}

export function findPrice(table: PriceTable, operation: SpendOperation, provider: string, model: string): PriceEntry | null {
  return table.entries.find((entry) => entry.operation === operation && entry.provider === provider && entry.model === model) ?? null;
}
