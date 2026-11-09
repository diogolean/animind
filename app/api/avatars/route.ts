import { generationSwitch, realAvatarCall } from "@/lib/accounts/generation-policy";
import { newId } from "@/lib/accounts/paths";
import { isUser, requireUser } from "@/lib/accounts/http";
import { charactersFor } from "@/lib/accounts/store";
import { cancelAvatarAttempt, decideAvatarRequest, fileAvatarStore } from "@/lib/avatar-batch";
import { avatarMissBody, avatarReconnect, avatarTransport, labelOfflineAttempt, presentCorePayload, promptForCore } from "@/lib/avatar-core";
import { avatarAttemptKey, inferAvatarPlan } from "@/lib/avatar-plan";
import { coreMode, coreUserHeader, json, proxyJson } from "@/lib/core";
import { productEnv } from "@/lib/product-env";
import { providerForMode, quoteCall, readSpendLimits } from "@/lib/spend/policy";
import type { AvatarAttempt, LanguageCode } from "@/lib/contract";

/**
 * Confirms an avatar for the signed-in owner. A real proxy is only for admin
 * or super_admin, and only after the generation switch and a published price.
 * Core mode does not reserve a local spend row: the core ledger is the only
 * charge. A retry of the same request returns the stored attempt. Everyone
 * else, and every core-off request, stays on the labeled fixture.
 */

function strings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, limit);
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
    const payload = await proxied.json().catch(() => null);
    const presented = presentCorePayload(proxied.status, payload, actor.id);
    if (presented.status === 200 && "requestId" in presented.body && presented.body.ownerId === actor.id) {
      const store = fileAvatarStore();
      if (store.find(actor.id, presented.body.requestId)) store.update(actor.id, presented.body.requestId, presented.body);
      return json(presented.body);
    }
    const local = fileAvatarStore().find(actor.id, requestId);
    if (local && local.ownerId === actor.id) return json(local);
    return json(presented.body, presented.status);
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
    const plan = inferAvatarPlan(prompt, language);
    const names = plan.participants.filter((item) => plan.selectedIds.includes(item.id)).map((item) => item.name);
    const store = fileAvatarStore();
    const key = `core:${avatarAttemptKey(`${plan.prompt}\n${plan.language}\n${plan.requestedResolution}`, names)}`;
    const existing = store.read(actor.id, key);
    if (existing?.transport === "core" && existing.ownerId === actor.id) return json(existing);
    const headers: Record<string, string> = { ...coreUserHeader(actor.id) };
    const adminToken = productEnv("ADMIN_TOKEN");
    if (adminToken) headers["x-animind-admin"] = adminToken;
    const proxied = await proxyJson("/avatars", {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: promptForCore(prompt, names),
        name: (names[0] ?? "person").slice(0, 40),
        language: language ?? plan.language,
        requestedResolution: plan.requestedResolution,
        generate: true,
      }),
    });
    const payload = await proxied.json().catch(() => null);
    const presented = presentCorePayload(proxied.status, payload, actor.id);
    if (presented.status === 200 && "requestId" in presented.body && presented.body.ownerId === actor.id) {
      return json(store.save(actor.id, key, presented.body));
    }
    return json(presented.body, presented.status);
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
