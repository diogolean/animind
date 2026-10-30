"use client";
import type { RenderResult } from "@/lib/contract";

const pretty = (s: string) => {
  const n = s.trim().replace(/\s+/g, " ");
  return n.charAt(0).toUpperCase() + n.slice(1);
};

/** The script under the player: each real quote with its source link, each paraphrase marked as such. */
export function Transcript({ result }: { result: RenderResult }) {
  const names = result.characters.map((c) => pretty(c.name));
  return (
    <div data-testid="transcript" className="mt-6 space-y-3 text-sm">
      <ol className="space-y-2.5">
        {result.script.map((l, i) => (
          <li key={i} data-testid={`line-${l.kind ?? "line"}`} className="grid grid-cols-[6.5rem_1fr] gap-3">
            <div className="pt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <div className="truncate font-medium text-foreground/80">{names[l.speaker] ?? names[0]}</div>
              {l.beat}
            </div>
            <div>
              <p className={l.kind === "quote" ? "italic" : undefined}>{l.kind === "quote" ? `“${l.text}”` : l.text}</p>
              {l.kind === "quote" && l.quote ? (
                <a href={l.quote.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex gap-1.5 text-[11px] text-muted-foreground hover:underline">
                  <span className="font-semibold text-[var(--accent-brand)]">Citação real</span>
                  {l.quote.source} · {l.quote.site ?? "Wikiquote"}
                </a>
              ) : l.kind === "paraphrase" ? (
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  Paráfrase{l.basis ? (
                    <>
                      {" "}· inspirada em{" "}
                      <a href={l.basis.url} target="_blank" rel="noreferrer" className="hover:underline">{l.basis.source}</a>
                    </>
                  ) : " · fala escrita para a cena"}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {result.personas?.some((p) => p.found) && (
        <p className="text-[11px] text-muted-foreground">
          Citações de{" "}
          {result.personas.filter((p) => p.found && p.wikiquote).map((p, i) => (
            <span key={p.name}>
              {i > 0 && ", "}
              <a href={p.wikiquote!} target="_blank" rel="noreferrer" className="hover:underline">{pretty(p.name)} na Wikiquote</a>
            </span>
          ))}{" "}
          ({result.personas.find((p) => p.license)?.license ?? "CC BY-SA 4.0"}). Paródia gerada por IA: as falas não são da pessoa, exceto as citações marcadas.
        </p>
      )}
    </div>
  );
}
