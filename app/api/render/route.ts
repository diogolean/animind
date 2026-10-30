import type { RenderRequest } from "@/lib/contract";
import { coreFetch, coreUrl, json } from "@/lib/core";
import { mockCreateJob } from "@/lib/mock";

const TEMPLATES = ["debate", "lesson", "solo"];
const SCENARIOS = ["studio", "classroom", "arena", "space"];

export async function POST(req: Request) {
  let body: RenderRequest;
  try {
    body = (await req.json()) as RenderRequest;
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  if (!Array.isArray(body?.characters) || body.characters.length < 1 || body.characters.length > 2)
    return json({ error: "Envie 1 ou 2 personagens" }, 400);
  if (!TEMPLATES.includes(body.template) || !SCENARIOS.includes(body.scenario))
    return json({ error: "Modelo de cena ou cenário inválido" }, 400);
  if (coreUrl()) {
    const r = await coreFetch("/render", { method: "POST", body: JSON.stringify(body) });
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  }
  return json(mockCreateJob(body), 202);
}
