import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { databaseUrl, onVercel } from "../accounts/config";
import { dataDir } from "../accounts/paths";
import type { SpendOperation } from "./catalog";

export type SpendStatus = "reserved" | "succeeded" | "failed" | "timeout" | "blocked" | "uncertain" | "replay" | "read";

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
  replay: { userId: string; key: string; status: number; code: string; bodyHash: string; at: number }[];
  /** Paid attempts currently reserved. Shared by every process using this directory. */
  inflight: number;
}

const locks = new Map<string, Promise<unknown>>();

const STALE_LOCK_MS = 5_000;

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const dir = dataDir();
  const prev = locks.get(dir) ?? Promise.resolve();
  const run = prev.then(() => withFileLock(fn), () => withFileLock(fn));
  locks.set(dir, run.then(() => undefined, () => undefined));
  return run;
}

/** Cross-process lock. A crashed holder is cleared after STALE_LOCK_MS. One lock, so it cannot deadlock with itself. */
async function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockPath = path.join(dataDir(), "spend.lock");
  await mkdir(dataDir(), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(String(process.pid));
        return await fn();
      } finally {
        await handle.close();
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > STALE_LOCK_MS) await rm(lockPath, { force: true });
      } catch {
        // The holder removed the lock between the collision and the stat.
      }
      if (Date.now() - started > 8_000) throw new Error("spend-lock");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

function dbPath(): string {
  return path.join(dataDir(), "spend.json");
}

