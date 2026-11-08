import type { PlanPersonaSheet } from "./contract";
import { fold, mockSheet, type QuoteSheet } from "./quote-sheets";

const WIKI = /^https:\/\/(?:[a-z0-9-]+\.)?wiki(?:pedia|quote|source)\.org\/wiki\/\S+$/;

function verifiedQuotes(sheet: QuoteSheet): PlanPersonaSheet["quotes"] {
  return sheet.quotes.flatMap((quote) => {
    if (!WIKI.test(quote.url)) return [];
    const item: PlanPersonaSheet["quotes"][number] = {
      id: quote.id,
      text: quote.text,
      source: quote.source,
      label: quote.label || quote.source,
      url: quote.url,
      verification: "verified",
    };
    if (quote.wikisource && WIKI.test(quote.wikisource)) item.wikisource = quote.wikisource;
    return [item];
  });
}

/** Bundled Wikiquote fixture. This is not a live lookup and it does not call a model. */
export function fixturePersona(name: string): PlanPersonaSheet {
  const sheet = mockSheet(name);
  if (!sheet) return { name, found: false, source: "fixture", quotes: [] };
  const quotes = verifiedQuotes(sheet);
  return {
    name: sheet.name,
    found: quotes.length > 0,
    source: "fixture",
    wikiquote: sheet.wikiquote,
    license: sheet.license,
    quotes,
  };
}

export function personaFold(name: string): string {
  return fold(name);
}

export interface ScreenQuote {
  id: string;
  text: string;
  source: string;
  url: string;
  verification: "verified";
}

export interface ScreenSheet {
  name: string;
  found: true;
  source: "fixture" | "core" | "core-fixture";
  quotes: ScreenQuote[];
}

const SCREEN_SOURCE = new Set<ScreenSheet["source"]>(["fixture", "core", "core-fixture"]);

/**
 * Quotes the create screen may show. A fixture quote with a wiki URL is the
 * verified equivalent. `not_found` is dropped, so its text is neither a citation nor speech.
 */
export function sheetForScreen(payload: unknown): ScreenSheet | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { name?: unknown; found?: unknown; source?: unknown; quotes?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const source = body.source;
  if (!name || name.length > 80 || body.found !== true || !SCREEN_SOURCE.has(source as ScreenSheet["source"])) return null;
  if (!Array.isArray(body.quotes)) return null;
  const quotes = body.quotes.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const quote = item as { id?: unknown; text?: unknown; source?: unknown; url?: unknown; verification?: unknown };
    if (quote.verification === "not_found") return [];
    const fixtureEquivalent = source === "fixture" && (quote.verification == null || quote.verification === "verified");
    if (quote.verification !== "verified" && !fixtureEquivalent) return [];
    const text = typeof quote.text === "string" ? quote.text.trim() : "";
    const origin = typeof quote.source === "string" ? quote.source.trim() : "";
    const url = typeof quote.url === "string" ? quote.url.trim() : "";
    const id = typeof quote.id === "string" ? quote.id.trim() : "";
    if (!id || !text || text.length > 500 || !origin || origin.length > 160 || !WIKI.test(url)) return [];
    const row: ScreenQuote = { id, text, source: origin, url, verification: "verified" };
    return [row];
  });
  if (!quotes.length) return null;
  return { name, found: true, source: source as ScreenSheet["source"], quotes };
}
