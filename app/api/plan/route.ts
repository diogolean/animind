import type { CreationPlan, CreationPlanRequest } from "@/lib/contract";
import { guardedGeneration } from "@/lib/accounts/generation";
import { coreFetch, coreMode, json } from "@/lib/core";
import { inferCreationPlan, inferLanguage } from "@/lib/planner";

export async function POST(req: Request) {
  const paid = await guardedGeneration(req, "plan", () => perform(req));
  if (paid.status === 401 || paid.status === 403 || paid.status === 429 || paid.status === 503) return localPlan(req);
  return paid;
}

async function localPlan(req: Request) {
  let body: CreationPlanRequest;
  try {
    body = (await req.json()) as CreationPlanRequest;
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  const prompt = body?.prompt?.trim();
  if (!prompt) return json({ error: "Descreva sua criação" }, 400);
  if (prompt.length > 1200) return json({ error: "Descrição longa demais" }, 400);
  return json(inferCreationPlan(prompt, body.language ?? body.lang));
}

const validPlan = (value: unknown): value is CreationPlan => {
  const plan = value as Partial<CreationPlan>;
  return !!plan && typeof plan === "object" && typeof plan.topic === "string" && Array.isArray(plan.characters) && plan.characters.length > 0;
};

async function perform(req: Request) {
  let body: CreationPlanRequest;
  try {
    body = (await req.json()) as CreationPlanRequest;
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  const prompt = body?.prompt?.trim();
  if (!prompt) return json({ error: "Descreva sua criação" }, 400);
  if (prompt.length > 1200) return json({ error: "Descrição longa demais" }, 400);

  if (coreMode() === "core") {
    try {
      const language = body.language ?? body.lang;
      const response = await coreFetch("/plan", { method: "POST", body: JSON.stringify({ prompt, language, lang: language }) });
      if (response.ok) {
        const candidate = await response.json();
        if (validPlan(candidate)) {
          return Response.json(
            { ...candidate, prompt, language: candidate.language ?? language ?? inferLanguage(prompt), source: "core" },
            { headers: { "x-animind-provider": "core" } },
          );
        }
      }
      if (![404, 405, 501].includes(response.status)) return json({ error: `Erro do núcleo ${response.status}` }, response.status);
    } catch {
      // Planning must remain available while the optional core planner is offline.
    }
  }
  return Response.json(inferCreationPlan(prompt, body.language ?? body.lang), { headers: { "x-animind-spend": "waive" } });
}
