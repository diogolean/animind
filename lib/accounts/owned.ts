import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { databaseUrl } from "./config";
import { opaqueUserId } from "./opaque-user";
import { dataDir } from "./paths";
import { sqlFor, type SqlQuery } from "../spend/sql";

/**
 * Jobs and files this app has seen created for one account.
 * The core still serves GET /v1/jobs and GET /v1/files to anyone holding the API key.
 * This table is the lock: a resource with no row is refused for every account.
 */

const JOB_ID = /^[A-Za-z0-9_-]{1,4096}$/;
const JOB_STATUS = new Set(["queued", "running", "done", "failed"]);
const FILE_PART = /^[\w.~-]+$/u;

type Kind = "job" | "file";

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
      await locked`CREATE TABLE IF NOT EXISTS animind_owned (
        kind text NOT NULL,
        key text NOT NULL,
        user_id text NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (kind, key)
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
  return path.join(dataDir(), "owned.json");
}

async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const dir = dataDir();
  const prev = chains.get(dir) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  chains.set(dir, run.then(() => undefined, () => undefined));
  return run;
}

async function readFileStore(): Promise<Record<Kind, Record<string, string>>> {
  try {
    const parsed = JSON.parse(await readFile(fileStore(), "utf8")) as Partial<Record<Kind, Record<string, string>>>;
    return { job: parsed.job ?? {}, file: parsed.file ?? {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { job: {}, file: {} };
    throw error;
  }
}

export function fileKey(parts: string[]): string | null {
  if (parts.length === 0 || parts.length > 8) return null;
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.includes("\0") || part.length > 180)) return null;
  if (!parts.every((part) => FILE_PART.test(part))) return null;
  const key = parts.join("/");
  return key.length <= 500 ? key : null;
}

export function jobKey(id: string): string | null {
  return JOB_ID.test(id) ? id : null;
}

function fileKeyFromUrl(value: string): string | null {
  const match = value.match(/\/(?:api|v1)\/files\/([^"\\\s?#]+)/);
  if (!match?.[1]) return null;
  let decoded = match[1];
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return fileKey(decoded.split("/"));
}

/** Job ids and file paths named by a response this account is allowed to keep. */
export function resourcesInText(text: string): { jobs: string[]; files: string[] } {
  const jobs = new Set<string>();
  const files = new Set<string>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string" && jobKey(record.id) && typeof record.status === "string" && JOB_STATUS.has(record.status)) {
      jobs.add(record.id);
    }
    for (const item of Object.values(record)) {
      if (typeof item === "string") {
        const file = fileKeyFromUrl(item);
        if (file) files.add(file);
      } else {
        walk(item);
      }
    }
  };
  try {
    walk(JSON.parse(text));
  } catch {
    // A non-JSON body can still name a rewritten file URL.
  }
  for (const match of text.matchAll(/\/(?:api|v1)\/files\/([^"\\\s?#]+)/g)) {
    const file = fileKeyFromUrl(`/api/files/${match[1]}`);
    if (file) files.add(file);
  }
  return { jobs: [...jobs], files: [...files] };
}

async function claim(userId: string, kind: Kind, key: string): Promise<void> {
  const owner = opaqueUserId(userId);
  if (!owner) return;
  if (usePostgres()) {
    const db = await ready();
    await db`INSERT INTO animind_owned (kind, key, user_id, created_at)
      VALUES (${kind}, ${key}, ${owner}, ${new Date().toISOString()})
      ON CONFLICT (kind, key) DO NOTHING`;
    return;
  }
  await exclusive(async () => {
    const store = await readFileStore();
    if (store[kind][key]) return;
    store[kind][key] = owner;
    const dest = fileStore();
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, JSON.stringify(store));
  });
}

export async function rememberOwned(userId: string, text: string): Promise<void> {
  const found = resourcesInText(text);
  for (const id of found.jobs) await claim(userId, "job", id);
  for (const file of found.files) await claim(userId, "file", file);
}

export async function ownsResource(userId: string, kind: Kind, key: string): Promise<boolean> {
  const owner = opaqueUserId(userId);
  if (!owner) return false;
  if (usePostgres()) {
    const db = await ready();
    const rows = await db`SELECT user_id FROM animind_owned WHERE kind = ${kind} AND key = ${key} LIMIT 1`;
    return rows[0]?.user_id === owner;
  }
  const store = await readFileStore();
  return store[kind][key] === owner;
}
