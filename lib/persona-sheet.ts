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
