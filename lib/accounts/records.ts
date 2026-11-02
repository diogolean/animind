import type { LibraryCharacter, UserRecord } from "./types";

/** Persistence for accounts and character metadata. Bytes live in object storage, not here. */
export interface AccountRecords {
  users(): Promise<UserRecord[]>;
  userById(id: string): Promise<UserRecord | null>;
  userByEmail(email: string): Promise<UserRecord | null>;
  /** Returns false when the email is already taken. */
  insertUser(user: UserRecord): Promise<boolean>;
  updateUser(user: UserRecord): Promise<void>;
  characters(): Promise<LibraryCharacter[]>;
  insertCharacter(character: LibraryCharacter): Promise<void>;
  replaceCharacter(character: LibraryCharacter): Promise<LibraryCharacter | null>;
  deleteCharacter(id: string): Promise<boolean>;
}
