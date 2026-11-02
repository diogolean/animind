import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { blobAccess, blobConfigError, onVercel, usesBlob } from "./config";
import { dataDir } from "./paths";

/**
 * Object storage for character binaries (puppet.json and PNG layers).
 * Each object is a key under ANIMIND_DATA_DIR/objects and is served by URL.
 * The bytes stay out of git; character records store only the URLs.
 */
const ASSET_PREFIX = "/api/library/assets/";

export function objectsRoot(): string {
  return path.join(dataDir(), "objects");
}

export function isSafeObjectKey(key: string): boolean {
  const parts = key.split("/");
  if (parts.length < 3) return false;
  if (!parts.every((part) => part.length > 0 && part !== "." && part !== "..")) return false;
  const id = parts[1] ?? "";
  if (parts[0] === "characters" && /^chr_[A-Za-z0-9_-]+$/.test(id)) return true;
  return parts[0] === "assets" && /^ast_[A-Za-z0-9_-]+$/.test(id);
}

export function assetUrl(key: string): string {
  return `${ASSET_PREFIX}${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function keyFromAssetUrl(url: string): string | null {
  if (!url.startsWith(ASSET_PREFIX)) return null;
  try {
    const key = url.slice(ASSET_PREFIX.length).split("/").map(decodeURIComponent).join("/");
    return isSafeObjectKey(key) ? key : null;
  } catch {
    return null;
  }
}

function resolveKey(key: string): string | null {
  if (!isSafeObjectKey(key)) return null;
  const root = path.resolve(objectsRoot());
  const dest = path.resolve(root, ...key.split("/"));
  const rel = path.relative(root, dest);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return dest;
}

async function putBlob(key: string, bytes: Buffer): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(key, bytes, {
    access: blobAccess(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: contentTypeFor(key).split(";")[0],
  });
}

async function readBlob(key: string): Promise<Buffer | null> {
  const { get } = await import("@vercel/blob");
  const result = await get(key, { access: blobAccess() });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

async function deleteBlobPrefix(characterId: string): Promise<void> {
  const { del, list } = await import("@vercel/blob");
  const prefix = `characters/${characterId}/`;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    if (page.blobs.length) await del(page.blobs.map((blob) => blob.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

export async function putObject(key: string, bytes: Buffer): Promise<string> {
  if (!isSafeObjectKey(key)) throw new Error("Chave de objeto inválida");
  if (usesBlob()) {
    await putBlob(key, bytes);
    return assetUrl(key);
  }
  if (onVercel()) throw blobConfigError();
  const dest = resolveKey(key);
  if (!dest) throw new Error("Chave de objeto inválida");
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  return assetUrl(key);
}

export async function readObject(key: string): Promise<Buffer | null> {
  if (!isSafeObjectKey(key)) return null;
  if (usesBlob()) return readBlob(key);
  if (onVercel()) throw blobConfigError();
  const dest = resolveKey(key);
  if (!dest) return null;
  try {
    return await readFile(/*turbopackIgnore: true*/ dest);
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  if (!isSafeObjectKey(key)) return;
  if (usesBlob()) {
    const { del, get } = await import("@vercel/blob");
    const found = await get(key, { access: blobAccess() });
    if (found?.blob.url) await del(found.blob.url);
    return;
  }
  if (onVercel()) throw blobConfigError();
  const dest = resolveKey(key);
  if (!dest) return;
  await rm(dest, { force: true });
}

export async function deleteObjectPrefix(characterId: string): Promise<void> {
  if (!/^chr_[A-Za-z0-9_-]+$/.test(characterId)) return;
  if (usesBlob()) {
    await deleteBlobPrefix(characterId);
    return;
  }
  if (onVercel()) throw blobConfigError();
  const root = path.resolve(objectsRoot());
  const dest = path.resolve(root, "characters", characterId);
  const rel = path.relative(root, dest);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return;
  await rm(dest, { recursive: true, force: true });
}

export function contentTypeFor(key: string): string {
  switch (key.split(".").pop()?.toLowerCase()) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "json":
      return "application/json; charset=utf-8";
    case "txt":
    case "md":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
