import type { ScriptLine } from "./contract";

/**
 * Script fidelity check, the same rules as the core's scriptQA (products/animind_core/script.py `check`):
 * a "quote" line must be a quote of the speaker's sheet, word for word, with the sheet's source and link;
 * a written line ("paraphrase") may not carry quotation marks, claim literal wording or be labelled a quote.
 * Used by the dev mock and by the e2e suite to verify what the transcript shows.
 */
export interface SheetLike {
  quotes: { id: string; text: string; source: string; url: string }[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const WIKI_URL = /^https:\/\/[a-z-]+\.wiki(quote|source)\.org\/wiki\/\S+$/;
const QUOTE_MARKS = /[“”«»"]/;
/** Phrases that present written text as someone's literal words. */
export const LITERAL_CLAIM =
  /\b(como (eu )?(disse|escrevi)\s*:|est[áa] escrito\s*:|nas (minhas |suas |pr[óo]prias )?palavras( de [^:,]+)?\s*[:,]|palavra por palavra|textualmente|ipsis litteris|cito\s*:|citando\s*:|as I (wrote|said)|in (my|his|her) (own )?words|word for word|to quote|I quote)/i;

export function checkFidelity(lines: ScriptLine[], sheets: (SheetLike | null | undefined)[]): string[] {
  const problems: string[] = [];
  lines.forEach((line, i) => {
    const sheet = sheets[line.speaker];
    const known = sheet?.quotes ?? [];
    if (line.kind === "quote") {
      const q = line.quote;
      const hit = known.find((k) => norm(k.text) === norm(line.text));
      if (!q || !hit) return void problems.push(`line ${i}: quote is not literally in the sheet`);
      if (norm(q.text) !== norm(hit.text)) problems.push(`line ${i}: quote text differs from the line`);
      if (!q.source || q.source !== hit.source) problems.push(`line ${i}: quote source differs from the sheet`);
      if (!WIKI_URL.test(q.url) || q.url !== hit.url) problems.push(`line ${i}: quote has no source link`);
      return;
    }
    if (line.kind !== "paraphrase") return void problems.push(`line ${i}: unmarked line`);
    if (line.quote) problems.push(`line ${i}: paraphrase carries a quote`);
    if (QUOTE_MARKS.test(line.text)) problems.push(`line ${i}: paraphrase uses quotation marks`);
    if (LITERAL_CLAIM.test(line.text)) problems.push(`line ${i}: paraphrase posed as a literal quote`);
    if (/^cita/i.test(line.beat ?? "")) problems.push(`line ${i}: written line labelled as a quote`);
    if (known.some((k) => norm(line.text).includes(norm(k.text)))) problems.push(`line ${i}: paraphrase repeats a real quote without marking it`);
  });
  return problems;
}
