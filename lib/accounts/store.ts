import { randomBytes } from "node:crypto";
import { canAssignRole, canSeeAll, canSeeCharacter } from "./access";
import { accountsConfigError, databaseUrl, onVercel, usesBlob, blobConfigError } from "./config";
import { fileRecords } from "./file-records";
import { deleteObjectPrefix } from "./object-store";
import { hashPassword, verifyPassword } from "./password";
import { newId } from "./paths";
import { postgresRecords } from "./postgres-records";
import type { AccountRecords } from "./records";
import { isLibraryStatus, isRole, type LibraryCharacter, type LibraryStatus, type PublicUser, type Result, type Role, type UserRecord } from "./types";

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
  const removed = await store.deleteCharacter(id);
  if (removed) await deleteObjectPrefix(id);
  return removed;
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
