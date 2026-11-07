import { json } from "@/lib/core";
import { isUser, requireUser } from "@/lib/accounts/http";
import { listEntries, reconcileStale, type SpendEntry } from "@/lib/spend/ledger";
import { readSpendLimits } from "@/lib/spend/policy";
import { spendTotals } from "@/lib/spend/totals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  if (actor.role !== "super_admin") return json({ error: "Sem permissão" }, 403);
  const limits = readSpendLimits();
  const timeoutMs = limits.ok ? limits.limits.timeoutMs : 30_000;
  let ledger = true;
  try {
    await reconcileStale(timeoutMs);
  } catch {
    ledger = false;
  }
  if (!ledger) return json({ error: "Livro de gastos indisponível", code: "ledger" }, 503);
  const { entries, holds, inflight } = await listEntries();
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const provider = url.searchParams.get("provider") ?? "";
  const model = url.searchParams.get("model") ?? "";
  const user = url.searchParams.get("user") ?? "";
  const operation = url.searchParams.get("operation") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const filtered = entries.filter((entry) => {
    if (provider && entry.provider !== provider) return false;
    if (model && entry.model !== model) return false;
    if (user && entry.userId !== user) return false;
    if (operation && entry.operation !== operation) return false;
    if (status && entry.status !== status) return false;
    const at = Date.parse(entry.createdAt);
    if (from && at < Date.parse(from)) return false;
    if (to && at > Date.parse(to)) return false;
    return true;
  });
  const serverNow = new Date().toISOString();
  const newest = filtered.reduce((max, entry) => Math.max(max, Date.parse(entry.updatedAt)), 0);
  const lagMs = newest ? Date.parse(serverNow) - newest : 0;
  return json({
    serverNow,
    lagMs,
    ledger: "ok",
    testData: filtered.length > 0 && filtered.every((entry) => entry.origin === "test"),
    priceVersion: limits.ok ? limits.limits.prices.version : null,
    priceSource: limits.ok ? limits.limits.prices.source : "unavailable",
    inflight,
    totals: spendTotals(filtered),
    holds: holds.map((hold) => ({
      scope: hold.scope.startsWith("user:") ? "user" : hold.scope,
      reservedMinor: hold.reservedMinor,
      settledMinor: hold.settledMinor,
      limitMinor: hold.limitMinor,
      currency: hold.currency,
    })),
    entries: filtered.slice(0, 200).map(publicEntry),
  });
}

function publicEntry(entry: SpendEntry) {
  return {
    id: entry.id,
    requestId: entry.requestId,
    attempt: entry.attempt,
    jobRef: entry.jobRef,
    userId: entry.userId,
    operation: entry.operation,
    provider: entry.provider,
    model: entry.model,
    status: entry.status,
    block: entry.block,
    latencyMs: entry.latencyMs,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cachedTokens: entry.cachedTokens,
    thinkingTokens: entry.thinkingTokens,
    imageCount: entry.imageCount,
    audioSeconds: entry.audioSeconds,
    videoSeconds: entry.videoSeconds,
    estimatedMinor: entry.estimatedMinor,
    reportedMinor: entry.reportedMinor,
    currency: entry.currency,
    priceVersion: entry.priceVersion,
    origin: entry.origin,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

