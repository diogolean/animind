import { newId } from "@/lib/accounts/paths";
import { isUser, requireUser } from "@/lib/accounts/http";
import { charactersFor } from "@/lib/accounts/store";
import { cancelAvatarAttempt, decideAvatarRequest, fileAvatarStore } from "@/lib/avatar-batch";
import { json } from "@/lib/core";
import type { LanguageCode } from "@/lib/contract";

/**
 * Confirms an avatar attempt for the signed-in owner.
 * It does not call the core and it does not reserve a spend, because no avatar
 * adapter is available and paid calls are not authorized.
 * Download stays on GET /api/files, which already requires the owner.
 */

function strings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, limit);
}

export async function GET(req: Request) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const requestId = new URL(req.url).searchParams.get("requestId")?.trim() ?? "";
  if (!requestId) return json({ error: "Pedido não encontrado" }, 404);
  const found = fileAvatarStore().find(actor.id, requestId);
  if (!found || found.ownerId !== actor.id) return json({ error: "Pedido não encontrado" }, 404);
  return json(found);
}

export async function POST(req: Request) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const body = await req.json().catch(() => null) as { action?: unknown; requestId?: unknown; prompt?: unknown; language?: unknown; addedNames?: unknown; selectedIds?: unknown } | null;
  if (body?.action === "cancel") {
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    const next = cancelAvatarAttempt(fileAvatarStore(), actor.id, requestId);
    if (!next) return json({ error: "Pedido não encontrado" }, 404);
    return json(next);
  }
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const language = typeof body?.language === "string" && body.language.length <= 16 ? body.language as LanguageCode : undefined;
  const library = (await charactersFor(actor)).map((character) => ({
    id: character.id,
    ownerId: character.ownerId,
    name: character.name,
    status: character.status,
    catalog: character.catalog,
  }));
  const decision = decideAvatarRequest({
    ownerId: actor.id,
    generationEnabled: actor.generationEnabled,
    prompt,
    language,
    addedNames: strings(body?.addedNames, 4),
    selectedIds: strings(body?.selectedIds, 4),
    library,
    store: fileAvatarStore(),
    requestId: newId("req"),
  });
  return json(decision.body, decision.status);
}
