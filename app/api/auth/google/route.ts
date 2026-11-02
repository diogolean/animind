import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  authOrigin,
  googleAuthorizeUrl,
  googleConfig,
  googleRedirectUri,
  GOOGLE_STATE_COOKIE,
  requestOrigin,
  safeNext,
  signOAuthState,
} from "@/lib/accounts/google";
import { authSecret, cookieSecure } from "@/lib/accounts/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_MAX_AGE_SEC = 10 * 60;

function loginRedirect(origin: string, code: string, next: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("error", code);
  url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const current = new URL(req.url);
  const next = safeNext(current.searchParams.get("next"));
  const origin = authOrigin(req);
  if (requestOrigin(req) !== origin) {
    const bounce = new URL("/api/auth/google", origin);
    bounce.searchParams.set("next", next);
    return NextResponse.redirect(bounce);
  }
  const secret = authSecret();
  const config = googleConfig();
  if (!secret || !config) return loginRedirect(origin, "google_unconfigured", next);
  const state = randomBytes(24).toString("base64url");
  const token = signOAuthState({ state, next }, secret);
  const res = NextResponse.redirect(googleAuthorizeUrl({ clientId: config.clientId, redirectUri: googleRedirectUri(origin), state: token }));
  res.cookies.set(GOOGLE_STATE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/auth/google",
    secure: cookieSecure(req),
    maxAge: STATE_MAX_AGE_SEC,
  });
  return res;
}
