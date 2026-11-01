import type { CreationPlan, CreationPlanRequest } from "@/lib/contract";
import { coreFetch, coreMode, json } from "@/lib/core";
import { inferCreationPlan, inferLanguage } from "@/lib/planner";

const validPlan = (value: unknown): value is CreationPlan => {
  const plan = value as Partial<CreationPlan>;
  return !!plan && typeof plan === "object" && typeof plan.topic === "string" && Array.isArray(plan.characters) && plan.characters.length > 0;
};

export async function POST(req: Request) {
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
        if (validPlan(candidate)) return json({ ...candidate, prompt, language: candidate.language ?? language ?? inferLanguage(prompt), source: "core" });
      }
      if (![404, 405, 501].includes(response.status)) return json({ error: `Erro do núcleo ${response.status}` }, response.status);
    } catch {
      // Planning must remain available while the optional core planner is offline.
    }
  }
  return json(inferCreationPlan(prompt, body.language ?? body.lang));
}
