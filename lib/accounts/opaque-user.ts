const OPAQUE_USER = /^[A-Za-z0-9_-]{1,80}$/;

/** Account id safe to send as X-Animind-User. An email, or anything outside the core's pattern, is refused. */
export function opaqueUserId(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!raw || raw.includes("@") || !OPAQUE_USER.test(raw)) return null;
  return raw;
}