async function readDb(): Promise<Db> {
  try {
    const parsed = JSON.parse(await readFile(dbPath(), "utf8")) as Partial<Db>;
    return {
      entries: parsed.entries ?? [],
      holds: parsed.holds ?? [],
      rates: parsed.rates ?? [],
      replay: (parsed.replay ?? []).map((item) => ({ ...item, bodyHash: item.bodyHash ?? "" })),
      inflight: parsed.inflight ?? 0,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], holds: [], rates: [], replay: [], inflight: 0 };
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

export function bodyHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
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
      body_hash text NOT NULL DEFAULT '',
      at timestamptz NOT NULL,
      PRIMARY KEY (user_id, idempotency_key)
    )`;
    await db`ALTER TABLE animind_spend_replay ADD COLUMN IF NOT EXISTS body_hash text NOT NULL DEFAULT ''`;
    await db`CREATE TABLE IF NOT EXISTS animind_spend_rates (
      user_id text PRIMARY KEY,
      window_start timestamptz NOT NULL,
      count integer NOT NULL
    )`;
    await db`CREATE TABLE IF NOT EXISTS animind_spend_inflight (
      id integer PRIMARY KEY,
      slots integer NOT NULL
    )`;
    await db`INSERT INTO animind_spend_inflight (id, slots) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`;
    await db`CREATE OR REPLACE FUNCTION animind_spend_reserve(
      p_amount bigint, p_global bigint, p_user bigint, p_user_scope text, p_user_id text,
      p_rate integer, p_concurrency integer, p_now timestamptz
    ) RETURNS text LANGUAGE plpgsql AS $fn$
    DECLARE
      v_count integer;
      v_window timestamptz;
      v_slots integer;
      v_global_used bigint;
      v_user_used bigint;
    BEGIN
      INSERT INTO animind_spend_rates (user_id, window_start, count)
      VALUES (p_user_id, p_now, 0)
      ON CONFLICT (user_id) DO NOTHING;
      SELECT count, window_start INTO v_count, v_window
      FROM animind_spend_rates WHERE user_id = p_user_id FOR UPDATE;
      IF v_window <= p_now - interval '60 seconds' THEN
        v_count := 0;
        v_window := p_now;
      END IF;
      IF v_count >= p_rate THEN
        RETURN 'rate';
      END IF;
      INSERT INTO animind_spend_holds (scope, currency, limit_minor, reserved_minor, settled_minor)
      VALUES ('global', 'USD', p_global, 0, 0)
      ON CONFLICT (scope) DO UPDATE SET limit_minor = EXCLUDED.limit_minor;
      INSERT INTO animind_spend_holds (scope, currency, limit_minor, reserved_minor, settled_minor)
      VALUES (p_user_scope, 'USD', p_user, 0, 0)
      ON CONFLICT (scope) DO UPDATE SET limit_minor = EXCLUDED.limit_minor;
      PERFORM 1 FROM animind_spend_holds WHERE scope = 'global' FOR UPDATE;
      PERFORM 1 FROM animind_spend_holds WHERE scope = p_user_scope FOR UPDATE;
      SELECT slots INTO v_slots FROM animind_spend_inflight WHERE id = 1 FOR UPDATE;
      SELECT settled_minor + reserved_minor INTO v_global_used FROM animind_spend_holds WHERE scope = 'global';
      SELECT settled_minor + reserved_minor INTO v_user_used FROM animind_spend_holds WHERE scope = p_user_scope;
      IF v_slots + 1 > p_concurrency THEN
        RETURN 'busy';
      END IF;
      IF v_global_used + p_amount > p_global OR v_user_used + p_amount > p_user THEN
        RETURN 'budget';
      END IF;
      UPDATE animind_spend_rates SET count = v_count + 1, window_start = v_window WHERE user_id = p_user_id;
      UPDATE animind_spend_holds SET reserved_minor = reserved_minor + p_amount WHERE scope = 'global';
      UPDATE animind_spend_holds SET reserved_minor = reserved_minor + p_amount WHERE scope = p_user_scope;
      UPDATE animind_spend_inflight SET slots = slots + 1 WHERE id = 1;
      RETURN 'ok';
    END
    $fn$`;
    await db`CREATE OR REPLACE FUNCTION animind_spend_reserve_more(
      p_id text, p_amount bigint, p_global bigint, p_user bigint, p_rate integer, p_now timestamptz
    ) RETURNS text LANGUAGE plpgsql AS $fn$
    DECLARE
      v_user text;
      v_scope text;
      v_count integer;
      v_window timestamptz;
      v_global_used bigint;
      v_user_used bigint;
    BEGIN
      SELECT user_id INTO v_user FROM animind_spend_entries WHERE id = p_id AND status = 'reserved' FOR UPDATE;
      IF v_user IS NULL THEN
        RETURN 'budget';
      END IF;
      v_scope := 'user:' || v_user;
      INSERT INTO animind_spend_rates (user_id, window_start, count)
      VALUES (v_user, p_now, 0)
      ON CONFLICT (user_id) DO NOTHING;
      SELECT count, window_start INTO v_count, v_window
      FROM animind_spend_rates WHERE user_id = v_user FOR UPDATE;
      IF v_window <= p_now - interval '60 seconds' THEN
        v_count := 0;
        v_window := p_now;
      END IF;
      IF v_count >= p_rate THEN
        RETURN 'rate';
      END IF;
      PERFORM 1 FROM animind_spend_holds WHERE scope = 'global' FOR UPDATE;
      PERFORM 1 FROM animind_spend_holds WHERE scope = v_scope FOR UPDATE;
      SELECT settled_minor + reserved_minor INTO v_global_used FROM animind_spend_holds WHERE scope = 'global';
      SELECT settled_minor + reserved_minor INTO v_user_used FROM animind_spend_holds WHERE scope = v_scope;
      IF v_global_used IS NULL OR v_user_used IS NULL
        OR v_global_used + p_amount > p_global OR v_user_used + p_amount > p_user THEN
        RETURN 'budget';
      END IF;
      UPDATE animind_spend_rates SET count = v_count + 1, window_start = v_window WHERE user_id = v_user;
      UPDATE animind_spend_holds SET reserved_minor = reserved_minor + p_amount WHERE scope = 'global';
      UPDATE animind_spend_holds SET reserved_minor = reserved_minor + p_amount WHERE scope = v_scope;
      UPDATE animind_spend_entries
      SET estimated_minor = COALESCE(estimated_minor, 0) + p_amount, attempt = attempt + 1, updated_at = p_now
      WHERE id = p_id AND status = 'reserved';
      RETURN 'ok';
    END
    $fn$`;
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

export async function findReplay(userId: string, key: string): Promise<{ status: number; code: string; bodyHash: string } | null> {
  if (usePostgres()) {
    const db = await ready();
    const rows = await db`SELECT status, code, body_hash, at FROM animind_spend_replay WHERE user_id = ${userId} AND idempotency_key = ${key} LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    if (Date.now() - new Date(String(row.at)).getTime() > 10 * 60 * 1000) return null;
    return { status: Number(row.status), code: String(row.code), bodyHash: row.body_hash == null ? "" : String(row.body_hash) };
  }
  const db = await readDb();
  const hit = db.replay.find((item) => item.userId === userId && item.key === key);
  if (!hit || Date.now() - hit.at > 10 * 60 * 1000) return null;
  return { status: hit.status, code: hit.code, bodyHash: hit.bodyHash };
}

