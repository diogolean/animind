import { productEnv } from "../product-env";

/** Hosted account and asset configuration. Values stay in the environment, never in git. */

export class StoreConfigError extends Error {
  status = 503;
}

/** Pooled Neon / Vercel Postgres URL. `POSTGRES_URL` is the legacy Vercel Postgres name. */
export function databaseUrl(): string | null {
  const value = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || "";
  return value || null;
}

/** True when a Blob store is connected (OIDC on Vercel, or a read-write token for scripts). */
export function usesBlob(): boolean {
  return Boolean(process.env.BLOB_STORE_ID?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/** The Blob store is created as Public unless this is set to `private`. */
export function blobAccess(): "public" | "private" {
  return productEnv("BLOB_ACCESS") === "private" ? "private" : "public";
}

export function onVercel(): boolean {
  return process.env.VERCEL === "1";
}

export function accountsConfigError(): StoreConfigError {
  return new StoreConfigError(
    "Neste deploy da Vercel a biblioteca não usa disco. Conecte a integração Neon e deixe DATABASE_URL no ambiente Preview.",
  );
}

export function blobConfigError(): StoreConfigError {
  return new StoreConfigError(
    "Neste deploy da Vercel os arquivos do personagem não usam disco. Conecte a integração Vercel Blob (BLOB_STORE_ID na preview; BLOB_READ_WRITE_TOKEN para os scripts).",
  );
}
