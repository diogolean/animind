import { isUser, requireUser } from "@/lib/accounts/http";
import { presentCoreSheet } from "@/lib/avatar-core";
import { coreMode, coreUserHeader, json, proxyJson } from "@/lib/core";
import { cachedFixturePersona } from "@/lib/persona-cache";

/**
 * Quote sheet for a free-typed name.
 * Core mode reads the owner's labeled fixture. That core route does not spend,
 * so this read does not reserve. Any other mode serves the bundled fixture.
 */
export async function GET(req: Request) {
  if (coreMode() !== "core") return fixtureResponse(req);
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const url = new URL(req.url);
  const name = url.searchParams.get("name")?.trim() ?? "";
  const lang = (url.searchParams.get("lang") || "pt-BR").slice(0, 16);
  if (!name || name.length > 80) return json({ error: "Informe o nome" }, 400);
  const proxied = await proxyJson(`/personas/sheet?${new URLSearchParams({ name, lang })}`, {
    headers: coreUserHeader(actor.id),
  });
  const payload = await proxied.json().catch(() => null);
  if (!proxied.ok) return json({ error: "Pedido não encontrado" }, proxied.status === 404 ? 404 : 502);
  const sheet = presentCoreSheet(payload);
  if (!sheet) return json({ error: "Pedido não encontrado" }, 502);
  return json(sheet);
}

async function fixtureResponse(req: Request) {
  const name = new URL(req.url).searchParams.get("name")?.trim() ?? "";
  if (!name || name.length > 80) return json({ error: "Informe o nome" }, 400);
  return json(await cachedFixturePersona(name));
}
