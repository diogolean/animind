import { json } from "@/lib/core";
import { isUser, requireUser } from "@/lib/accounts/http";
import { createAccount, listUsers } from "@/lib/accounts/store";
import { isRole } from "@/lib/accounts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  if (actor.role === "user") return json({ error: "Sem permissão" }, 403);
  return json({ users: await listUsers() });
}

export async function POST(req: Request) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  let body: { email?: string; name?: string; password?: string; role?: string };
  try {
    body = (await req.json()) as { email?: string; name?: string; password?: string; role?: string };
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  if (!isRole(body.role)) return json({ error: "Papel inválido" }, 400);
  const created = await createAccount(actor, {
    email: body.email ?? "",
    name: body.name ?? "",
    password: body.password ?? "",
    role: body.role,
  });
  if (!created.ok) return json({ error: created.error }, created.status);
  return json({ user: created.value }, 201);
}
