import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { databaseUrl, onVercel } from "../accounts/config";
import { dataDir } from "../accounts/paths";
import type { SpendOperation } from "./catalog";

export type SpendStatus = "reserved" | "succeeded" | "failed" | "timeout" | "blocked" | "uncertain" | "replay";

export interface SpendEntry {
  id: string;
  requestId: string;
  attempt: number;
  /** Hash of a provider job id. The raw id is not stored. */
  jobRef: string | null;
  userId: string;
  operation: SpendOperation;
  provider: string;
  model: string | null;
  status: SpendStatus;
  block: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  thinkingTokens: number | null;
  imageCount: number | null;
  audioSeconds: number | null;
  videoSeconds: number | null;
  /** Estimated cents. Null means unknown, which is not zero. */
  estimatedMinor: number | null;
  /** Provider-reported cents. Null means the provider did not report a bill. */
  reportedMinor: number | null;
  currency: "USD" | null;
  priceVersion: string | null;
  origin: "live" | "test";
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Hold {
  scope: string;
  currency: "USD";
  limitMinor: number;
  reservedMinor: number;
  settledMinor: number;
}

interface RateBucket {
  userId: string;
  windowStart: number;
  count: number;
}

interface Db {
  entries: SpendEntry[];
  holds: Hold[];
  rates: RateBucket[];
  replay: { userId: string; key: string; status: number; code: string; at: number }[];
}

const locks = new Map<string, Promise<unknown>>();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const dir = dataDir();
  const prev = locks.get(dir) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(dir, run.then(() => undefined, () => undefined));
  return run;
}

function dbPath(): string {
  return path.join(dataDir(), "spend.json");
}

async function readDb(): Promise<Db> {
  try {
    const parsed = JSON.parse(await readFile(dbPath(), "utf8")) as Partial<Db>;
    return { entries: parsed.entries ?? [], holds: parsed.holds ?? [], rates: parsed.rates ?? [], replay: parsed.replay ?? [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], holds: [], rates: [], replay: [] };
    throw error;
  }
}

async function writeDb(db: Db): Promise<void> {
  const dest = dbPath();
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(db));
  try {
    await rename(tmp, dest);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EEXIST" && code !== "EBUSY") {
      await rm(tmp, { force: true });
      throw error;
    }
    await rm(dest, { force: true });
    await rename(tmp, dest);
  }
}

export function jobRef(id: string | null | undefined): string | null {
  if (!id) return null;
  return createHash("sha256").update(id).digest("hex").slice(0, 16);
}

export function newSpendId(): string {
  return `spd_${randomBytes(9).toString("base64url")}`;
}

let sqlCache: { url: string; sql: NeonQueryFunction<false, false> } | null = null;
let schema: Promise<void> | null = null;

function sql(): NeonQueryFunction<false, false> {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL ausente");
  if (!sqlCache || sqlCache.url !== url) sqlCache = { url, sql: neon(url) };
  return sqlCache.sql;
}

async function ready(): Promise<NeonQueryFunction<false, false>> {
  const db = sql();
  schema ??= (async () => {
    await db`CREATE TABLE IF NOT EXISTS animind_spend_entries (
      id text PRIMARY KEY,
      request_id text NOT NULL,
      attempt integer NOT NULL,
      job_ref text,
      user_id text NOT NULL,
      operation text NOT NULL,
      provider text NOT NULL,
      model text,
      status text NOT NULL,
      block text,
      latency_ms integer,
      input_tokens integer,
      output_tokens integer,
      cached_tokens integer,
      thinking_tokens integer,
      image_count integer,
      audio_seconds double precision,
      video_seconds double precision,
      estimated_minor integer,
      reported_minor integer,
      currency text,
      price_version text,
      origin text NOT NULL,
      idempotency_key text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )`;
    await db`CREATE TABLE IF NOT EXISTS animind_spend_holds (
      scope text PRIMARY KEY,
      currency text NOT NULL,
      limit_minor bigint NOT NULL,
      reserved_minor bigint NOT NULL,
      settled_minor bigint NOT NULL
    )`;
    await db`CREATE TABLE IF NOT EXISTS animind_spend_replay (
      user_id text NOT NULL,
      idempotency_key text NOT NULL,
      status integer NOT NULL,
      code text NOT NULL,
      at timestamptz NOT NULL,
      PRIMARY KEY (user_id, idempotency_key)
    )`;
  })().catch((error: unknown) => {
    schema = null;
    throw error;
  });
  await schema;
  return db;
}

