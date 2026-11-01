import type { RenderRequest } from "@/lib/contract";
import { coreFetch, coreMode, coreOff, json, proxyJson } from "@/lib/core";
import { mockCreateJob } from "@/lib/mock";
import { coreToneId, normalizeToneCatalog } from "@/lib/tones";

const TEMPLATES = ["debate", "lesson", "solo"];
const SCENARIOS = ["studio", "classroom", "arena", "space", "agora"];
const TONES = ["humor", "terror", "educacional", "sabio", "serio"];
const OBJECTIVES = ["ensinar", "debater", "entreter", "convencer"];

export async function POST(req: Request) {
  let body: RenderRequest;
  try {
    body = (await req.json()) as RenderRequest;
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  if (!Array.isArray(body?.characters) || body.characters.length < 1 || body.characters.length > 6)
    return json({ error: "Envie de 1 a 6 personagens" }, 400);
  if (!TEMPLATES.includes(body.template) || !SCENARIOS.includes(body.scenario))
    return json({ error: "Modelo de cena ou cenário inválido" }, 400);
  if (body.tone && !TONES.includes(body.tone)) return json({ error: "Tom inválido" }, 400);
  if (body.objective && !OBJECTIVES.includes(body.objective)) return json({ error: "Objetivo inválido" }, 400);
  const mode = coreMode();
  if (mode === "off") return coreOff();
  if (mode === "core") {
    let catalog = normalizeToneCatalog();
    try {
      const response = await coreFetch("/tones");
      if (response.ok) catalog = normalizeToneCatalog(await response.json(), "core");
    } catch {
      // The documented fallback mapping keeps render available.
    }
    const coreBody = { ...body, requestedTone: body.tone, tone: coreToneId(body.tone, catalog) };
    return proxyJson("/render", { method: "POST", body: JSON.stringify(coreBody) });
  }
  return json(mockCreateJob(body), 202);
}
