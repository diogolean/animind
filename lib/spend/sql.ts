import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import pg from "pg";

export type SqlRow = Record<string, unknown>;

export interface SqlQuery {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<SqlRow[]>;
  transaction(queries: Array<Promise<SqlRow[]>>): Promise<SqlRow[][]>;
  /** One connection, so schema setup cannot interleave with another process. */
  session<T>(fn: (query: SqlQuery) => Promise<T>): Promise<T>;
}

/** Neon hosts stay on the serverless driver. Any other host uses the Postgres wire protocol. */
export function usesNeonDriver(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "neon.tech" || host.endsWith(".neon.tech");
}

/** Tests may use only loopback or the GitHub Actions service hostname. */
export function isIsolatedPostgresHost(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "postgres";
}

const pools = new Map<string, pg.Pool>();
const neonCache = new Map<string, NeonQueryFunction<false, false>>();

function statement(strings: TemplateStringsArray, values: unknown[]) {
  const text = strings.reduce((query, part, index) => query + part + (index < values.length ? `$${index + 1}` : ""), "");
  return { text, values };
}

function tagged(run: (text: string, values: unknown[]) => Promise<SqlRow[]>): SqlQuery {
  const query = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const built = statement(strings, values);
    let started: Promise<SqlRow[]> | null = null;
    const pending = {
      text: built.text,
      values: built.values,
      then(onFulfilled?: ((value: SqlRow[]) => unknown) | null, onRejected?: ((reason: unknown) => unknown) | null) {
        started ??= run(built.text, built.values);
        return started.then(onFulfilled, onRejected);
      },
    };
    return pending as unknown as Promise<SqlRow[]>;
  }) as SqlQuery;
  return query;
}

async function runTransaction(queries: Array<Promise<SqlRow[]>>, run: (text: string, values: unknown[]) => Promise<SqlRow[]>): Promise<SqlRow[][]> {
  const results: SqlRow[][] = [];
  for (const pending of queries) {
    const built = pending as Promise<SqlRow[]> & { text?: string; values?: unknown[] };
    if (!built.text) throw new Error("sql transaction received a query without text");
    results.push(await run(built.text, built.values ?? []));
  }
  return results;
}

function wire(url: string): SqlQuery {
  let pool = pools.get(url);
  if (!pool) {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    pools.set(url, pool);
  }
  const bound = pool;
  const query = tagged((text, values) => bound.query(text, values).then((result) => result.rows as SqlRow[]));
  query.transaction = async (queries) => {
    const client = await bound.connect();
    try {
      await client.query("BEGIN");
      const results = await runTransaction(queries, async (text, values) => {
        const result = await client.query(text, values);
        return result.rows as SqlRow[];
      });
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  // Schema setup only. This lock is not the spend limit: Neon HTTP cannot hold
  // pg_advisory_lock across statements, and the limit is animind_spend_reserve.
  query.session = async (fn) => {
    const client = await bound.connect();
    try {
      await client.query("SELECT pg_advisory_lock(814201)");
      const local = tagged(async (text, values) => {
        const result = await client.query(text, values);
        return result.rows as SqlRow[];
      });
      local.transaction = (queries) => runTransaction(queries, async (text, values) => {
        const result = await client.query(text, values);
        return result.rows as SqlRow[];
      });
      local.session = (inner) => inner(local);
      return await fn(local);
    } finally {
      await client.query("SELECT pg_advisory_unlock(814201)").catch(() => undefined);
      client.release();
    }
  };
  return query;
}

export function sqlFor(url: string): SqlQuery {
  if (usesNeonDriver(url)) {
    let cached = neonCache.get(url);
    if (!cached) {
      cached = neon(url);
      neonCache.set(url, cached);
    }
    const inner = cached as unknown as SqlQuery;
    const query = ((strings: TemplateStringsArray, ...values: unknown[]) => inner(strings, ...values)) as SqlQuery;
    query.transaction = (queries) => inner.transaction(queries);
    // One HTTP call is one transaction. An advisory lock taken here would
    // release before the next statement, so session() does not take one.
    query.session = (fn) => fn(query);
    return query;
  }
  return wire(url);
}