function usePostgres(): boolean {
  return Boolean(databaseUrl());
}

export async function ledgerAvailable(): Promise<boolean> {
  if (process.env.ANIMINDLY_SPEND_LEDGER === "unavailable" || process.env.ANIMIND_SPEND_LEDGER === "unavailable") return false;
  if (onVercel() && !databaseUrl()) return false;
  if (usePostgres()) {
    try {
      await ready();
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

export async function findReplay(userId: string, key: string): Promise<{ status: number; code: string } | null> {
  if (usePostgres()) {
    const db = await ready();
    const rows = await db`SELECT status, code, at FROM animind_spend_replay WHERE user_id = ${userId} AND idempotency_key = ${key} LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    if (Date.now() - new Date(String(row.at)).getTime() > 10 * 60 * 1000) return null;
    return { status: Number(row.status), code: String(row.code) };
  }
  const db = await readDb();
  const hit = db.replay.find((item) => item.userId === userId && item.key === key);
  if (!hit || Date.now() - hit.at > 10 * 60 * 1000) return null;
  return { status: hit.status, code: hit.code };
}

export async function saveReplay(userId: string, key: string, status: number, code: string): Promise<void> {
  if (usePostgres()) {
    const db = await ready();
    await db`INSERT INTO animind_spend_replay (user_id, idempotency_key, status, code, at)
      VALUES (${userId}, ${key}, ${status}, ${code}, ${new Date().toISOString()})
      ON CONFLICT (user_id, idempotency_key) DO UPDATE SET status = EXCLUDED.status, code = EXCLUDED.code, at = EXCLUDED.at`;
    return;
  }
  await exclusive(async () => {
    const db = await readDb();
    const index = db.replay.findIndex((item) => item.userId === userId && item.key === key);
    const next = { userId, key, status, code, at: Date.now() };
    if (index >= 0) db.replay[index] = next;
    else db.replay.push(next);
    await writeDb(db);
  });
}

export interface ReserveInput {
  entry: SpendEntry;
  globalLimit: number;
  userLimit: number;
  ratePerMin: number;
}

export type ReserveResult = { ok: true } | { ok: false; block: "budget" | "rate" };

function hold(db: Db, scope: string, limit: number): Hold {
  const found = db.holds.find((item) => item.scope === scope);
  if (found) {
    found.limitMinor = limit;
    return found;
  }
  const created: Hold = { scope, currency: "USD", limitMinor: limit, reservedMinor: 0, settledMinor: 0 };
  db.holds.push(created);
  return created;
}

export async function reserve(input: ReserveInput): Promise<ReserveResult> {
  const amount = input.entry.estimatedMinor ?? 0;
  if (usePostgres()) return reservePostgres(input, amount);
  return exclusive(async () => {
    const db = await readDb();
    const now = Date.now();
    const windowMs = 60_000;
    let bucket = db.rates.find((item) => item.userId === input.entry.userId);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { userId: input.entry.userId, windowStart: now, count: 0 };
      db.rates = db.rates.filter((item) => item.userId !== input.entry.userId);
      db.rates.push(bucket);
    }
    if (bucket.count >= input.ratePerMin) return { ok: false, block: "rate" };
    const global = hold(db, "global", input.globalLimit);
    const personal = hold(db, `user:${input.entry.userId}`, input.userLimit);
    if (global.settledMinor + global.reservedMinor + amount > global.limitMinor) return { ok: false, block: "budget" };
    if (personal.settledMinor + personal.reservedMinor + amount > personal.limitMinor) return { ok: false, block: "budget" };
    global.reservedMinor += amount;
    personal.reservedMinor += amount;
    bucket.count += 1;
    db.entries.push(input.entry);
    await writeDb(db);
    return { ok: true };
  });
}

async function reservePostgres(input: ReserveInput, amount: number): Promise<ReserveResult> {
  const db = await ready();
  const userScope = `user:${input.entry.userId}`;
  const results = await db.transaction([
    db`INSERT INTO animind_spend_holds (scope, currency, limit_minor, reserved_minor, settled_minor)
      VALUES ('global', 'USD', ${input.globalLimit}, 0, 0)
      ON CONFLICT (scope) DO UPDATE SET limit_minor = EXCLUDED.limit_minor`,
    db`INSERT INTO animind_spend_holds (scope, currency, limit_minor, reserved_minor, settled_minor)
      VALUES (${userScope}, 'USD', ${input.userLimit}, 0, 0)
      ON CONFLICT (scope) DO UPDATE SET limit_minor = EXCLUDED.limit_minor`,
    db`UPDATE animind_spend_holds SET reserved_minor = reserved_minor + ${amount}
      WHERE scope = 'global' AND settled_minor + reserved_minor + ${amount} <= limit_minor
      RETURNING scope`,
    db`UPDATE animind_spend_holds SET reserved_minor = reserved_minor + ${amount}
      WHERE scope = ${userScope} AND settled_minor + reserved_minor + ${amount} <= limit_minor
      RETURNING scope`,
  ]);
  const globalOk = Array.isArray(results[2]) && results[2].length > 0;
  const userOk = Array.isArray(results[3]) && results[3].length > 0;
  if (!globalOk || !userOk) {
    if (globalOk) await db`UPDATE animind_spend_holds SET reserved_minor = GREATEST(reserved_minor - ${amount}, 0) WHERE scope = 'global'`;
    if (userOk) await db`UPDATE animind_spend_holds SET reserved_minor = GREATEST(reserved_minor - ${amount}, 0) WHERE scope = ${userScope}`;
    return { ok: false, block: "budget" };
  }
  await insertEntry(input.entry);
  return { ok: true };
}

export async function insertEntry(entry: SpendEntry): Promise<void> {
  if (usePostgres()) {
    const db = await ready();
    await db`INSERT INTO animind_spend_entries (
      id, request_id, attempt, job_ref, user_id, operation, provider, model, status, block, latency_ms,
      input_tokens, output_tokens, cached_tokens, thinking_tokens, image_count, audio_seconds, video_seconds,
      estimated_minor, reported_minor, currency, price_version, origin, idempotency_key, created_at, updated_at
    ) VALUES (
      ${entry.id}, ${entry.requestId}, ${entry.attempt}, ${entry.jobRef}, ${entry.userId}, ${entry.operation},
      ${entry.provider}, ${entry.model}, ${entry.status}, ${entry.block}, ${entry.latencyMs},
      ${entry.inputTokens}, ${entry.outputTokens}, ${entry.cachedTokens}, ${entry.thinkingTokens},
      ${entry.imageCount}, ${entry.audioSeconds}, ${entry.videoSeconds},
      ${entry.estimatedMinor}, ${entry.reportedMinor}, ${entry.currency}, ${entry.priceVersion}, ${entry.origin},
      ${entry.idempotencyKey}, ${entry.createdAt}, ${entry.updatedAt}
    )`;
    return;
  }
  await exclusive(async () => {
    const db = await readDb();
    db.entries.push(entry);
    await writeDb(db);
  });
}

export async function settle(id: string, patch: Partial<Pick<SpendEntry, "status" | "block" | "latencyMs" | "inputTokens" | "outputTokens" | "cachedTokens" | "thinkingTokens" | "imageCount" | "audioSeconds" | "videoSeconds" | "reportedMinor" | "jobRef" | "model">>): Promise<void> {
  if (usePostgres()) {
    const db = await ready();
    const rows = await db`SELECT estimated_minor, user_id, status FROM animind_spend_entries WHERE id = ${id} LIMIT 1`;
    const current = rows[0];
    if (!current || current.status !== "reserved") {
      await db`UPDATE animind_spend_entries SET
        status = COALESCE(${patch.status ?? null}, status),
        block = COALESCE(${patch.block ?? null}, block),
        latency_ms = COALESCE(${patch.latencyMs ?? null}, latency_ms),
        reported_minor = COALESCE(${patch.reportedMinor ?? null}, reported_minor),
        job_ref = COALESCE(${patch.jobRef ?? null}, job_ref),
        model = COALESCE(${patch.model ?? null}, model),
        updated_at = ${new Date().toISOString()}
        WHERE id = ${id}`;
      return;
    }
    const amount = Number(current.estimated_minor ?? 0);
    const userScope = `user:${String(current.user_id)}`;
    const keep = patch.status === "succeeded" || patch.status === "uncertain";
    await db.transaction([
      db`UPDATE animind_spend_holds SET
        reserved_minor = GREATEST(reserved_minor - ${amount}, 0),
        settled_minor = settled_minor + ${keep ? amount : 0}
        WHERE scope = 'global'`,
      db`UPDATE animind_spend_holds SET
        reserved_minor = GREATEST(reserved_minor - ${amount}, 0),
        settled_minor = settled_minor + ${keep ? amount : 0}
        WHERE scope = ${userScope}`,
      db`UPDATE animind_spend_entries SET
        status = ${patch.status ?? "uncertain"},
        block = ${patch.block ?? null},
        latency_ms = ${patch.latencyMs ?? null},
        input_tokens = ${patch.inputTokens ?? null},
        output_tokens = ${patch.outputTokens ?? null},
        cached_tokens = ${patch.cachedTokens ?? null},
        thinking_tokens = ${patch.thinkingTokens ?? null},
        image_count = ${patch.imageCount ?? null},
        audio_seconds = ${patch.audioSeconds ?? null},
        video_seconds = ${patch.videoSeconds ?? null},
        reported_minor = ${patch.reportedMinor ?? null},
        job_ref = COALESCE(${patch.jobRef ?? null}, job_ref),
        model = COALESCE(${patch.model ?? null}, model),
        updated_at = ${new Date().toISOString()}
        WHERE id = ${id}`,
    ]);
    return;
  }
  await exclusive(async () => {
    const db = await readDb();
    const entry = db.entries.find((item) => item.id === id);
    if (!entry) return;
    const amount = entry.estimatedMinor ?? 0;
    if (entry.status === "reserved") {
      const global = db.holds.find((item) => item.scope === "global");
      const personal = db.holds.find((item) => item.scope === `user:${entry.userId}`);
      const keep = patch.status === "succeeded" || patch.status === "uncertain";
      for (const row of [global, personal]) {
        if (!row) continue;
        row.reservedMinor = Math.max(0, row.reservedMinor - amount);
        if (keep) row.settledMinor += amount;
      }
    }
    Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
    await writeDb(db);
  });
}

export async function listEntries(): Promise<{ entries: SpendEntry[]; holds: Hold[] }> {
  if (usePostgres()) {
    const db = await ready();
    const entries = await db`SELECT * FROM animind_spend_entries ORDER BY created_at DESC LIMIT 500`;
    const holds = await db`SELECT * FROM animind_spend_holds`;
    return {
      entries: entries.map(entryFrom),
      holds: holds.map((row) => ({
        scope: String(row.scope),
        currency: "USD",
        limitMinor: Number(row.limit_minor),
        reservedMinor: Number(row.reserved_minor),
        settledMinor: Number(row.settled_minor),
      })),
    };
  }
  const db = await readDb();
  return { entries: db.entries, holds: db.holds };
}

function entryFrom(row: Record<string, unknown>): SpendEntry {
  const num = (key: string) => (row[key] === null || row[key] === undefined ? null : Number(row[key]));
  return {
    id: String(row.id),
    requestId: String(row.request_id),
    attempt: Number(row.attempt),
    jobRef: row.job_ref == null ? null : String(row.job_ref),
    userId: String(row.user_id),
    operation: String(row.operation) as SpendOperation,
    provider: String(row.provider),
    model: row.model == null ? null : String(row.model),
    status: String(row.status) as SpendStatus,
    block: row.block == null ? null : String(row.block),
    latencyMs: num("latency_ms"),
    inputTokens: num("input_tokens"),
    outputTokens: num("output_tokens"),
    cachedTokens: num("cached_tokens"),
    thinkingTokens: num("thinking_tokens"),
    imageCount: num("image_count"),
    audioSeconds: num("audio_seconds"),
    videoSeconds: num("video_seconds"),
    estimatedMinor: num("estimated_minor"),
    reportedMinor: num("reported_minor"),
    currency: row.currency === "USD" ? "USD" : null,
    priceVersion: row.price_version == null ? null : String(row.price_version),
    origin: row.origin === "test" ? "test" : "live",
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

/** Releases reservations that outlived the timeout. Cost stays unknown, not zero. */
export async function reconcileStale(timeoutMs: number): Promise<number> {
  const cutoff = Date.now() - timeoutMs;
  if (usePostgres()) {
    const db = await ready();
    const rows = await db`SELECT id FROM animind_spend_entries WHERE status = 'reserved' AND created_at < ${new Date(cutoff).toISOString()}`;
    for (const row of rows) await settle(String(row.id), { status: "uncertain", block: "timeout" });
    return rows.length;
  }
  const { entries } = await listEntries();
  const stale = entries.filter((entry) => entry.status === "reserved" && Date.parse(entry.createdAt) < cutoff);
  for (const entry of stale) await settle(entry.id, { status: "uncertain", block: "timeout" });
  return stale.length;
}
