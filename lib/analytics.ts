/** Pure GA4 scrubbing. Safe to import from tests. No measurement ID lives here. */

const PATH_TITLES: Record<string, string> = {
  "/": "Home",
  "/login": "Sign in",
  "/characters": "Characters",
  "/characters/item": "Character",
  "/biblioteca": "Library",
  "/other": "Animindly",
};

const EVENTS: Record<string, Record<string, readonly string[]>> = {
  login: { method: ["google", "password"] },
  create_attempt: { result: ["login_required", "unapproved", "started"] },
  avatar_attempt: { result: ["login_required", "unapproved", "blocked", "confirmed", "included"] },
  access_denied: { reason: ["anonymous", "unapproved", "disabled", "unavailable"] },
  generation_result: { status: ["queued", "succeeded", "failed", "denied"] },
};

export function sanitizePath(input: string): string {
  const path = input.split("?")[0]?.split("#")[0] ?? "/";
  if (path === "/") return "/";
  if (path === "/login" || path === "/characters" || path === "/biblioteca") return path;
  if (path.startsWith("/characters/")) return "/characters/item";
  return "/other";
}

export function pageTitle(path: string): string {
  return PATH_TITLES[path] ?? "Animindly";
}

export function pageLocation(origin: string, path: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}${path}`;
}

/** Keeps only the allowlisted enum for a known event. Anything else is dropped. */
export function sanitizeEvent(name: string, params: Record<string, unknown>): { name: string; params: Record<string, string> } | null {
  const spec = EVENTS[name];
  if (!spec) return null;
  const next: Record<string, string> = {};
  for (const [key, allowed] of Object.entries(spec)) {
    const value = params[key];
    if (typeof value !== "string" || !allowed.includes(value)) return null;
    next[key] = value;
  }
  return { name, params: next };
}
