import { coreFetch, coreMode, json } from "@/lib/core";

/** Same-origin proxy for core art and media (PNG layers, voice.wav, preview.mp4). */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (coreMode() !== "core") return json({ error: "Arquivo não encontrado" }, 404);
  if (path.some((p) => p === ".." || p.includes("\\"))) return json({ error: "Caminho inválido" }, 400);
  const range = req.headers.get("range");
  const r = await coreFetch(`/files/${path.map(encodeURIComponent).join("/")}`, range ? { headers: { range } } : undefined);
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const v = r.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("cache-control", "private, max-age=3600");
  return new Response(r.body, { status: r.status, headers });
}
