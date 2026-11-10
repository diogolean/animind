import { isUser, requireUser } from "@/lib/accounts/http";
import { presentDebateCreated, presentDebateResponse } from "@/lib/avatar-core";
import { coreMode, coreUserHeader, json, proxyJson } from "@/lib/core";

/**
 * Fixture debate for the signed-in owner.
 * The writer is fixture and live stays false. Another account receives the same 404 as a missing id.
 */

const LEAK = /@|\\|users\/|api[_-]?key|secret/i;

function personas(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 6) return null;
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const name = item.trim();
    if (!name || name.length > 80 || LEAK.test(name)) return null;
    names.push(name);
  }
  return names;
}

export async function POST(req: Request) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  if (coreMode() !== "core") return json({ error: "Pedido não encontrado" }, 503);
  const body = await req.json().catch(() => null) as { personas?: unknown; theme?: unknown; language?: unknown } | null;
  const names = personas(body?.personas);
  const theme = typeof body?.theme === "string" ? body.theme.trim().slice(0, 200) : "";
  const language = body?.language === "en-US" || body?.language === "pt-BR" || body?.language === "en" || body?.language === "pt" ? body.language : "";
  if (!names || !theme || LEAK.test(theme) || !language) return json({ error: "Pedido não encontrado" }, 400);
  const proxied = await proxyJson("/debates", {
    method: "POST",
    headers: coreUserHeader(actor.id),
    body: JSON.stringify({ personas: names, theme, language, writer: "fixture", live: false }),
  });
  const payload = proxied.ok ? await proxied.json().catch(() => null) : null;
  const presented = presentDebateCreated(proxied.status, payload);
  return json(presented.body, presented.status);
}

export async function GET(req: Request) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  if (coreMode() !== "core") return json({ error: "Pedido não encontrado" }, 404);
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!/^[a-f0-9]{8,32}$/.test(id)) return json({ error: "Pedido não encontrado" }, 404);
  const proxied = await proxyJson(`/debates/${encodeURIComponent(id)}`, {
    headers: coreUserHeader(actor.id),
  });
  const payload = proxied.ok ? await proxied.json().catch(() => null) : null;
  const presented = presentDebateResponse(proxied.status, payload);
  return json(presented.body, presented.status);
}
