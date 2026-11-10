/**
 * The 2026-11-03 charge approval is a set of heads, not a full body.
 * Eyes and mouths for overlay are not in that set. A head-only folder
 * stays draft. This module does not read or copy the PNG bytes.
 */

export type ChargePlateRole = "head" | "face" | "body" | "other";

export function chargePlateRole(path: string): ChargePlateRole {
  const name = path.split("/").pop() ?? path;
  if (/^head_/i.test(name)) return "head";
  if (/^rosto_/i.test(name)) return "face";
  if (/(^|\/)(body|torso)\.png$/i.test(path) || /^(body|torso)\.png$/i.test(name)) return "body";
  return "other";
}

/** True when ready would claim a puppet the folder does not contain. */
export function blockReadyIncompleteHead(paths: readonly string[]): boolean {
  const roles = paths.map(chargePlateRole);
  if (!roles.some((role) => role === "head" || role === "face")) return false;
  if (roles.includes("body")) return false;
  const hasEyes = paths.some((path) => /(^|\/)(eyes|iris|eye_white|eye_socket)\.png$/i.test(path));
  const hasMouth = paths.some((path) => /mouth/i.test(path));
  return !hasEyes || !hasMouth;
}
