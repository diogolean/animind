import { guardedRead } from "@/lib/accounts/generation";
import { coreFetch, coreMode, json } from "@/lib/core";

/** Download an existing core file. One fetch, no retry, no token meter. */
export async function GET(req: Request, context: { params: Promise<{ path: string[] }> }) {
  return guardedRead(req, "file", () => perform(req, context));
}

async function perform(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (coreMode() !== "core") return json({ error: "Arquivo não encontrado" }, 404);
  if (path.some((part) => part === ".." || part.includes("\\"))) return json({ error: "Caminho inválido" }, 400);
  const range = req.headers.get("range");
  const response = await coreFetch(`/files/${path.map(encodeURIComponent).join("/")}`, range ? { headers: { range } } : undefined);
  const headers = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("cache-control", "private, max-age=3600");
  return new Response(response.body, { status: response.status, headers });
}
