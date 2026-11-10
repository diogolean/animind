import { guardedRead } from "@/lib/accounts/generation";
import type { PublicUser } from "@/lib/accounts/types";
import { fileKey, ownsResource } from "@/lib/accounts/owned";
import { coreFetch, coreMode, coreUserHeader, json } from "@/lib/core";

/** Download an existing core file. One fetch, no retry, no token meter. */
export async function GET(req: Request, context: { params: Promise<{ path: string[] }> }) {
  return guardedRead(req, "file", (actor) => perform(actor, req, context));
}

async function perform(actor: PublicUser, req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const key = fileKey(path);
  if (!key || !(await ownsResource(actor.id, "file", key))) return json({ error: "Arquivo não encontrado" }, 404);
  if (coreMode() !== "core") return json({ error: "Arquivo não encontrado" }, 404);
  const range = req.headers.get("range");
  const response = await coreFetch(`/files/${key.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { ...coreUserHeader(actor.id), ...(range ? { range } : {}) },
  });
  const headers = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("cache-control", "private, max-age=3600");
  return new Response(response.body, { status: response.status, headers });
}
