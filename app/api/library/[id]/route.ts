import { json } from "@/lib/core";
import { isUser, requireUser } from "@/lib/accounts/http";
import { keyFromAssetUrl, readObject } from "@/lib/accounts/object-store";
import { puppetToRig } from "@/lib/accounts/rig";
import { characterFor, deleteCharacterFor, updateCharacterStatus } from "@/lib/accounts/store";
import { isLibraryStatus } from "@/lib/accounts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const { id } = await params;
  const character = await characterFor(actor, id);
  if (!character) return json({ error: "Personagem não encontrado" }, 404);
  const key = keyFromAssetUrl(character.puppetUrl);
  const bytes = key ? await readObject(key) : null;
  let rig = null;
  if (bytes) {
    try {
      rig = puppetToRig(character, JSON.parse(bytes.toString("utf8")) as unknown);
    } catch {
      rig = null;
    }
  }
  return json({ character, rig });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const { id } = await params;
  let body: { status?: unknown };
  try {
    body = (await req.json()) as { status?: unknown };
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  if (!isLibraryStatus(body.status)) return json({ error: "Status inválido" }, 400);
  const character = await updateCharacterStatus(actor, id, body.status);
  if (!character) return json({ error: "Personagem não encontrado" }, 404);
  return json({ character });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const { id } = await params;
  const removed = await deleteCharacterFor(actor, id);
  if (!removed) return json({ error: "Personagem não encontrado" }, 404);
  return json({ ok: true });
}
