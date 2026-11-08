import { spendFrame } from "./context";
import { insertEntry, ledgerAvailable, newSpendId, type SpendEntry } from "./ledger";

/**
 * A provider call that rides inside a reservation already opened for this request.
 * The row is a read: estimated and reported amounts stay null, so an unknown cost is not stored as zero.
 * Rate and concurrency stay in the shared ledger, not in this process.
 */
export async function noteNestedProviderRead(operation: "tone"): Promise<void> {
  const frame = spendFrame();
  if (!frame?.userId || !frame.requestId) return;
  if (!(await ledgerAvailable())) return;
  const now = new Date().toISOString();
  const entry: SpendEntry = {
    id: newSpendId(),
    requestId: frame.requestId,
    attempt: frame.retries + 1,
    jobRef: null,
    userId: frame.userId,
    operation,
    provider: "core",
    model: null,
    status: "read",
    block: "unbilled",
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    thinkingTokens: null,
    imageCount: null,
    audioSeconds: null,
    videoSeconds: null,
    estimatedMinor: null,
    reportedMinor: null,
    currency: null,
    priceVersion: null,
    origin: process.env.ANIMINDLY_SPEND_ORIGIN === "test" ? "test" : "live",
    idempotencyKey: null,
    createdAt: now,
    updatedAt: now,
  };
  await insertEntry(entry);
}
