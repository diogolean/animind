"use client";

import { useEffect, useState } from "react";
import { SPEND_PATHS } from "@/lib/spend/catalog";
import { useI18n } from "@/components/locale";
import { apiErrorMessage } from "@/lib/i18n";

interface Row {
  id: string;
  requestId: string;
  attempt: number;
  jobRef: string | null;
  userId: string;
  operation: string;
  provider: string;
  model: string | null;
  status: string;
  block: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  thinkingTokens: number | null;
  imageCount: number | null;
  audioSeconds: number | null;
  videoSeconds: number | null;
  estimatedMinor: number | null;
  reportedMinor: number | null;
  currency: string | null;
  origin: string;
  createdAt: string;
}

interface Payload {
  serverNow: string;
  lagMs: number;
  testData: boolean;
  priceVersion: string | null;
  priceSource: string;
  totals: {
    calls: number;
    reads: number;
    reserved: number;
    blocked: number;
    failed: number;
    uncertain: number;
    estimated: { currency: string; minor: number }[];
    reported: { currency: string; minor: number }[];
    estimatedUnknown: number;
    reportedUnknown: number;
  };
  inflight: number;
  holds: { scope: string; reservedMinor: number; settledMinor: number; limitMinor: number; currency: string }[];
  entries: Row[];
  error?: string;
}

const money = (minor: number | null, currency: string | null, missing: string) => {
  if (minor === null || !currency) return missing;
  if (currency !== "USD") return `${currency} ${(minor / 100).toFixed(2)}`;
  return `USD ${(minor / 100).toFixed(2)}`;
};

export function SpendPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [errorCode, setErrorCode] = useState("");
  const [query, setQuery] = useState({ provider: "", model: "", user: "", operation: "", status: "" });
  const { t, locale } = useI18n();
  const en = locale === "en";

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
      fetch(`/api/admin/spend?${params}`, { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as Payload & { code?: string };
          if (!response.ok) {
            if (!cancelled) setErrorCode(body.code || "forbidden");
            return null;
          }
          return body;
        })
        .then((body) => {
          if (!cancelled && body) {
            setData(body);
            setErrorCode("");
          }
        })
        .catch(() => {
          if (!cancelled) setErrorCode("request_failed");
        });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [query]);

  return (
    <div data-testid="spend-panel" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-medium tracking-tight">{t("spendTitle")}</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("spendIntro")}</p>
      {data?.testData ? (
        <p data-testid="spend-test-banner" className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm">
          {t("testBanner")}
        </p>
      ) : null}
      {errorCode ? <p className="mt-4 text-sm text-red-400">{apiErrorMessage(locale, { code: errorCode })}</p> : null}
      {data ? (
        <>
          <p data-testid="spend-lag" className="mt-4 text-xs text-muted-foreground">
            {en ? "As of" : "Consulta"} {data.serverNow} · {en ? "lag" : "atraso"} {Math.max(0, Math.round(data.lagMs / 1000))}s · {en ? "table" : "tabela"} {data.priceVersion ?? (en ? "none" : "sem tabela")} · {data.priceSource}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("calls")} value={String(data.totals.calls)} />
            <Stat label={t("reads")} value={String(data.totals.reads)} />
            <Stat label={t("reservations")} value={String(data.totals.reserved)} />
            <Stat label={t("blocks")} value={String(data.totals.blocked)} />
            <Stat label={t("uncertain")} value={String(data.totals.uncertain)} />
            <Stat label={t("inflight")} value={String(data.inflight)} />
          </dl>
          <p className="mt-4 text-sm">
            {t("estimated")}: {data.totals.estimated.length ? data.totals.estimated.map((row) => money(row.minor, row.currency, t("noPrice"))).join(", ") : t("none")} · {data.totals.estimatedUnknown}
          </p>
          <p className="text-sm">
            {t("reported")}: {data.totals.reported.length ? data.totals.reported.map((row) => money(row.minor, row.currency, t("noPrice"))).join(", ") : t("none")} · {data.totals.reportedUnknown}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {data.holds.map((hold) => `${hold.scope} ${money(hold.reservedMinor, hold.currency, t("noPrice"))} / ${money(hold.settledMinor, hold.currency, t("noPrice"))} / ${money(hold.limitMinor, hold.currency, t("noPrice"))}`).join(" · ") || t("none")}
          </p>
          <form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => event.preventDefault()}>
            {(["provider", "model", "user", "operation", "status"] as const).map((key) => (
              <input
                key={key}
                aria-label={key}
                value={query[key]}
                placeholder={key}
                onChange={(event) => setQuery((current) => ({ ...current, [key]: event.target.value }))}
                className="min-h-11 rounded-full border border-white/10 bg-black/20 px-3 text-sm"
              />
            ))}
          </form>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">{en ? "When" : "Quando"}</th>
                  <th className="py-2 pr-3">{en ? "Operation" : "Operação"}</th>
                  <th className="py-2 pr-3">{en ? "Provider" : "Provedor"}</th>
                  <th className="py-2 pr-3">{en ? "Model" : "Modelo"}</th>
                  <th className="py-2 pr-3">{en ? "User" : "Usuário"}</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">{en ? "Tokens in/out/cache/think" : "Tokens in/out/cache/think"}</th>
                  <th className="py-2 pr-3">{en ? "Images / audio / video" : "Imagens / áudio / vídeo"}</th>
                  <th className="py-2 pr-3">{t("estimated")}</th>
                  <th className="py-2">{t("reported")}</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.id} data-testid="spend-row" className="border-t border-white/10">
                    <td className="py-2 pr-3">{entry.createdAt.slice(11, 19)}</td>
                    <td className="py-2 pr-3">{entry.operation}</td>
                    <td className="py-2 pr-3">{entry.provider}</td>
                    <td className="py-2 pr-3">{entry.model ?? (en ? "not reported" : "não informado")}</td>
                    <td className="py-2 pr-3">{entry.userId}</td>
                    <td className="py-2 pr-3">{entry.status}{entry.block ? ` · ${entry.block}` : ""}</td>
                    <td className="py-2 pr-3">{entry.inputTokens ?? "–"}/{entry.outputTokens ?? "–"}/{entry.cachedTokens ?? "–"}/{entry.thinkingTokens ?? "–"}</td>
                    <td className="py-2 pr-3">{entry.imageCount ?? "–"} / {entry.audioSeconds ?? "–"}s / {entry.videoSeconds ?? "–"}s</td>
                    <td className="py-2 pr-3">{money(entry.estimatedMinor, entry.currency, t("noPrice"))}</td>
                    <td className="py-2">{money(entry.reportedMinor, entry.currency, t("noPrice"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 className="mt-8 text-sm font-medium">{t("coverage")}</h2>
          <div className="mt-2 overflow-x-auto">
            <table data-testid="spend-coverage" className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Route</th>
                  <th className="py-2 pr-3">Operation</th>
                  <th className="py-2 pr-3">Guard</th>
                  <th className="py-2 pr-3">If denied</th>
                  <th className="py-2">Proof</th>
                </tr>
              </thead>
              <tbody>
                {SPEND_PATHS.map((path) => (
                  <tr key={`${path.method} ${path.path}`} className="border-t border-white/10">
                    <td className="py-2 pr-3">{path.method} {path.path}</td>
                    <td className="py-2 pr-3">{path.operation}</td>
                    <td className="py-2 pr-3">{path.guard}</td>
                    <td className="py-2 pr-3">{path.denial}</td>
                    <td className="py-2">{path.test}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 px-3 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg">{value}</dd>
    </div>
  );
}
