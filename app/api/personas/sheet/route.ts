import { guardedGeneration } from "@/lib/accounts/generation";
import { coreMode, json, proxyJson } from "@/lib/core";
import { cachedFixturePersona } from "@/lib/persona-cache";

/**
 * Quote sheet for a free-typed name.
 * Core mode proxies the priced core contract. Any other mode serves the labeled Wikiquote fixture,
 * from the file cache, with no provider call and no reservation.
 */
export async function GET(req: Request) {
  if (coreMode() !== "core") return fixtureResponse(req);
  return guardedGeneration(req, "persona_sheet", () => readCoreSheet(req));
}

async function fixtureResponse(req: Request) {
  const name = new URL(req.url).searchParams.get("name")?.trim() ?? "";
  if (!name || name.length > 80) return json({ error: "Informe o nome" }, 400);
  return json(await cachedFixturePersona(name));
}

async function readCoreSheet(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name")?.trim() ?? "";
  const lang = url.searchParams.get("lang") || "pt-BR";
  if (!name) return json({ error: "Informe o nome" }, 400);
  return proxyJson(`/personas/sheet?${new URLSearchParams({ name, lang })}`);
}
