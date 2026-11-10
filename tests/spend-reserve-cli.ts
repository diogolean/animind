import { newSpendId, reserve, type SpendEntry } from "../lib/spend/ledger";

const userId = process.argv[2] || "usr_a";
const now = new Date().toISOString();
const entry: SpendEntry = {
  id: newSpendId(),
  requestId: "req_cli",
  attempt: 1,
  jobRef: null,
  userId,
  operation: "render",
  provider: "core",
  model: "unspecified",
  status: "reserved",
  block: null,
  latencyMs: null,
  inputTokens: null,
  outputTokens: null,
  cachedTokens: null,
  thinkingTokens: null,
  imageCount: null,
  audioSeconds: null,
  videoSeconds: null,
  estimatedMinor: 1,
  reportedMinor: null,
  currency: "USD",
  priceVersion: "test",
  origin: "test",
  idempotencyKey: null,
  createdAt: now,
  updatedAt: now,
};

reserve({ entry, globalLimit: 1, userLimit: 1, ratePerMin: 10, concurrency: 2 })
  .then((result) => {
    console.log(result.ok ? "ok" : result.block);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
