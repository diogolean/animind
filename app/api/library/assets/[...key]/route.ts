import { json } from "@/lib/core";
import { isUser, requireUser } from "@/lib/accounts/http";
import { contentTypeFor, isSafeObjectKey, readObject } from "@/lib/accounts/object-store";
import { characterFor } from "@/lib/accounts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const { key: parts } = await params;
  if (parts.some((part) => part === ".." || part.includes("\\") || part.includes("/"))) return json({ error: "Caminho inválido" }, 400);
  const key = parts.map(decodeURIComponent).join("/");
  if (!isSafeObjectKey(key)) return json({ error: "Arquivo não encontrado" }, 404);
  const character = await characterFor(actor, parts[1] ?? "");
  if (!character) return json({ error: "Arquivo não encontrado" }, 404);
  const bytes = await readObject(key);
  if (!bytes) return json({ error: "Arquivo não encontrado" }, 404);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": contentTypeFor(key),
      "content-length": String(bytes.length),
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}
