import { json } from "@/lib/core";
import { StoreConfigError } from "@/lib/accounts/config";
import { isUser, requireUser } from "@/lib/accounts/http";
import { assetsFor, saveAsset } from "@/lib/accounts/store";
import { isAssetKind, type AssetKind } from "@/lib/accounts/types";
import type { CaptureItem } from "@/lib/library-capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanItem(value: unknown): CaptureItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!isAssetKind(item.kind)) return null;
  const name = typeof item.name === "string" ? item.name.trim().slice(0, 120) : "";
  if (!name) return null;
  const text = typeof item.text === "string" ? item.text.trim().slice(0, 20_000) : undefined;
  const url = typeof item.url === "string" ? item.url.trim().slice(0, 2000) : undefined;
  if (url && !url.startsWith("/") && !url.startsWith("https://") && !url.startsWith("http://")) return null;
  return {
    kind: item.kind,
    name,
    ...(text ? { text } : {}),
    ...(url ? { url } : {}),
    ...(typeof item.mime === "string" ? { mime: item.mime.slice(0, 80) } : {}),
    ...(typeof item.characterId === "string" ? { characterId: item.characterId.slice(0, 80) } : {}),
    ...(typeof item.projectId === "string" ? { projectId: item.projectId.slice(0, 120) } : {}),
  };
}

export async function GET(req: Request) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind && !isAssetKind(kind)) return json({ error: "Tipo inválido", code: "invalid_kind" }, 400);
  try {
    return json({ assets: await assetsFor(actor, kind ? (kind as AssetKind) : undefined), viewer: actor });
  } catch (error) {
    if (error instanceof StoreConfigError) return json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
}

export async function POST(req: Request) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  let body: { items?: unknown };
  try {
    body = (await req.json()) as { items?: unknown };
  } catch {
    return json({ error: "JSON inválido", code: "invalid_json" }, 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 12) {
    return json({ error: "Envie de 1 a 12 arquivos", code: "invalid_json" }, 400);
  }
  const items = body.items.map(cleanItem);
  if (items.some((item) => !item)) return json({ error: "Arquivo inválido", code: "invalid_json" }, 400);
  try {
    const assets = [];
    for (const item of items) {
      if (!item) continue;
      assets.push(await saveAsset(actor.id, item));
    }
    return json({ assets }, 201);
  } catch (error) {
    if (error instanceof StoreConfigError) return json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
}
