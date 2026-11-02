import "server-only";
import { cookies } from "next/headers";
import { json } from "@/lib/core";
import { authSecret, readSession, SESSION_COOKIE } from "./session";
import { getUser } from "./store";
import type { PublicUser } from "./types";

export async function currentUser(): Promise<PublicUser | null> {
  const secret = authSecret();
  if (!secret) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = readSession(token, secret);
  if (!session) return null;
  return getUser(session.sub);
}

export async function requireUser(): Promise<PublicUser | Response> {
  if (!authSecret()) return json({ error: "Defina ANIMIND_AUTH_SECRET (mínimo de 16 caracteres)" }, 503);
  const user = await currentUser();
  if (!user) return json({ error: "Entre para continuar" }, 401);
  return user;
}

export function isUser(value: PublicUser | Response): value is PublicUser {
  return !(value instanceof Response);
}
