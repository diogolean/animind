import type { ScenarioRequest, ScenarioResolution } from "@/lib/contract";
import { coreFetch, coreMode, json, rewriteFileUrls } from "@/lib/core";
import { placeForPersona, placeForPrompt } from "@/lib/eras";

const fallback = (body: ScenarioRequest): ScenarioResolution => {
  const era = body.characterNames.map(placeForPersona).find(Boolean);
  if (body.mode === "auto" && era) return { scenario: era, source: "era" };
  const scenario = body.mode === "prompt" ? placeForPrompt(body.prompt) : era ?? "studio";
  return {
    scenario,
    source: body.mode === "auto" ? "era" : "fallback",
    ...(body.mode === "prompt" ? { prompt: body.prompt } : {}),
    note:
      body.mode === "prompt"
        ? "O núcleo ainda não gera cenário por prompt; usamos o cenário existente mais próximo."
        : undefined,
  };
};

export async function POST(req: Request) {
  let body: ScenarioRequest;
  try {
    body = (await req.json()) as ScenarioRequest;
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  if (!body || !["auto", "prompt"].includes(body.mode) || !Array.isArray(body.characterNames))
    return json({ error: "Pedido de cenário inválido" }, 400);
  if (body.mode === "prompt" && !body.prompt?.trim()) return json({ error: "Descreva o cenário" }, 400);

  if (coreMode() === "core") {
    try {
      const response = await coreFetch("/scenarios", { method: "POST", body: JSON.stringify(body) });
      if (response.ok) {
        const text = rewriteFileUrls(await response.text());
        return new Response(text, { status: response.status, headers: { "content-type": "application/json" } });
      }
      if (response.status !== 404 && response.status !== 405 && response.status !== 501)
        return json({ error: `Erro do núcleo ${response.status}` }, response.status);
    } catch {
      // A scenery outage must not block the built-in fallback.
    }
  }
  return json(fallback(body));
}
