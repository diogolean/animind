import { chargeHeadPng } from "@/lib/charge-serve";
import { isUser, requireUser } from "@/lib/accounts/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const { file } = await params;
  const head = chargeHeadPng(file);
  if (!head) return new Response(null, { status: 404 });
  return new Response(Buffer.from(head.png), {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" },
  });
}
