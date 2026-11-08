import { guardedRead } from "@/lib/accounts/generation";
import type { PublicUser } from "@/lib/accounts/types";
import { jobKey, ownsResource, rememberOwned } from "@/lib/accounts/owned";
import { coreMode, coreUserHeader, json, proxyJson } from "@/lib/core";
import { mockGetJob } from "@/lib/mock";

/** Read an existing job. This does not reserve money and does not start a generation. */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return guardedRead(req, "job", (actor) => perform(actor, context));
}

async function perform(actor: PublicUser, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = jobKey(id);
  if (!key || !(await ownsResource(actor.id, "job", key))) return json({ error: "Job não encontrado" }, 404);
  if (key.startsWith("mock_")) {
    try {
      const job = mockGetJob(key);
      const text = JSON.stringify(job);
      await rememberOwned(actor.id, text);
      return new Response(text, { headers: { "content-type": "application/json" } });
    } catch {
      return json({ error: "Job não encontrado" }, 404);
    }
  }
  if (coreMode() !== "core") return json({ error: "Job não encontrado" }, 404);
  const response = await proxyJson(`/jobs/${encodeURIComponent(key)}`, { headers: coreUserHeader(actor.id) });
  if (response.ok) await rememberOwned(actor.id, await response.clone().text());
  return response;
}
