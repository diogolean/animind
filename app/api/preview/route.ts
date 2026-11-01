import type { CharacterPreviewRequest } from "@/lib/contract";
import { coreFetch, coreMode, coreOff, json, rewriteFileUrls } from "@/lib/core";
import { mockCreatePreview } from "@/lib/mock";

const TYPES = ["stick", "illustrated"];

export async function POST(req: Request) {
  let body: CharacterPreviewRequest;
  try {
    body = (await req.json()) as CharacterPreviewRequest;
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  if (!body?.character?.name?.trim() || !body.character.prompt?.trim())
    return json({ error: "Personagem inválido" }, 400);
  if (!TYPES.includes(body.characterType) || !Number.isInteger(body.index) || body.index < 0)
    return json({ error: "Configuração de preview inválida" }, 400);

  const mode = coreMode();
  if (mode === "off") return coreOff();
  if (mode === "core") {
    try {
      const response = await coreFetch("/preview", { method: "POST", body: JSON.stringify(body) });
      if (response.ok) {
        return new Response(rewriteFileUrls(await response.text()), {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      }
      if (![404, 405, 501].includes(response.status))
        return json({ error: `Erro do núcleo ${response.status}` }, response.status);
    } catch {
      // The optimistic local stick remains visible if the optional endpoint is unavailable.
    }
  }
  return json(mockCreatePreview(body), 201);
}
