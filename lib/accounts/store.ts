import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { canAssignRole, canSeeAll, canSeeCharacter } from "./access";
import { deleteObjectPrefix } from "./object-store";
import { hashPassword, verifyPassword } from "./password";
import { dataDir, newId } from "./paths";
import { isLibraryStatus, isRole, type LibraryCharacter, type LibraryStatus, type PublicUser, type Result, type Role, type UserRecord } from "./types";

/** Pilot super admin created by scripts/seed-superadmin.ts. The name is not a secret. */
export const PILOT_SUPERADMIN_NAME = "Diogo";

interface Db {
  users: UserRecord[];
  characters: LibraryCharacter[];
}

const locks = new Map<string, Promise<unknown>>();

function exclusive<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(dir) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(
    dir,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function dbPath(): string {
  return path.join(dataDir(), "accounts.json");
}

async function readDb(): Promise<Db> {
  try {
    const parsed = JSON.parse(await readFile(dbPath(), "utf8")) as Partial<Db>;
    return { users: parsed.users ?? [], characters: parsed.characters ?? [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { users: [], characters: [] };
    throw error;
  }
}

async function writeDb(db: Db): Promise<void> {
  const dest = dbPath();
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, dest);
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
  const db = await readDb();
  const user = db.users.find((item) => item.id === id);
  return user ? toPublicUser(user) : null;
}

export async function listUsers(): Promise<PublicUser[]> {
  const db = await readDb();
  return db.users.map(toPublicUser);
}

let dummyHash: string | null = null;

export async function verifyLogin(email: string, password: string): Promise<PublicUser | null> {
  const normalized = normalizeEmail(email);
  const db = await readDb();
  const user = normalized ? db.users.find((item) => item.email === normalized) : undefined;
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
  return exclusive(dataDir(), async () => {
    const db = await readDb();
    if (db.users.some((user) => user.email === email)) return { ok: false, error: "E-mail já cadastrado", status: 409 } as Result<PublicUser>;
    const user: UserRecord = { id: newId("usr"), email, name, role: input.role, passwordHash, createdAt: new Date().toISOString() };
    db.users.push(user);
    await writeDb(db);
    return { ok: true, value: toPublicUser(user) };
  });
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
  return exclusive(dataDir(), async () => {
    const db = await readDb();
    const existing = db.users.find((user) => user.email === normalized);
    if (existing) {
      existing.name = PILOT_SUPERADMIN_NAME;
      existing.role = "super_admin";
      existing.passwordHash = passwordHash;
      await writeDb(db);
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
    db.users.push(user);
    await writeDb(db);
    return toPublicUser(user);
  });
}

function withOwner(character: LibraryCharacter, users: UserRecord[], includeOwner: boolean): LibraryCharacter {
  const base = withoutOwner(character);
  if (!includeOwner) return base;
  const owner = users.find((user) => user.id === character.ownerId);
  return owner ? { ...base, owner: { id: owner.id, name: owner.name, email: owner.email } } : base;
}

export async function charactersFor(actor: PublicUser): Promise<LibraryCharacter[]> {
  const db = await readDb();
  const visible = db.characters.filter((character) => canSeeCharacter(actor, character));
  return visible.map((character) => withOwner(character, db.users, canSeeAll(actor.role)));
}

export async function characterFor(actor: PublicUser, id: string): Promise<LibraryCharacter | null> {
  const db = await readDb();
  const character = db.characters.find((item) => item.id === id);
  if (!character || !canSeeCharacter(actor, character)) return null;
  return withOwner(character, db.users, canSeeAll(actor.role));
}

export async function saveCharacter(character: LibraryCharacter): Promise<LibraryCharacter> {
  const stored = withoutOwner(character);
  return exclusive(dataDir(), async () => {
    const db = await readDb();
    db.characters.push(stored);
    await writeDb(db);
    return stored;
  });
}

export async function updateCharacterStatus(actor: PublicUser, id: string, status: LibraryStatus): Promise<LibraryCharacter | null> {
  if (!isLibraryStatus(status)) return null;
  return exclusive(dataDir(), async () => {
    const db = await readDb();
    const character = db.characters.find((item) => item.id === id);
    if (!character || !canSeeCharacter(actor, character)) return null;
    character.status = status;
    character.updatedAt = new Date().toISOString();
    await writeDb(db);
    return withOwner(character, db.users, canSeeAll(actor.role));
  });
}

export async function deleteCharacterFor(actor: PublicUser, id: string): Promise<boolean> {
  const removed = await exclusive(dataDir(), async () => {
    const db = await readDb();
    const character = db.characters.find((item) => item.id === id);
    if (!character || !canSeeCharacter(actor, character)) return false;
    db.characters = db.characters.filter((item) => item.id !== id);
    await writeDb(db);
    return true;
  });
  if (removed) await deleteObjectPrefix(id);
  return removed;
}

export async function resolveOwner(actor: PublicUser, ownerEmail?: string): Promise<Result<PublicUser>> {
  if (!ownerEmail) return { ok: true, value: actor };
  if (!canSeeAll(actor.role)) return { ok: false, error: "Só um super admin escolhe a conta de destino", status: 403 };
  const email = normalizeEmail(ownerEmail);
  if (!email) return { ok: false, error: "E-mail do dono inválido", status: 400 };
  const db = await readDb();
  const owner = db.users.find((user) => user.email === email);
  if (!owner) return { ok: false, error: "Usuário de destino não encontrado", status: 404 };
  return { ok: true, value: toPublicUser(owner) };
}
