import { randomBytes } from "node:crypto";
import { canAssignRole, canSeeAll, canSeeCharacter } from "./access";
import { accountsConfigError, databaseUrl, onVercel, usesBlob, blobConfigError } from "./config";
import { fileRecords } from "./file-records";
import { deleteObject, deleteObjectPrefix, keyFromAssetUrl, putObject } from "./object-store";
import { hashPassword, verifyPassword } from "./password";
import { newId } from "./paths";
import { postgresRecords } from "./postgres-records";
import type { AccountRecords } from "./records";
import { isLibraryStatus, isRole, type AssetKind, type LibraryAsset, type LibraryCharacter, type LibraryStatus, type LibraryViewName, type PublicUser, type Result, type Role, type UserRecord } from "./types";

/** Pilot super admin created by scripts/seed-superadmin.ts. The name is not a secret. */
export const PILOT_SUPERADMIN_NAME = "Diogo";

function records(): AccountRecords {
  if (databaseUrl()) return postgresRecords();
  if (onVercel()) throw accountsConfigError();
  return fileRecords();
}

function requireBlobForDelete(): void {
  if (onVercel() && !usesBlob()) throw blobConfigError();
}

export function normalizeEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  if (value.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  return value;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt };
}

function withoutOwner(character: LibraryCharacter): LibraryCharacter {
  if (!character.owner) return character;
  const copy = { ...character };
  delete copy.owner;
  return copy;
}

export async function getUser(id: string): Promise<PublicUser | null> {
  const user = await records().userById(id);
  return user ? toPublicUser(user) : null;
}

export async function listUsers(): Promise<PublicUser[]> {
  return (await records().users()).map(toPublicUser);
}

let dummyHash: string | null = null;

export async function verifyLogin(email: string, password: string): Promise<PublicUser | null> {
  const normalized = normalizeEmail(email);
  const store = records();
  const user = normalized ? await store.userByEmail(normalized) : null;
  dummyHash ??= await hashPassword(randomBytes(32).toString("base64url"));
  const ok = await verifyPassword(password, user?.passwordHash ?? dummyHash);
  if (!user || !ok) return null;
  return toPublicUser(user);
}

export async function createAccount(
  actor: PublicUser,
  input: { email: string; name: string; password: string; role: Role },
): Promise<Result<PublicUser>> {
  if (!canAssignRole(actor.role, input.role) || !isRole(input.role)) {
    return { ok: false, error: "Você não pode atribuir esse papel", status: 403 };
  }
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!email) return { ok: false, error: "E-mail inválido", status: 400 };
  if (!name || name.length > 80) return { ok: false, error: "Nome inválido", status: 400 };
  if (input.password.length < 8 || input.password.length > 200) {
    return { ok: false, error: "A senha precisa ter entre 8 e 200 caracteres", status: 400 };
  }
  const passwordHash = await hashPassword(input.password);
  const user: UserRecord = { id: newId("usr"), email, name, role: input.role, passwordHash, createdAt: new Date().toISOString() };
  const inserted = await records().insertUser(user);
  if (!inserted) return { ok: false, error: "E-mail já cadastrado", status: 409 };
  return { ok: true, value: toPublicUser(user) };
}

/**
 * Creates or updates the pilot super admin from env-supplied credentials.
 * The display name is always Diogo. The password is replaced when this runs again.
 */
export async function upsertPilotSuperAdmin(email: string, password: string): Promise<PublicUser> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("SEED_SUPERADMIN_EMAIL inválido");
  if (password.length < 8 || password.length > 200) throw new Error("SEED_SUPERADMIN_PASSWORD precisa ter entre 8 e 200 caracteres");
  const passwordHash = await hashPassword(password);
  const store = records();
  const existing = await store.userByEmail(normalized);
  if (existing) {
    existing.name = PILOT_SUPERADMIN_NAME;
    existing.role = "super_admin";
    existing.passwordHash = passwordHash;
    await store.updateUser(existing);
    return toPublicUser(existing);
  }
  const user: UserRecord = {
    id: newId("usr"),
    email: normalized,
    name: PILOT_SUPERADMIN_NAME,
    role: "super_admin",
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  const inserted = await store.insertUser(user);
  if (!inserted) {
    const raced = await store.userByEmail(normalized);
    if (!raced) throw new Error("Não foi possível criar o super admin");
    raced.name = PILOT_SUPERADMIN_NAME;
    raced.role = "super_admin";
    raced.passwordHash = passwordHash;
    await store.updateUser(raced);
    return toPublicUser(raced);
  }
  return toPublicUser(user);
}

