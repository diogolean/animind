import { json } from "@/lib/core";
import { StoreConfigError } from "@/lib/accounts/config";
import { isUser, requireUser } from "@/lib/accounts/http";
import { keyFromAssetUrl, readObject } from "@/lib/accounts/object-store";
import { puppetToRig } from "@/lib/accounts/rig";
import { characterFor, deleteCharacterFor, updateCharacterStatus } from "@/lib/accounts/store";
import { isLibraryStatus } from "@/lib/accounts/types";
import { approvedEinsteinRig, approvedLibraryCharacter, isApprovedCharacterId } from "@/lib/approved/einstein";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (isApprovedCharacterId(id)) return json({ character: approvedLibraryCharacter(), rig: approvedEinsteinRig() });
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const character = await characterFor(actor, id);
  if (!character) return json({ error: "Personagem não encontrado" }, 404);
  const key = keyFromAssetUrl(character.puppetUrl);
  let bytes: Buffer | null = null;
  try {
    bytes = key ? await readObject(key) : null;
  } catch (error) {
    if (!(error instanceof StoreConfigError)) throw error;
    return json({ error: error.message }, error.status);
  }
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
  const { id } = await params;
  if (isApprovedCharacterId(id)) return json({ error: "Este personagem do catálogo não pode ser alterado." }, 403);
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
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
  const { id } = await params;
  if (isApprovedCharacterId(id)) return json({ error: "Este personagem do catálogo não pode ser apagado." }, 403);
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const removed = await deleteCharacterFor(actor, id);
  if (!removed) return json({ error: "Personagem não encontrado" }, 404);
  return json({ ok: true });
}
