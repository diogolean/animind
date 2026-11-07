import { createHmac, timingSafeEqual } from "node:crypto";
import { productEnv } from "../product-env";
import { isLoopbackHost } from "./session";

export const GOOGLE_STATE_COOKIE = "animind_google_state";
const STATE_TTL_MS = 10 * 60 * 1000;
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export class GoogleAuthError extends Error {
  constructor(readonly code: "unverified" | "token") {
    super(code);
  }
}

/** Both values are required. The secret never has a default and never goes to the browser. */
export function googleConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return null;
  if (clientId.length > 256 || clientSecret.length > 256) return null;
  return { clientId, clientSecret };
}

function originFrom(proto: string, host: string): string | null {
  if (proto !== "http" && proto !== "https") return null;
  if (!/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host)) return null;
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

/** Host the browser actually called, ignoring ANIMINDLY_AUTH_URL. */
export function requestOrigin(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "";
  if (forwardedHost && (forwardedProto === "http" || forwardedProto === "https")) {
    const origin = originFrom(forwardedProto, forwardedHost);
    if (origin) return origin;
  }
  try {
    return new URL(req.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Public origin for the redirect URI and the session cookie.
 * http://localhost:3000 (and the other loopback hosts) always win, so `npm run dev`
 * matches the redirect URI registered for that exact origin.
 * Anywhere else, ANIMINDLY_AUTH_URL wins so a changing preview hostname still matches Google Cloud.
 * A path on that variable is dropped; only the origin is used.
 */
export function authOrigin(req: Request): string {
  const here = requestOrigin(req);
  if (isLoopbackOrigin(here)) return here;
  const configured = productEnv("AUTH_URL")?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      // Fall through to the request host.
    }
  }
  return here;
}

export function googleRedirectUri(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

/** Relative in-app path. Rejects protocol-relative and off-site values. */
export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > 512) return "/characters";
  if (!value.startsWith("/") || value.startsWith("//")) return "/characters";
  if (value.includes("\\") || value.includes("://") || /[\u0000-\u001f\u007f]/.test(value)) return "/characters";
  return value;
}

export function googleAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export function signOAuthState(payload: { state: string; next: string }, secret: string, now = Date.now()): string {
  const body = Buffer.from(
    JSON.stringify({ typ: "google", state: payload.state, next: payload.next, exp: now + STATE_TTL_MS }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readOAuthState(token: string, secret: string, now = Date.now()): { state: string; next: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      typ?: unknown;
      state?: unknown;
      next?: unknown;
      exp?: unknown;
    };
    if (payload.typ !== "google") return null;
    if (typeof payload.state !== "string" || !payload.state) return null;
    if (typeof payload.next !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    return { state: payload.state, next: safeNext(payload.next) };
  } catch {
    return null;
  }
}

export function sameToken(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

type GoogleProfile = { email: string; name: string };

/** Exchanges the code and returns a verified email. `email_verified` must be boolean true. */
export async function googleProfile(
  code: string,
  redirectUri: string,
  config: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleProfile> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const tokenRes = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) throw new GoogleAuthError("token");
  const token = (await tokenRes.json().catch(() => null)) as { access_token?: unknown } | null;
  if (!token || typeof token.access_token !== "string" || !token.access_token) throw new GoogleAuthError("token");
  const infoRes = await fetchImpl(USERINFO_URL, { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!infoRes.ok) throw new GoogleAuthError("token");
  const info = (await infoRes.json().catch(() => null)) as { email?: unknown; email_verified?: unknown; name?: unknown } | null;
  if (!info || info.email_verified !== true || typeof info.email !== "string") throw new GoogleAuthError("unverified");
  return { email: info.email, name: typeof info.name === "string" ? info.name : "" };
}
