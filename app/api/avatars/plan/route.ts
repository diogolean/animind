import { isUser, requireUser } from "@/lib/accounts/http";
import { presentPlanUsage } from "@/lib/avatar-core";
import { coreMode, coreUserHeader, json, proxyJson } from "@/lib/core";

/**
 * Local avatar plan usage from the core.
 * The response is the count of attempts and provider calls.
 * A missing price stays unknown. This route does not start an image.
 */
export async function POST(req: Request) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  if (coreMode() !== "core") return json({ error: "Pedido não encontrado" }, 503);
  const body = await req.json().catch(() => null) as { prompt?: unknown; language?: unknown; requestedResolution?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > 1200) return json({ error: "Pedido não encontrado" }, 400);
  const language = typeof body?.language === "string" && body.language.length <= 16 ? body.language : "pt-BR";
  const requestedResolution = body?.requestedResolution === "4k" ? "4k" : "1k";
  const proxied = await proxyJson("/avatars/plan", {
    method: "POST",
    headers: coreUserHeader(actor.id),
    body: JSON.stringify({ prompt, language, requestedResolution }),
  });
  const payload = proxied.ok ? await proxied.json().catch(() => null) : null;
  const presented = presentPlanUsage(proxied.status, payload);
  return json(presented.body, presented.status);
}
