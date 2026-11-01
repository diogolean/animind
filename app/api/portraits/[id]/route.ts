import { commonsFileUrl, portraitById } from "@/lib/catalog";

/** Same-origin proxy so portraits can be drawn into a recordable (untainted) canvas. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = portraitById(id);
  if (!p) return new Response("not found", { status: 404 });
  const r = await fetch(commonsFileUrl(p.file), {
    headers: { "user-agent": "Animind/0.1 (https://github.com/diogolean/animind)" },
    next: { revalidate: 86400 },
  });
  if (!r.ok) return new Response("upstream error", { status: 502 });
  return new Response(r.body, {
    headers: {
      "content-type": r.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
      "x-license": "public-domain",
    },
  });
}
