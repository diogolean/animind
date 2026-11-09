import { json } from "@/lib/core";
import { StoreConfigError } from "@/lib/accounts/config";
import { ensurePrivatePacks } from "@/lib/accounts/ensure-packs";
import { isUser, requireUser } from "@/lib/accounts/http";
import { charactersFor } from "@/lib/accounts/store";
import { presentLibraryCharacter } from "@/lib/charge-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  try {
    await ensurePrivatePacks(actor);
    const characters = (await charactersFor(actor)).map(presentLibraryCharacter);
    return json({ characters, viewer: actor });
  } catch (error) {
    if (error instanceof StoreConfigError) return json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
}
