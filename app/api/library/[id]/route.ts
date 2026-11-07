import { json } from "@/lib/core";
import { StoreConfigError } from "@/lib/accounts/config";
import { isUser, requireUser } from "@/lib/accounts/http";
import { keyFromAssetUrl, readObject } from "@/lib/accounts/object-store";
import { puppetToRig } from "@/lib/accounts/rig";
import { assetsFor, characterFor, deleteCharacterFor, updateCharacterStatus } from "@/lib/accounts/store";
import { isLibraryStatus, type LibraryAsset, type LibraryCharacter, type LibraryDemo } from "@/lib/accounts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownedDemos(character: LibraryCharacter, assets: LibraryAsset[]): LibraryDemo[] {
  const demos = [...(character.demos ?? [])];
  const seen = new Set(demos.map((demo) => demo.url).filter((url): url is string => Boolean(url)));
  for (const asset of assets) {
    if (asset.characterId !== character.id || !asset.url || seen.has(asset.url)) continue;
    if (asset.kind !== "video" && asset.kind !== "audio" && asset.kind !== "script" && asset.kind !== "image") continue;
    if (asset.url === character.emotionSheetUrl) continue;
    if (Object.values(character.views).includes(asset.url)) continue;
    seen.add(asset.url);
    demos.push({
      id: asset.id,
      label: asset.name,
      kind: asset.kind,
      url: asset.url,
      ...(asset.text ? { text: asset.text } : {}),
    });
  }
  return demos;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const character = await characterFor(actor, id);
  if (!character) return json({ error: "Personagem não encontrado" }, 404);
  const demos = ownedDemos(character, await assetsFor(actor));
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
  return json({ character: { ...character, ...(demos.length ? { demos } : {}) }, rig });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const removed = await deleteCharacterFor(actor, id);
  if (!removed) return json({ error: "Personagem não encontrado" }, 404);
  return json({ ok: true });
}