export async function saveReplay(userId: string, key: string, status: number, code: string, bodyHash = ""): Promise<void> {
  if (usePostgres()) {
    const db = await ready();
    await db`INSERT INTO animind_spend_replay (user_id, idempotency_key, status, code, body_hash, at)
      VALUES (${userId}, ${key}, ${status}, ${code}, ${bodyHash}, ${new Date().toISOString()})
      ON CONFLICT (user_id, idempotency_key) DO UPDATE SET status = EXCLUDED.status, code = EXCLUDED.code, body_hash = EXCLUDED.body_hash, at = EXCLUDED.at`;
    return;
  }
  await exclusive(async () => {
    const db = await readDb();
    const index = db.replay.findIndex((item) => item.userId === userId && item.key === key);
    const next = { userId, key, status, code, bodyHash, at: Date.now() };
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
  concurrency: number;
}

export type ReserveResult = { ok: true } | { ok: false; block: "budget" | "rate" | "busy" };

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
    if (db.inflight + 1 > input.concurrency) return { ok: false, block: "busy" };
    const global = hold(db, "global", input.globalLimit);
    const personal = hold(db, `user:${input.entry.userId}`, input.userLimit);
    if (global.settledMinor + global.reservedMinor + amount > global.limitMinor) return { ok: false, block: "budget" };
    if (personal.settledMinor + personal.reservedMinor + amount > personal.limitMinor) return { ok: false, block: "budget" };
    global.reservedMinor += amount;
    personal.reservedMinor += amount;
    bucket.count += 1;
    db.inflight += 1;
    db.entries.push(input.entry);
    await writeDb(db);
    return { ok: true };
  });
}

async function reservePostgres(input: ReserveInput, amount: number): Promise<ReserveResult> {
  const db = await ready();
  const userScope = `user:${input.entry.userId}`;
  const now = new Date().toISOString();
  const rows = await db`SELECT animind_spend_reserve(
    ${amount}, ${input.globalLimit}, ${input.userLimit}, ${userScope}, ${input.entry.userId},
    ${input.ratePerMin}, ${input.concurrency}, ${now}::timestamptz
  ) AS result`;
  const result = String(rows[0]?.result ?? "budget");
  if (result === "rate" || result === "busy" || result === "budget") return { ok: false, block: result };
  if (result !== "ok") return { ok: false, block: "budget" };
  await insertEntry(input.entry);
  return { ok: true };
}

/** Add another attempt's estimate onto a live reservation. A refused add does not start that attempt. */
export async function reserveMore(id: string, amount: number, globalLimit: number, userLimit: number, ratePerMin: number): Promise<ReserveResult> {
  if (usePostgres()) {
    const db = await ready();
    const now = new Date().toISOString();
    const rows = await db`SELECT animind_spend_reserve_more(
      ${id}, ${amount}, ${globalLimit}, ${userLimit}, ${ratePerMin}, ${now}::timestamptz
    ) AS result`;
    const result = String(rows[0]?.result ?? "budget");
    if (result === "rate" || result === "budget") return { ok: false, block: result };
    if (result !== "ok") return { ok: false, block: "budget" };
    return { ok: true };
  }
  return exclusive(async () => {
    const db = await readDb();
    const entry = db.entries.find((item) => item.id === id);
    if (!entry || entry.status !== "reserved") return { ok: false, block: "budget" };
    const now = Date.now();
    let bucket = db.rates.find((item) => item.userId === entry.userId);
    if (!bucket || now - bucket.windowStart >= 60_000) {
      bucket = { userId: entry.userId, windowStart: now, count: 0 };
      db.rates = db.rates.filter((item) => item.userId !== entry.userId);
      db.rates.push(bucket);
    }
    if (bucket.count >= ratePerMin) return { ok: false, block: "rate" };
    const global = hold(db, "global", globalLimit);
    const personal = hold(db, `user:${entry.userId}`, userLimit);
    if (global.settledMinor + global.reservedMinor + amount > global.limitMinor) return { ok: false, block: "budget" };
    if (personal.settledMinor + personal.reservedMinor + amount > personal.limitMinor) return { ok: false, block: "budget" };
    global.reservedMinor += amount;
    personal.reservedMinor += amount;
    bucket.count += 1;
    entry.estimatedMinor = (entry.estimatedMinor ?? 0) + amount;
    entry.attempt += 1;
    entry.updatedAt = new Date().toISOString();
    await writeDb(db);
    return { ok: true };
  });
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
      db`UPDATE animind_spend_inflight SET slots = GREATEST(slots - 1, 0) WHERE id = 1`,
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
      db.inflight = Math.max(0, db.inflight - 1);
    }
    Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
    await writeDb(db);
  });
}

