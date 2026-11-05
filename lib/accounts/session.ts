import { createHmac, timingSafeEqual } from "node:crypto";
import { productEnv } from "../product-env";

export const SESSION_COOKIE = "animind_session";
export const SESSION_TTL_SEC = 60 * 60 * 24 * 14;

/** Signing key for the session cookie. Never has a default. */
export function authSecret(): string | null {
  const value = productEnv("AUTH_SECRET")?.trim();
  if (!value || value.length < 16) return null;
  return value;
}

export function signSession(userId: string, secret: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ sub: userId, exp: now + SESSION_TTL_SEC * 1000 })).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readSession(token: string, secret: string, now = Date.now()): { sub: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { sub?: unknown; exp?: unknown };
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

/** localhost, 127.0.0.1 and ::1. Google treats each of these as its own redirect URI. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** Secure only on HTTPS. `npm run dev` on http://localhost keeps the cookie. */
export function cookieSecure(req: Request): boolean {
  const forced = productEnv("COOKIE_SECURE");
  if (forced === "1") return true;
  if (forced === "0") return false;
  try {
    const url = new URL(req.url);
    if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return false;
  } catch {
    // Fall through to the proxy header.
  }
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded) return forwarded === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}
