import type { CharacterPreviewRequest } from "@/lib/contract";
import { guardedGeneration } from "@/lib/accounts/generation";
import { coreFetch, coreMode, coreOff, json, rewriteFileUrls } from "@/lib/core";
import { mockCreatePreview } from "@/lib/mock";

export async function POST(req: Request) {
  return guardedGeneration(req, "preview", () => perform(req));
}

const TYPES = ["stick", "illustrated"];

async function perform(req: Request) {
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
    // The live core has no /v1/preview. A local SVG must not stand in for the cut-out.
    try {
      const response = await coreFetch("/preview", { method: "POST", body: JSON.stringify(body) });
      if (response.ok) {
        return new Response(rewriteFileUrls(await response.text()), {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      }
      return json(
        { error: "O núcleo não oferece uma prévia SVG. O personagem aparece quando o recorte fica pronto." },
        [404, 405, 501].includes(response.status) ? 501 : response.status,
      );
    } catch (error) {
      return json({ error: `Núcleo indisponível: ${(error as Error).message}` }, 502);
    }
  }
  return json(mockCreatePreview(body), 201);
}
