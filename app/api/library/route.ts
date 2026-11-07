import { json } from "@/lib/core";
import { StoreConfigError } from "@/lib/accounts/config";
import { ensurePrivatePacks } from "@/lib/accounts/ensure-packs";
import { isUser, requireUser } from "@/lib/accounts/http";
import { charactersFor } from "@/lib/accounts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  try {
    await ensurePrivatePacks(actor);
    return json({ characters: await charactersFor(actor), viewer: actor });
  } catch (error) {
    if (error instanceof StoreConfigError) return json({ error: error.message }, error.status);
    throw error;
  }
}
