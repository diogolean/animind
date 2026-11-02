import { json } from "@/lib/core";
import { isUser, requireUser } from "@/lib/accounts/http";
import { charactersFor } from "@/lib/accounts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  return json({ characters: await charactersFor(actor), viewer: actor });
}
