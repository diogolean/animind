import type { LanguageCode } from "@/lib/contract";
import { coreFetch, coreMode, json } from "@/lib/core";
import { fallbackVoiceCatalog, normalizeVoiceCatalog } from "@/lib/voices";

export async function GET(req: Request) {
  const language = (new URL(req.url).searchParams.get("lang") || "en-US") as LanguageCode;
  if (coreMode() === "core") {
    try {
      const response = await coreFetch(`/voices?${new URLSearchParams({ lang: language })}`);
      if (response.ok) return json(normalizeVoiceCatalog(await response.json(), language, "core"));
      if (![404, 405, 501].includes(response.status)) return json({ error: `Erro do núcleo ${response.status}` }, response.status);
    } catch {
      // Keep voice controls working while the optional catalog is unavailable.
    }
  }
  return json(fallbackVoiceCatalog(language));
}
