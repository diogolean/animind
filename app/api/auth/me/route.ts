import { json } from "@/lib/core";
import { currentUser } from "@/lib/accounts/http";
import { authSecret } from "@/lib/accounts/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!authSecret()) return json({ user: null, auth: "off" }, 503);
  const user = await currentUser();
  if (!user) return json({ user: null }, 401);
  return json({ user });
}
