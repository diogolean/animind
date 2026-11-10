"use client";

import { useState } from "react";
import { useI18n } from "@/components/locale";

type DebateLine = {
  speaker: number;
  name: string;
  kind: "quote" | "fixture";
  text: string | null;
  source: string | null;
  url: string | null;
  verification: "verified" | null;
};

type FixtureScript = {
  id: string;
  writer: "fixture";
  live: false;
  lines: DebateLine[];
};

function isScript(value: unknown): value is FixtureScript {
  if (!value || typeof value !== "object") return false;
  const body = value as FixtureScript;
  return body.writer === "fixture" && body.live === false && Array.isArray(body.lines);
}

/** Fixture script for two sheets this user already loaded. It does not start a video render. */
export function FixtureDebate({
  names,
  theme,
  language,
  localLines = null,
}: {
  names: [string, string];
  theme: string;
  language: string;
  localLines?: DebateLine[] | null;
}) {
  const { t } = useI18n();
  const [script, setScript] = useState<FixtureScript | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run() {
    if (localLines) {
      setFailed(false);
      setScript({ id: "local", writer: "fixture", live: false, lines: localLines });
      return;
    }
    setWaiting(true);
    setFailed(false);
    setScript(null);
    try {
      const created = await fetch("/api/debates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personas: names, theme, language, writer: "fixture", live: false }),
      });
      const posted = await created.json().catch(() => null) as { id?: unknown } | null;
      const id = posted && typeof posted.id === "string" ? posted.id : "";
      if (!created.ok || !/^[a-f0-9]{8,32}$/.test(id)) {
        setFailed(true);
        return;
      }
      const seen = await fetch(`/api/debates?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await seen.json().catch(() => null);
      if (!seen.ok || !isScript(body)) {
        setFailed(true);
        return;
      }
      setScript(body);
    } catch {
      setFailed(true);
    } finally {
      setWaiting(false);
    }
  }

  return (
    <section data-testid="fixture-debate" className="mt-4 max-w-xl rounded-2xl border border-white/15 p-4 text-sm text-white/90">
      <p data-testid="fixture-debate-label" className="text-sm font-medium text-amber-300">{t("debateFixtureLabel")}</p>
      <p className="mt-1 text-white/80">{t("debateFixtureBody")}</p>
      <button
        type="button"
        data-testid="fixture-debate-run"
        className="mt-3 inline-flex min-h-11 items-center rounded-full border border-white/45 px-4 text-white"
        onClick={() => void run()}
        disabled={waiting}
      >
        {t("debateFixtureRun")}
      </button>
      {waiting ? <p className="mt-2">{t("debateFixtureWaiting")}</p> : null}
      {failed ? <p data-testid="fixture-debate-failed" className="mt-2">{t("requestFailed")}</p> : null}
      {script && script.lines.length === 0 ? <p data-testid="fixture-debate-empty" className="mt-3">{t("debateFixtureEmpty")}</p> : null}
      {script && script.lines.length > 0 ? (
        <ol className="mt-3 space-y-3">
          {script.lines.map((line) => (
            <li key={`${line.speaker}-${line.name}`} data-testid="fixture-debate-line">
              <p className="font-medium">{line.name}</p>
              {line.text ? (
                <>
                  <p data-testid="fixture-debate-text">{line.text}</p>
                  {line.source ? (
                    <p className="text-xs text-white/70">
                      {line.source}
                      {line.verification === "verified" ? ` · ${t("coreFixtureVerified")}` : ""}
                    </p>
                  ) : null}
                  {line.url ? (
                    <a data-testid="fixture-debate-url" href={line.url} className="break-all text-xs text-white/70 underline" target="_blank" rel="noreferrer">
                      {line.url}
                    </a>
                  ) : null}
                </>
              ) : (
                <p data-testid="fixture-debate-empty">{t("debateFixtureEmpty")}</p>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