export async function listEntries(): Promise<{ entries: SpendEntry[]; holds: Hold[]; inflight: number }> {
  if (usePostgres()) {
    const db = await ready();
    const entries = await db`SELECT * FROM animind_spend_entries ORDER BY created_at DESC LIMIT 500`;
    const holds = await db`SELECT * FROM animind_spend_holds`;
    const slots = await db`SELECT slots FROM animind_spend_inflight WHERE id = 1`;
    return {
      entries: entries.map(entryFrom),
      holds: holds.map((row) => ({
        scope: String(row.scope),
        currency: "USD" as const,
        limitMinor: Number(row.limit_minor),
        reservedMinor: Number(row.reserved_minor),
        settledMinor: Number(row.settled_minor),
      })),
      inflight: Number(slots[0]?.slots ?? 0),
    };
  }
  const db = await readDb();
  return { entries: db.entries, holds: db.holds, inflight: db.inflight };
}

/** Fill a missing usage report once. Does not add tokens that were already stored and does not treat null as zero. */
export async function attachUsage(jobRefValue: string, patch: Partial<Pick<SpendEntry, "inputTokens" | "outputTokens" | "cachedTokens" | "thinkingTokens" | "imageCount" | "audioSeconds" | "videoSeconds" | "reportedMinor" | "model">>): Promise<boolean> {
  const values = [patch.inputTokens, patch.outputTokens, patch.cachedTokens, patch.thinkingTokens, patch.imageCount, patch.audioSeconds, patch.videoSeconds, patch.reportedMinor, patch.model];
  if (values.every((value) => value === null || value === undefined)) return false;
  if (usePostgres()) {
    const db = await ready();
    const rows = await db`UPDATE animind_spend_entries SET
      input_tokens = COALESCE(input_tokens, ${patch.inputTokens ?? null}),
      output_tokens = COALESCE(output_tokens, ${patch.outputTokens ?? null}),
      cached_tokens = COALESCE(cached_tokens, ${patch.cachedTokens ?? null}),
      thinking_tokens = COALESCE(thinking_tokens, ${patch.thinkingTokens ?? null}),
      image_count = COALESCE(image_count, ${patch.imageCount ?? null}),
      audio_seconds = COALESCE(audio_seconds, ${patch.audioSeconds ?? null}),
      video_seconds = COALESCE(video_seconds, ${patch.videoSeconds ?? null}),
      reported_minor = COALESCE(reported_minor, ${patch.reportedMinor ?? null}),
      model = COALESCE(model, ${patch.model ?? null}),
      updated_at = ${new Date().toISOString()}
      WHERE id = (
        SELECT id FROM animind_spend_entries
        WHERE job_ref = ${jobRefValue} AND status IN ('uncertain', 'succeeded')
          AND input_tokens IS NULL AND reported_minor IS NULL
        ORDER BY created_at DESC LIMIT 1
      )
      RETURNING id`;
    return rows.length > 0;
  }
  return exclusive(async () => {
    const db = await readDb();
    const entry = [...db.entries].reverse().find((item) => item.jobRef === jobRefValue && (item.status === "uncertain" || item.status === "succeeded"));
    if (!entry) return false;
    if (entry.inputTokens !== null || entry.reportedMinor !== null) return false;
    Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
    await writeDb(db);
    return true;
  });
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
