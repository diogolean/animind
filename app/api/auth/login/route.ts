import { NextResponse } from "next/server";
import { json } from "@/lib/core";
import { authSecret, cookieSecure, SESSION_COOKIE, SESSION_TTL_SEC, signSession } from "@/lib/accounts/session";
import { StoreConfigError } from "@/lib/accounts/config";
import { verifyLogin } from "@/lib/accounts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = authSecret();
  if (!secret) return json({ error: "Defina ANIMINDLY_AUTH_SECRET (mínimo de 16 caracteres)" }, 503);
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  let user;
  try {
    user = await verifyLogin(typeof body.email === "string" ? body.email : "", typeof body.password === "string" ? body.password : "");
  } catch (error) {
    if (error instanceof StoreConfigError) return json({ error: error.message }, error.status);
    throw error;
  }
  if (!user) return json({ error: "E-mail ou senha incorretos" }, 401);
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, signSession(user.id, secret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: cookieSecure(req),
    maxAge: SESSION_TTL_SEC,
  });
  return res;
}
