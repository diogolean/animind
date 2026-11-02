import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { databaseUrl } from "./config";
import type { AccountRecords } from "./records";
import type { AssetKind, LibraryAsset, LibraryCharacter, LibraryStatus, LibraryViewName, Role, UserRecord } from "./types";

type Sql = NeonQueryFunction<false, false>;

let cached: { url: string; sql: Sql } | null = null;
let schema: Promise<void> | null = null;

function sql(): Sql {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL ausente");
  if (!cached || cached.url !== url) cached = { url, sql: neon(url) };
  return cached.sql;
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

async function ready(): Promise<Sql> {
  const db = sql();
  schema ??= (async () => {
    await db`CREATE TABLE IF NOT EXISTS animind_users (
      id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      role text NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL
    )`;
    await db`CREATE TABLE IF NOT EXISTS animind_characters (
      id text PRIMARY KEY,
      owner_id text NOT NULL REFERENCES animind_users (id),
      name text NOT NULL,
      persona_sheet_ref text,
      views jsonb NOT NULL,
      puppet_url text NOT NULL,
      layers jsonb NOT NULL,
      emotion_sheet_url text,
      status text NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )`;
    await db`CREATE TABLE IF NOT EXISTS animind_assets (
      id text PRIMARY KEY,
      owner_id text NOT NULL REFERENCES animind_users (id),
      kind text NOT NULL,
      name text NOT NULL,
      url text,
      text_preview text,
      mime text,
      character_id text,
      project_id text,
      created_at timestamptz NOT NULL
    )`;
  })().catch((error: unknown) => {
    schema = null;
    throw error;
  });
  await schema;
  return db;
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) return new Date(value).toISOString();
  throw new Error("Data de conta inválida");
}

function asJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function userFrom(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: String(row.role) as Role,
    passwordHash: String(row.password_hash),
    createdAt: asIso(row.created_at),
  };
}

function assetFrom(row: Record<string, unknown>): LibraryAsset {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    kind: String(row.kind) as AssetKind,
    name: String(row.name),
    url: row.url == null ? null : String(row.url),
    text: row.text_preview == null ? null : String(row.text_preview),
    mime: row.mime == null ? null : String(row.mime),
    characterId: row.character_id == null ? null : String(row.character_id),
    projectId: row.project_id == null ? null : String(row.project_id),
    createdAt: asIso(row.created_at),
  };
}

function characterFrom(row: Record<string, unknown>): LibraryCharacter {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: String(row.name),
    personaSheetRef: row.persona_sheet_ref == null ? null : String(row.persona_sheet_ref),
    views: asJson<Partial<Record<LibraryViewName, string>>>(row.views),
    puppetUrl: String(row.puppet_url),
    layers: asJson<LibraryCharacter["layers"]>(row.layers),
    emotionSheetUrl: row.emotion_sheet_url == null ? null : String(row.emotion_sheet_url),
    status: String(row.status) as LibraryStatus,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

/** Neon / Vercel Postgres. Selected when DATABASE_URL or POSTGRES_URL is set. */
export function postgresRecords(): AccountRecords {
  return {
    async users() {
      const db = await ready();
      const rows = await db`SELECT id, email, name, role, password_hash, created_at FROM animind_users ORDER BY created_at`;
      return rows.map((row) => userFrom(row));
    },
    async userById(id) {
      const db = await ready();
      const rows = await db`SELECT id, email, name, role, password_hash, created_at FROM animind_users WHERE id = ${id} LIMIT 1`;
      return rows[0] ? userFrom(rows[0]) : null;
    },
    async userByEmail(email) {
      const db = await ready();
      const rows = await db`SELECT id, email, name, role, password_hash, created_at FROM animind_users WHERE email = ${email} LIMIT 1`;
      return rows[0] ? userFrom(rows[0]) : null;
    },
    async insertUser(user) {
      const db = await ready();
      try {
        await db`INSERT INTO animind_users (id, email, name, role, password_hash, created_at)
          VALUES (${user.id}, ${user.email}, ${user.name}, ${user.role}, ${user.passwordHash}, ${user.createdAt})`;
        return true;
      } catch (error) {
        if (isUnique(error)) return false;
        throw error;
      }
    },
    async updateUser(user) {
      const db = await ready();
      const rows = await db`UPDATE animind_users
        SET email = ${user.email}, name = ${user.name}, role = ${user.role}, password_hash = ${user.passwordHash}
        WHERE id = ${user.id} RETURNING id`;
      if (!rows.length) throw new Error("Usuário não encontrado");
    },
    async characters() {
      const db = await ready();
      const rows = await db`SELECT id, owner_id, name, persona_sheet_ref, views, puppet_url, layers, emotion_sheet_url, status, created_at, updated_at
        FROM animind_characters ORDER BY created_at`;
      return rows.map((row) => characterFrom(row));
    },
    async insertCharacter(character) {
      const db = await ready();
      await db`INSERT INTO animind_characters (
          id, owner_id, name, persona_sheet_ref, views, puppet_url, layers, emotion_sheet_url, status, created_at, updated_at
        ) VALUES (
          ${character.id}, ${character.ownerId}, ${character.name}, ${character.personaSheetRef},
          ${JSON.stringify(character.views)}::jsonb, ${character.puppetUrl}, ${JSON.stringify(character.layers)}::jsonb,
          ${character.emotionSheetUrl}, ${character.status}, ${character.createdAt}, ${character.updatedAt}
        )`;
    },
    async replaceCharacter(character) {
      const db = await ready();
      const rows = await db`UPDATE animind_characters SET
          owner_id = ${character.ownerId},
          name = ${character.name},
          persona_sheet_ref = ${character.personaSheetRef},
          views = ${JSON.stringify(character.views)}::jsonb,
          puppet_url = ${character.puppetUrl},
          layers = ${JSON.stringify(character.layers)}::jsonb,
          emotion_sheet_url = ${character.emotionSheetUrl},
          status = ${character.status},
          updated_at = ${character.updatedAt}
        WHERE id = ${character.id}
        RETURNING id, owner_id, name, persona_sheet_ref, views, puppet_url, layers, emotion_sheet_url, status, created_at, updated_at`;
      return rows[0] ? characterFrom(rows[0]) : null;
    },
    async deleteCharacter(id) {
      const db = await ready();
      const rows = await db`DELETE FROM animind_characters WHERE id = ${id} RETURNING id`;
      return rows.length > 0;
    },
    async assets() {
      const db = await ready();
      const rows = await db`SELECT id, owner_id, kind, name, url, text_preview, mime, character_id, project_id, created_at
        FROM animind_assets ORDER BY created_at DESC`;
      return rows.map((row) => assetFrom(row));
    },
    async insertAsset(asset) {
      const db = await ready();
      await db`INSERT INTO animind_assets (
          id, owner_id, kind, name, url, text_preview, mime, character_id, project_id, created_at
        ) VALUES (
          ${asset.id}, ${asset.ownerId}, ${asset.kind}, ${asset.name}, ${asset.url}, ${asset.text}, ${asset.mime},
          ${asset.characterId}, ${asset.projectId}, ${asset.createdAt}
        )`;
    },
    async deleteAssetsForCharacter(characterId) {
      const db = await ready();
      const rows = await db`DELETE FROM animind_assets WHERE character_id = ${characterId}
        RETURNING id, owner_id, kind, name, url, text_preview, mime, character_id, project_id, created_at`;
      return rows.map((row) => assetFrom(row));
    },
  };
}
