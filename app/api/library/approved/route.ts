import { json } from "@/lib/core";
import { isUser, requireUser } from "@/lib/accounts/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * There is no public character catalog.
 * Private packs stay in the owner's library. A future explicit demo opt-in can
 * use another flag; this route must not promote anyone's characters.
 */
export async function GET() {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  return json({ characters: [] });
}
