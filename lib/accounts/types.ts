/** Roles stored on an account. Only a super_admin can see and manage every character. */
export type Role = "user" | "admin" | "super_admin";

export const ROLES: readonly Role[] = ["user", "admin", "super_admin"];

export type LibraryStatus = "draft" | "ready" | "archived";

/** Every generated file a user keeps, not only characters. */
export const ASSET_KINDS = ["character", "view", "emotion_sheet", "image", "script", "audio", "video", "debate"] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

export const LIBRARY_STATUSES: readonly LibraryStatus[] = ["draft", "ready", "archived"];

/** Gallery angles shown on My characters. The rig itself stays in puppet.json. */
export type LibraryViewName = "front" | "three_quarter" | "profile";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}

export interface UserRecord extends PublicUser {
  passwordHash: string;
}

export interface LibraryLayer {
  name: string;
  /** Object-storage URL. The PNG bytes are not stored on the character record. */
  url: string;
}

export interface LibraryCharacter {
  id: string;
  ownerId: string;
  name: string;
  /** Reference to a persona sheet (name, Wikiquote URL, or object URL). Not the sheet body. */
  personaSheetRef: string | null;
  views: Partial<Record<LibraryViewName, string>>;
  puppetUrl: string;
  layers: LibraryLayer[];
  emotionSheetUrl: string | null;
  status: LibraryStatus;
  createdAt: string;
  updatedAt: string;
  /** Present when the viewer is a super_admin looking at someone else's library. */
  owner?: Pick<PublicUser, "id" | "name" | "email">;
}

/** One user-owned file. Bytes live in object storage; this record keeps the link. */
export interface LibraryAsset {
  id: string;
  ownerId: string;
  kind: AssetKind;
  name: string;
  url: string | null;
  /** Short preview for text assets. The full text is the object at `url` when it was stored. */
  text: string | null;
  mime: string | null;
  /** Library character, or the generated character id when it is not in the library yet. */
  characterId: string | null;
  /** Job or character that produced this file. */
  projectId: string | null;
  createdAt: string;
  owner?: Pick<PublicUser, "id" | "name" | "email">;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

export function isRole(value: unknown): value is Role {
  return value === "user" || value === "admin" || value === "super_admin";
}

export function isLibraryStatus(value: unknown): value is LibraryStatus {
  return value === "draft" || value === "ready" || value === "archived";
}

export function isAssetKind(value: unknown): value is AssetKind {
  return typeof value === "string" && (ASSET_KINDS as readonly string[]).includes(value);
}
