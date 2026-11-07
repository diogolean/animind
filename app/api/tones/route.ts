import { guardedGeneration } from "@/lib/accounts/generation";
import { coreFetch, coreMode, json } from "@/lib/core";
import { normalizeToneCatalog } from "@/lib/tones";

export async function GET(req: Request) {
  const paid = await guardedGeneration(req, "tone", async () => {
    if (coreMode() !== "core") return json({ error: "sem núcleo" }, 409);
    const response = await coreFetch("/tones");
    if (response.ok) return json(normalizeToneCatalog(await response.json(), "core"));
    return json({ error: `Erro do núcleo ${response.status}` }, response.status);
  });
  if (paid.status < 200 || paid.status >= 300) return json(normalizeToneCatalog());
  return paid;
}
