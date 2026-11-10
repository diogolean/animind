import { NextResponse } from "next/server";
import { StoreConfigError } from "@/lib/accounts/config";
import {
  authOrigin,
  GoogleAuthError,
  googleConfig,
  googleProfile,
  googleRedirectUri,
  GOOGLE_STATE_COOKIE,
  readCookie,
  readOAuthState,
  safeNext,
  sameToken,
} from "@/lib/accounts/google";
import { authSecret, cookieSecure, SESSION_COOKIE, SESSION_TTL_SEC, signSession } from "@/lib/accounts/session";
import { accountForVerifiedGoogle } from "@/lib/accounts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(origin: string, code: string, next: string, secure: boolean) {
  const url = new URL("/login", origin);
  url.searchParams.set("error", code);
  url.searchParams.set("next", safeNext(next));
  const res = NextResponse.redirect(url);
  res.cookies.set(GOOGLE_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/auth/google",
    secure,
    maxAge: 0,
  });
  return res;
}

export async function GET(req: Request) {
  const origin = authOrigin(req);
  const secure = cookieSecure(req);
  const secret = authSecret();
  const config = googleConfig();
  if (!secret || !config) return fail(origin, "google_unconfigured", "/characters", secure);

  const url = new URL(req.url);
  const returned = url.searchParams.get("state") ?? "";
  const cookie = readCookie(req, GOOGLE_STATE_COOKIE) ?? "";
  const parsed = returned ? readOAuthState(returned, secret) : null;
  const next = parsed?.next ?? "/characters";
  if (url.searchParams.get("error")) return fail(origin, "google_denied", next, secure);
  if (!cookie || !returned || !sameToken(cookie, returned) || !parsed) return fail(origin, "google_state", "/characters", secure);

  const code = url.searchParams.get("code");
  if (!code) return fail(origin, "google_denied", next, secure);
  try {
    const profile = await googleProfile(code, googleRedirectUri(origin), config);
    const user = await accountForVerifiedGoogle(profile.email, profile.name);
    if (!user) return fail(origin, "google_unverified", next, secure);
    const res = NextResponse.redirect(new URL(parsed.next, origin));
    res.cookies.set(SESSION_COOKIE, signSession(user.id, secret), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
      maxAge: SESSION_TTL_SEC,
    });
    res.cookies.set(GOOGLE_STATE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/auth/google",
      secure,
      maxAge: 0,
    });
    return res;
  } catch (error) {
    if (error instanceof StoreConfigError) return fail(origin, "google_unconfigured", next, secure);
    if (error instanceof GoogleAuthError && error.code === "unverified") return fail(origin, "google_unverified", next, secure);
    return fail(origin, "google_denied", next, secure);
  }
}
