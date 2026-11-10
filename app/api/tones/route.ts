import { json } from "@/lib/core";
import { normalizeToneCatalog } from "@/lib/tones";

/** Local catalog only. A tone list is not a generation and is not billed. */
export async function GET() {
  return json(normalizeToneCatalog());
}
