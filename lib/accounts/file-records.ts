import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./paths";
import type { AccountRecords } from "./records";
import type { LibraryCharacter, UserRecord } from "./types";

interface Db {
  users: UserRecord[];
  characters: LibraryCharacter[];
}

const locks = new Map<string, Promise<unknown>>();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const dir = dataDir();
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

function withoutOwner(character: LibraryCharacter): LibraryCharacter {
  if (!character.owner) return character;
  const copy = { ...character };
  delete copy.owner;
  return copy;
}

/** Local accounts.json. Used when DATABASE_URL is unset, including tests. */
export function fileRecords(): AccountRecords {
  return {
    async users() {
      return (await readDb()).users;
    },
    async userById(id) {
      return (await readDb()).users.find((user) => user.id === id) ?? null;
    },
    async userByEmail(email) {
      return (await readDb()).users.find((user) => user.email === email) ?? null;
    },
    insertUser(user) {
      return exclusive(async () => {
        const db = await readDb();
        if (db.users.some((item) => item.email === user.email)) return false;
        db.users.push(user);
        await writeDb(db);
        return true;
      });
    },
    updateUser(user) {
      return exclusive(async () => {
        const db = await readDb();
        const index = db.users.findIndex((item) => item.id === user.id);
        if (index < 0) throw new Error("Usuário não encontrado");
        db.users[index] = user;
        await writeDb(db);
      });
    },
    async characters() {
      return (await readDb()).characters.map(withoutOwner);
    },
    insertCharacter(character) {
      return exclusive(async () => {
        const db = await readDb();
        db.characters.push(withoutOwner(character));
        await writeDb(db);
      });
    },
    replaceCharacter(character) {
      return exclusive(async () => {
        const db = await readDb();
        const index = db.characters.findIndex((item) => item.id === character.id);
        if (index < 0) return null;
        const stored = withoutOwner(character);
        db.characters[index] = stored;
        await writeDb(db);
        return stored;
      });
    },
    deleteCharacter(id) {
      return exclusive(async () => {
        const db = await readDb();
        const before = db.characters.length;
        db.characters = db.characters.filter((item) => item.id !== id);
        if (db.characters.length === before) return false;
        await writeDb(db);
        return true;
      });
    },
  };
}
