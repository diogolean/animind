import type { LanguageCode } from "@/lib/contract";
import { guardedGeneration } from "@/lib/accounts/generation";
import { coreFetch, coreMode, json } from "@/lib/core";
import { fallbackVoiceCatalog, normalizeVoiceCatalog } from "@/lib/voices";

export async function GET(req: Request) {
  const language = (new URL(req.url).searchParams.get("lang") || "en-US") as LanguageCode;
  const paid = await guardedGeneration(req, "voice", async () => {
    if (coreMode() !== "core") return json({ error: "sem núcleo" }, 409);
    const response = await coreFetch(`/voices?${new URLSearchParams({ lang: language })}`);
    if (response.ok) return json(normalizeVoiceCatalog(await response.json(), language, "core"));
    return json({ error: `Erro do núcleo ${response.status}` }, response.status);
  });
  if (paid.status < 200 || paid.status >= 300) return json(fallbackVoiceCatalog(language));
  return paid;
}
