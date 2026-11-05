import { randomBytes } from "node:crypto";
import path from "node:path";
import { productEnv } from "../product-env";

/** Gitignored directory for accounts, character metadata, and object bytes. */
export function dataDir(): string {
  const configured = productEnv("DATA_DIR")?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), ".data");
}

export function normalizeRel(input: string): string | null {
  const cleaned = input.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!cleaned || cleaned.startsWith("/") || cleaned.includes("\0")) return null;
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) return null;
  if (!parts.every((part) => /^[\p{L}\p{N}._ -]+$/u.test(part))) return null;
  return parts.join("/");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}
