import { coreFetch, coreMode, json } from "@/lib/core";
import { normalizeToneCatalog } from "@/lib/tones";

export async function GET() {
  if (coreMode() === "core") {
    try {
      const response = await coreFetch("/tones");
      if (response.ok) return json(normalizeToneCatalog(await response.json(), "core"));
    } catch {
      // Keep the controls available with the documented mappings.
    }
  }
  return json(normalizeToneCatalog());
}
