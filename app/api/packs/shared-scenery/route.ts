import { isUser, requireUser } from "@/lib/accounts/http";
import { sharedSceneryPng } from "@/lib/charge-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const png = sharedSceneryPng();
  if (!png) return new Response(null, { status: 404 });
  return new Response(Buffer.from(png), {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" },
  });
}
