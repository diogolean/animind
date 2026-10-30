import { coreMode, coreOff, json, proxyJson } from "@/lib/core";

/** Deep persona knowledge (background RAG build in the core). Mock answers "ready" at once. */
const mock = (name: string, lang: string) =>
  json({ name, lang, status: "ready", mode: "deep", chunks: 120, counts: { quote: 12, wikipedia: 60, wikiquote: 20, wikisource: 28 } });

export async function GET(req: Request) {
  const u = new URL(req.url);
  const name = u.searchParams.get("name")?.trim() ?? "";
  const lang = u.searchParams.get("lang") || "pt-BR";
  if (!name) return json({ error: "Informe o nome" }, 400);
  const mode = coreMode();
  if (mode === "off") return coreOff();
  if (mode === "mock") return mock(name, lang);
  return proxyJson(`/personas/deep?${new URLSearchParams({ name, lang })}`);
}

export async function POST(req: Request) {
  let body: { name?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  const name = body?.name?.trim() ?? "";
  if (!name) return json({ error: "Informe o nome" }, 400);
  const mode = coreMode();
  if (mode === "off") return coreOff();
  if (mode === "mock") return mock(name, body.lang || "pt-BR");
  return proxyJson("/personas/deep", { method: "POST", body: JSON.stringify({ name, lang: body.lang || "pt-BR" }) });
}
