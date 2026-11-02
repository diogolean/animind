import type { LibraryCharacter, PublicUser, Role } from "./types";

/** A super_admin is the only role that can see and manage every user's library. */
export function canSeeAll(role: Role): boolean {
  return role === "super_admin";
}

export function canSeeCharacter(actor: Pick<PublicUser, "id" | "role">, character: Pick<LibraryCharacter, "ownerId">): boolean {
  return canSeeAll(actor.role) || actor.id === character.ownerId;
}

/** Admin may create plain users. Promoting someone requires a super_admin. */
export function canAssignRole(actorRole: Role, role: Role): boolean {
  if (actorRole === "super_admin") return true;
  return actorRole === "admin" && role === "user";
}
