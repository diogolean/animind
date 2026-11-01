import type { CreateCharacterRequest } from "@/lib/contract";
import { coreMode, coreOff, json, proxyJson } from "@/lib/core";
import { mockCreateCharacter } from "@/lib/mock";

const MAX_UPLOAD = 6 * 1024 * 1024;

export async function POST(req: Request) {
  let body: CreateCharacterRequest;
  try {
    body = (await req.json()) as CreateCharacterRequest;
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  const s = body?.source;
  if (!s || !["prompt", "catalog", "upload"].includes(s.kind)) return json({ error: "source inválido" }, 400);
  if (s.kind === "prompt" && !s.prompt?.trim()) return json({ error: "Descreva o personagem" }, 400);
  if (s.kind === "prompt" && !body.name?.trim()) return json({ error: "Dê um nome ao personagem" }, 400);
  if (s.kind === "prompt" && (s.prompt.length > 600 || body.name!.length > 60)) return json({ error: "Nome ou descrição longa demais" }, 400);
  if (body.characterType && !["stick", "illustrated"].includes(body.characterType))
    return json({ error: "Tipo de personagem inválido" }, 400);
  if (s.kind === "upload") {
    if (s.rightsConfirmed !== true) return json({ error: "Confirme que você tem direito de usar esta imagem" }, 422);
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(s.imageDataUrl ?? "")) return json({ error: "Imagem inválida" }, 400);
    if (s.imageDataUrl.length > MAX_UPLOAD * 1.37) return json({ error: "Imagem grande demais (máx. 6 MB)" }, 413);
  }
  const mode = coreMode();
  if (mode === "off") return coreOff();
  // Prompt characters are cut by the core. Catalog/upload are photo rigs the app builds itself.
  if (mode === "core" && s.kind === "prompt") return proxyJson("/characters", { method: "POST", body: JSON.stringify(body) });
  try {
    return json(mockCreateCharacter(body), 201);
  } catch (e) {
    return json({ error: (e as Error).message }, 404);
  }
}
