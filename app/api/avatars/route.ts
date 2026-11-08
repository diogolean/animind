import { beginGeneration } from "@/lib/accounts/generation";
import { generationSwitch, realAvatarCall } from "@/lib/accounts/generation-policy";
import { newId } from "@/lib/accounts/paths";
import { isUser, requireUser } from "@/lib/accounts/http";
import { charactersFor } from "@/lib/accounts/store";
import { cancelAvatarAttempt, decideAvatarRequest, fileAvatarStore } from "@/lib/avatar-batch";
import { avatarMissBody, avatarReconnect, avatarTransport, labelOfflineAttempt, presentCorePayload, promptForCore } from "@/lib/avatar-core";
import { coreMode, coreUserHeader, json, proxyJson } from "@/lib/core";
import { inferAvatarPlan } from "@/lib/avatar-plan";
import { providerForMode, quoteCall, readSpendLimits } from "@/lib/spend/policy";
import type { AvatarAttempt, LanguageCode } from "@/lib/contract";

/**
 * Confirms an avatar for the signed-in owner. A real proxy to the existing
 * core contract is only for admin or super_admin, and only after the generation
 * switch, a published price, and a ledger reservation. Everyone else, and every
 * core-off request, stays on the labeled fixture. The factory functions stay
 * on the core process.
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
  if (actor.role !== "admin" && actor.role !== "super_admin") {
    return json({ error: "Esta conta ainda não pode gerar", code: "unapproved" }, 403);
  }
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const language = typeof body?.language === "string" && body.language.length <= 16 ? body.language as LanguageCode : undefined;
  const mode = coreMode();
  const switched = generationSwitch();
  const limits = readSpendLimits();
  if (mode === "core" && switched.state === "on" && !limits.ok) {
    return json({ error: "Geração indisponível", code: "unavailable" }, 503);
  }
  const named = providerForMode(mode);
  const price = limits.ok ? quoteCall(limits.limits, "avatar", named.provider, named.model) : null;
  const gate = realAvatarCall({
    role: actor.role,
    mode,
    generationOn: switched.state === "on",
    priceMinor: price ? price.minor : null,
  });
  if (gate.allow) {
    const ticket = await beginGeneration(req, "avatar");
    if (ticket instanceof Response) return ticket;
    try {
      const plan = inferAvatarPlan(prompt, language);
      const names = plan.participants.filter((item) => plan.selectedIds.includes(item.id)).map((item) => item.name);
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
    } finally {
      ticket.release();
    }
  }
  if (gate.code !== "core_off") {
    const error = gate.code === "disabled" ? "Geração desligada" : "Preço desta chamada não está publicado";
    return json({ error, code: gate.code }, 403);
  }
  const library = (await charactersFor(actor)).map((character) => ({
    id: character.id,
    ownerId: character.ownerId,
    name: character.name,
    status: character.status,
    catalog: character.catalog,
  }));
  const decision = decideAvatarRequest({
    ownerId: actor.id,
    generationEnabled: true,
    prompt,
    language,
    addedNames: strings(body?.addedNames, 4),
    selectedIds: strings(body?.selectedIds, 4),
    library,
    store: fileAvatarStore(),
    requestId: newId("req"),
  });
  if (!("jobs" in decision.body)) return json(decision.body, decision.status);
  const saved = decision.body as AvatarAttempt;
  return json(labelOfflineAttempt(saved), decision.status);
}
