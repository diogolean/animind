"use client";
import type { RenderResult } from "@/lib/contract";

const pretty = (s: string) => {
  const n = s.trim().replace(/\s+/g, " ");
  return n.charAt(0).toUpperCase() + n.slice(1);
};

/** The script under the player: each real quote with its source link, each paraphrase marked as such. */
export function Transcript({ result }: { result: RenderResult }) {
  const names = result.characters.map((c, i) => pretty(result.personas?.[i]?.name || c.name.split(/[,(:;]| - /)[0].trim()));
  return (
    <div data-testid="transcript" className="mt-6 space-y-3 text-sm">
      {result.scriptQA && <ScriptCheck qa={result.scriptQA} quotes={result.script.filter((l) => l.kind === "quote").length} />}
      <ol className="space-y-2.5">
        {result.script.map((l, i) => (
          <li
            key={i}
            data-testid={`line-${l.kind ?? "line"}`}
            data-speaker={l.speaker}
            data-beat={l.beat}
            data-quote-id={l.quote?.id}
            className="grid grid-cols-[6.5rem_1fr] gap-3">
            <div className="pt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <div className="truncate font-medium text-foreground/80">{names[l.speaker] ?? names[0]}</div>
              {l.beat}
            </div>
            <div>
              <p className={l.kind === "quote" ? "italic" : undefined}>{l.kind === "quote" ? `“${l.text}”` : l.text}</p>
              {l.kind === "quote" && l.quote ? (
                <a href={l.quote.url} target="_blank" rel="noreferrer" title={l.quote.source} className="mt-0.5 inline-flex gap-1.5 text-[11px] text-muted-foreground hover:underline">
                  <span className="font-semibold text-[var(--accent-brand)]">Citação real</span>
                  {l.quote.label ?? l.quote.source} · {l.quote.site ?? "Wikiquote"}
                </a>
              ) : l.kind === "paraphrase" ? (
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  Paráfrase{l.basis ? (
                    <>
                      {" "}· inspirada em{" "}
                      <a href={l.basis.url} target="_blank" rel="noreferrer" title={l.basis.source} className="hover:underline">{l.basis.label ?? l.basis.source}</a>
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

/** The script's self-check: real quotes verified word for word against the sheets, and the arc. */
function ScriptCheck({ qa, quotes }: { qa: NonNullable<RenderResult["scriptQA"]>; quotes: number }) {
  return (
    <div data-testid="script-qa" data-pass={qa.pass} className="text-[11px] text-muted-foreground">
      {qa.pass ? (
        <span>
          <span className="font-semibold text-[var(--accent-brand)]">Roteiro conferido</span> ·{" "}
          {quotes === 0 ? "sem citações: todas as falas são paráfrases marcadas" : `${quotes} ${quotes === 1 ? "citação real conferida" : "citações reais conferidas"} palavra por palavra com a ficha`}
        </span>
      ) : (
        <details>
          <summary className="cursor-pointer font-semibold text-destructive">Roteiro com {qa.problems.length} {qa.problems.length === 1 ? "problema" : "problemas"}</summary>
          <ul className="mt-1 list-disc pl-4">
            {qa.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
