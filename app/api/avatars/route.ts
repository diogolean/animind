import { newId } from "@/lib/accounts/paths";
import { isUser, requireUser } from "@/lib/accounts/http";
import { charactersFor } from "@/lib/accounts/store";
import { cancelAvatarAttempt, decideAvatarRequest, fileAvatarStore, memoryAvatarStore } from "@/lib/avatar-batch";
import { avatarMissBody, avatarReconnect, avatarTransport, labelOfflineAttempt, presentCorePayload, promptForCore } from "@/lib/avatar-core";
import { coreMode, coreUserHeader, json, proxyJson } from "@/lib/core";
import { inferAvatarPlan } from "@/lib/avatar-plan";
import type { AvatarAttempt, LanguageCode } from "@/lib/contract";

/**
 * Confirms an avatar for the signed-in owner, then either proxies the core
 * contract or returns a labeled fixture. It does not reserve a spend and it
 * does not call a provider. Download stays on GET /api/files.
 */

function strings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, limit);
}

async function presentProxied(response: Response, ownerId: string): Promise<Response> {
  const payload = await response.json().catch(() => null);
  const presented = presentCorePayload(response.status, payload, ownerId);
  return json(presented.body, presented.status);
}

export async function GET(req: Request) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const requestId = new URL(req.url).searchParams.get("requestId")?.trim() ?? "";
  const spec = avatarReconnect(requestId);
  if (!spec) return json(avatarMissBody(), 404);
  if (avatarTransport(coreMode()) === "core") {
    const proxied = await proxyJson(`/avatars/${encodeURIComponent(requestId)}`, {
      method: "GET",
      headers: coreUserHeader(actor.id),
    });
    return presentProxied(proxied, actor.id);
  }
  const found = fileAvatarStore().find(actor.id, requestId);
  if (!found || found.ownerId !== actor.id) return json(avatarMissBody(), 404);
  return json(labelOfflineAttempt(found));
}

export async function POST(req: Request) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const body = await req.json().catch(() => null) as { action?: unknown; requestId?: unknown; prompt?: unknown; language?: unknown; addedNames?: unknown; selectedIds?: unknown } | null;
  if (body?.action === "cancel") {
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    const next = cancelAvatarAttempt(fileAvatarStore(), actor.id, requestId);
    if (!next) return json(avatarMissBody(), 404);
    return json(labelOfflineAttempt(next));
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
  const core = avatarTransport(coreMode()) === "core";
  const decision = decideAvatarRequest({
    ownerId: actor.id,
    generationEnabled: actor.generationEnabled,
    prompt,
    language,
    addedNames: strings(body?.addedNames, 4),
    selectedIds: strings(body?.selectedIds, 4),
    library,
    store: core ? memoryAvatarStore() : fileAvatarStore(),
    requestId: newId("req"),
  });
  if (!("jobs" in decision.body)) return json(decision.body, decision.status);
  if (core) {
    const names = (decision.body as AvatarAttempt).jobs.map((job) => job.name);
    const plan = inferAvatarPlan(prompt, language);
    const proxied = await proxyJson("/avatars", {
      method: "POST",
      headers: coreUserHeader(actor.id),
      body: JSON.stringify({
        prompt: promptForCore(prompt, names),
        language: language ?? plan.language,
        requestedResolution: plan.requestedResolution,
      }),
    });
    return presentProxied(proxied, actor.id);
  }
  const saved = decision.body as AvatarAttempt;
  return json(labelOfflineAttempt(saved), decision.status);
}
