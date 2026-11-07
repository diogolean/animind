import type { SpendEntry } from "./ledger";

/** Sums estimated and reported only when both the amount and the currency exist. Null is unknown, not zero. */
export function spendTotals(entries: SpendEntry[]) {
  const billed = entries.filter((entry) => entry.status === "succeeded" || entry.status === "uncertain");
  const estimated = new Map<string, number>();
  const reported = new Map<string, number>();
  let estimatedUnknown = 0;
  let reportedUnknown = 0;
  for (const entry of billed) {
    if (entry.estimatedMinor === null || !entry.currency) estimatedUnknown += 1;
    else estimated.set(entry.currency, (estimated.get(entry.currency) ?? 0) + entry.estimatedMinor);
    if (entry.reportedMinor === null || !entry.currency) reportedUnknown += 1;
    else reported.set(entry.currency, (reported.get(entry.currency) ?? 0) + entry.reportedMinor);
  }
  return {
    calls: entries.filter((entry) => entry.status !== "read").length,
    reads: entries.filter((entry) => entry.status === "read").length,
    reserved: entries.filter((entry) => entry.status === "reserved").length,
    blocked: entries.filter((entry) => entry.status === "blocked").length,
    failed: entries.filter((entry) => entry.status === "failed" || entry.status === "timeout").length,
    uncertain: entries.filter((entry) => entry.status === "uncertain").length,
    estimated: [...estimated.entries()].map(([currency, minor]) => ({ currency, minor })),
    reported: [...reported.entries()].map(([currency, minor]) => ({ currency, minor })),
    estimatedUnknown,
    reportedUnknown,
  };
}
