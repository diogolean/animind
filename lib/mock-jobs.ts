import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { databaseUrl } from "./accounts/config";
import { opaqueUserId } from "./accounts/opaque-user";
import { dataDir } from "./accounts/paths";
import { sqlFor, type SqlQuery } from "./spend/sql";

/** A mock job id is a random token. It does not contain the request. */
const ID = /^mock_[A-Za-z0-9_-]{16,80}$/;

export interface MockJobRecord {
  id: string;
  userId: string;
  createdAt: number;
  request: unknown;
}

let schema: { url: string; ready: Promise<void> } | null = null;
const chains = new Map<string, Promise<unknown>>();

function usePostgres(): boolean {
  return Boolean(databaseUrl());
}

function sql(): SqlQuery {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL ausente");
  return sqlFor(url);
}

async function ready(): Promise<SqlQuery> {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL ausente");
  const db = sql();
  if (!schema || schema.url !== url) {
    const pending = db.session(async (locked) => {
      await locked`CREATE TABLE IF NOT EXISTS animind_mock_jobs (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        created_ms bigint NOT NULL,
        request jsonb NOT NULL
      )`;
    });
    schema = {
      url,
      ready: pending.catch((error: unknown) => {
        schema = null;
        throw error;
      }),
    };
  }
  await schema.ready;
  return db;
}

function fileStore(): string {
  return path.join(dataDir(), "mock-jobs.json");
}

async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const dir = dataDir();
  const prev = chains.get(dir) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  chains.set(dir, run.then(() => undefined, () => undefined));
  return run;
}

export function newMockJobId(): string {
  return `mock_${randomBytes(18).toString("base64url")}`;
}

export async function saveMockJob(record: MockJobRecord): Promise<void> {
  const owner = opaqueUserId(record.userId);
  if (!owner || !ID.test(record.id)) throw new Error("mock job refused");
  const stored = { ...record, userId: owner };
  if (usePostgres()) {
    const db = await ready();
    await db`INSERT INTO animind_mock_jobs (id, user_id, created_ms, request)
      VALUES (${stored.id}, ${stored.userId}, ${stored.createdAt}, ${JSON.stringify(stored.request)}::jsonb)`;
    return;
  }
  await exclusive(async () => {
    const jobs = await readFileStore();
    jobs[stored.id] = stored;
    const dest = fileStore();
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, JSON.stringify(jobs));
  });
}

export async function loadMockJob(id: string): Promise<MockJobRecord | null> {
  if (!ID.test(id)) return null;
  if (usePostgres()) {
    const db = await ready();
    const rows = await db`SELECT user_id, created_ms, request FROM animind_mock_jobs WHERE id = ${id} LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    return {
      id,
      userId: String(row.user_id),
      createdAt: Number(row.created_ms),
      request: typeof row.request === "string" ? JSON.parse(row.request) : row.request,
    };
  }
  const jobs = await readFileStore();
  return jobs[id] ?? null;
}

async function readFileStore(): Promise<Record<string, MockJobRecord>> {
  try {
    const parsed = JSON.parse(await readFile(fileStore(), "utf8")) as Record<string, MockJobRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
