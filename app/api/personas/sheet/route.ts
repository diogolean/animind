import { coreMode, coreOff, json, proxyJson } from "@/lib/core";
import { mockSheet } from "@/lib/quote-sheets";

/**
 * A persona's quote sheet (the literal quotes the script may use, with sources and links), so anyone can
 * verify an on-screen quote. Core: GET /v1/personas/sheet. Mock: the bundled sheets of lib/quote-sheets.ts.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const name = u.searchParams.get("name")?.trim() ?? "";
  const lang = u.searchParams.get("lang") || "pt-BR";
  if (!name) return json({ error: "Informe o nome" }, 400);
  const mode = coreMode();
  if (mode === "off") return coreOff();
  if (mode === "core") return proxyJson(`/personas/sheet?${new URLSearchParams({ name, lang })}`);
  const s = mockSheet(name);
  if (!s) return json({ name, lang, found: false, wikiquote: null, license: null, quotes: [] });
  const quotes = s.quotes.map((q) => ({ id: q.id, text: q.text, source: q.source, label: q.label, url: q.url, wikisource: q.wikisource, sourceKind: "primary" }));
  return json({ name: s.name, lang, found: true, wikiquote: s.wikiquote, license: s.license, quotes });
}