function withOwner(character: LibraryCharacter, users: UserRecord[], includeOwner: boolean): LibraryCharacter {
  const base = withoutOwner(character);
  if (!includeOwner) return base;
  const owner = users.find((user) => user.id === character.ownerId);
  return owner ? { ...base, owner: { id: owner.id, name: owner.name, email: owner.email } } : base;
}

export async function charactersFor(actor: PublicUser): Promise<LibraryCharacter[]> {
  const store = records();
  const [users, characters] = await Promise.all([store.users(), store.characters()]);
  return characters.filter((character) => canSeeCharacter(actor, character)).map((character) => withOwner(character, users, canSeeAll(actor.role)));
}

export async function characterFor(actor: PublicUser, id: string): Promise<LibraryCharacter | null> {
  const store = records();
  const character = (await store.characters()).find((item) => item.id === id);
  if (!character || !canSeeCharacter(actor, character)) return null;
  const users = canSeeAll(actor.role) ? await store.users() : [];
  return withOwner(character, users, canSeeAll(actor.role));
}

export async function saveCharacter(character: LibraryCharacter): Promise<LibraryCharacter> {
  const stored = withoutOwner(character);
  await records().insertCharacter(stored);
  return stored;
}

export async function updateCharacterStatus(actor: PublicUser, id: string, status: LibraryStatus): Promise<LibraryCharacter | null> {
  if (!isLibraryStatus(status)) return null;
  const store = records();
  const current = (await store.characters()).find((item) => item.id === id);
  if (!current || !canSeeCharacter(actor, current)) return null;
  const saved = await store.replaceCharacter({ ...current, status, updatedAt: new Date().toISOString() });
  if (!saved) return null;
  const users = canSeeAll(actor.role) ? await store.users() : [];
  return withOwner(saved, users, canSeeAll(actor.role));
}

export async function deleteCharacterFor(actor: PublicUser, id: string): Promise<boolean> {
  requireBlobForDelete();
  const store = records();
  const current = (await store.characters()).find((item) => item.id === id);
  if (!current || !canSeeCharacter(actor, current)) return false;
  const linked = await store.deleteAssetsForCharacter(id);
  const removed = await store.deleteCharacter(id);
  if (!removed) return false;
  await deleteObjectPrefix(id);
  for (const asset of linked) {
    const key = asset.url ? keyFromAssetUrl(asset.url) : null;
    if (key?.startsWith("assets/")) await deleteObject(key);
  }
  return true;
}

const VIEW_ASSET: { id: LibraryViewName; label: string }[] = [
  { id: "front", label: "Frente" },
  { id: "three_quarter", label: "3/4" },
  { id: "profile", label: "Perfil" },
];

function withAssetOwner(asset: LibraryAsset, users: UserRecord[], includeOwner: boolean): LibraryAsset {
  if (!includeOwner) {
    if (!asset.owner) return asset;
    const copy = { ...asset };
    delete copy.owner;
    return copy;
  }
  const owner = users.find((user) => user.id === asset.ownerId);
  return owner ? { ...asset, owner: { id: owner.id, name: owner.name, email: owner.email } } : asset;
}

/** Views and the emotion sheet already stored on a character, until an import writes real asset rows. */
function derivedAssets(character: LibraryCharacter): LibraryAsset[] {
  const shared = { ownerId: character.ownerId, text: null, characterId: character.id, projectId: character.id, createdAt: character.createdAt };
  const assets: LibraryAsset[] = [
    {
      ...shared,
      id: `derived_${character.id}_character`,
      kind: "character",
      name: character.name,
      url: character.views.front ?? null,
      mime: character.views.front ? "image/png" : null,
    },
  ];
  for (const view of VIEW_ASSET) {
    const url = character.views[view.id];
    if (!url) continue;
    assets.push({ ...shared, id: `derived_${character.id}_${view.id}`, kind: "view", name: `${character.name} · ${view.label}`, url, mime: "image/png" });
  }
  if (character.emotionSheetUrl) {
    assets.push({
      ...shared,
      id: `derived_${character.id}_emotion`,
      kind: "emotion_sheet",
      name: `${character.name} · emoções`,
      url: character.emotionSheetUrl,
      mime: "image/png",
    });
  }
  return assets;
}

