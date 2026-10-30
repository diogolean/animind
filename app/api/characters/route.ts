import type { CreateCharacterRequest } from "@/lib/contract";
import { coreFetch, coreUrl, json } from "@/lib/core";
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
  if (s.kind === "upload") {
    if (s.rightsConfirmed !== true) return json({ error: "Confirme que você tem direito de usar esta imagem" }, 422);
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(s.imageDataUrl ?? "")) return json({ error: "Imagem inválida" }, 400);
    if (s.imageDataUrl.length > MAX_UPLOAD * 1.37) return json({ error: "Imagem grande demais (máx. 6 MB)" }, 413);
  }
  if (coreUrl()) {
    const r = await coreFetch("/characters", { method: "POST", body: JSON.stringify(body) });
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  }
  try {
    return json(mockCreateCharacter(body), 201);
  } catch (e) {
    return json({ error: (e as Error).message }, 404);
  }
}
