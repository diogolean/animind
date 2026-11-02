import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
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
  if (parts.length < 3 || parts[0] !== "characters") return false;
  if (!/^chr_[A-Za-z0-9_-]+$/.test(parts[1] ?? "")) return false;
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
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

export async function putObject(key: string, bytes: Buffer): Promise<string> {
  const dest = resolveKey(key);
  if (!dest) throw new Error("Chave de objeto inválida");
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  return assetUrl(key);
}

export async function readObject(key: string): Promise<Buffer | null> {
  const dest = resolveKey(key);
  if (!dest) return null;
  try {
    return await readFile(dest);
  } catch {
    return null;
  }
}

export async function deleteObjectPrefix(characterId: string): Promise<void> {
  if (!/^chr_[A-Za-z0-9_-]+$/.test(characterId)) return;
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
