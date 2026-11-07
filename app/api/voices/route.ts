import type { LanguageCode } from "@/lib/contract";
import { json } from "@/lib/core";
import { fallbackVoiceCatalog } from "@/lib/voices";

/** Local catalog only. A voice list is not a generation and is not billed. */
export async function GET(req: Request) {
  const language = (new URL(req.url).searchParams.get("lang") || "en-US") as LanguageCode;
  return json(fallbackVoiceCatalog(language));
}
