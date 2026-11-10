import { NextResponse } from "next/server";
import { cookieSecure, SESSION_COOKIE } from "@/lib/accounts/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", secure: cookieSecure(req), maxAge: 0 });
  return res;
}