export async function assetsFor(actor: PublicUser, kind?: AssetKind): Promise<LibraryAsset[]> {
  const store = records();
  const [users, stored, characters] = await Promise.all([store.users(), store.assets(), store.characters()]);
  const includeOwner = canSeeAll(actor.role);
  const visibleCharacters = characters.filter((character) => canSeeCharacter(actor, character));
  const linked = new Set(stored.map((asset) => asset.characterId).filter((id): id is string => Boolean(id)));
  const derived = visibleCharacters.filter((character) => !linked.has(character.id)).flatMap(derivedAssets);
  const visible = [...stored.filter((asset) => canSeeCharacter(actor, asset)), ...derived];
  const filtered = kind ? visible.filter((asset) => asset.kind === kind) : visible;
  return filtered
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((asset) => withAssetOwner(asset, users, includeOwner));
}

export async function assetFor(actor: PublicUser, id: string): Promise<LibraryAsset | null> {
  const asset = (await records().assets()).find((item) => item.id === id);
  if (!asset || !canSeeCharacter(actor, asset)) return null;
  return asset;
}

const TEXT_PREVIEW = 280;

/** Stores one library file. Text is copied into object storage; the row keeps a short preview. */
export async function saveAsset(
  ownerId: string,
  input: { kind: AssetKind; name: string; url?: string | null; text?: string | null; mime?: string | null; characterId?: string | null; projectId?: string | null },
): Promise<LibraryAsset> {
  const id = newId("ast");
  const name = input.name.trim().slice(0, 120) || "Arquivo";
  let url = input.url?.trim() || null;
  let text = input.text?.trim() || null;
  let mime = input.mime?.trim() || null;
  if (text) {
    const key = `assets/${id}/text.txt`;
    url = await putObject(key, Buffer.from(text, "utf8"));
    mime = mime ?? "text/plain";
    text = text.slice(0, TEXT_PREVIEW);
  }
  const asset: LibraryAsset = {
    id,
    ownerId,
    kind: input.kind,
    name,
    url,
    text,
    mime,
    characterId: input.characterId?.trim() || null,
    projectId: input.projectId?.trim() || null,
    createdAt: new Date().toISOString(),
  };
  await records().insertAsset(asset);
  return asset;
}

/** Rows for a character folder that just landed in the library. The PNGs are already in object storage. */
export async function saveCharacterAssets(character: LibraryCharacter): Promise<void> {
  await saveAsset(character.ownerId, {
    kind: "character",
    name: character.name,
    url: character.views.front ?? null,
    mime: character.views.front ? "image/png" : null,
    characterId: character.id,
    projectId: character.id,
  });
  for (const view of VIEW_ASSET) {
    const url = character.views[view.id];
    if (!url) continue;
    await saveAsset(character.ownerId, {
      kind: "view",
      name: `${character.name} · ${view.label}`,
      url,
      mime: "image/png",
      characterId: character.id,
      projectId: character.id,
    });
  }
  if (character.emotionSheetUrl) {
    await saveAsset(character.ownerId, {
      kind: "emotion_sheet",
      name: `${character.name} · emoções`,
      url: character.emotionSheetUrl,
      mime: "image/png",
      characterId: character.id,
      projectId: character.id,
    });
  }
}

export async function resolveOwner(actor: PublicUser, ownerEmail?: string): Promise<Result<PublicUser>> {
  if (!ownerEmail) return { ok: true, value: actor };
  if (!canSeeAll(actor.role)) return { ok: false, error: "Só um super admin escolhe a conta de destino", status: 403 };
  const email = normalizeEmail(ownerEmail);
  if (!email) return { ok: false, error: "E-mail do dono inválido", status: 400 };
  const owner = await records().userByEmail(email);
  if (!owner) return { ok: false, error: "Usuário de destino não encontrado", status: 404 };
  return { ok: true, value: toPublicUser(owner) };
}
