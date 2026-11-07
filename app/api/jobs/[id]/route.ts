import { guardedGeneration } from "@/lib/accounts/generation";
import { coreMode, json, proxyJson } from "@/lib/core";
import { mockGetJob } from "@/lib/mock";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return guardedGeneration(req, "job", () => perform(context));
}

async function perform({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id.startsWith("mock_")) {
    try {
      return json(mockGetJob(id));
    } catch {
      return json({ error: "Job não encontrado" }, 404);
    }
  }
  if (coreMode() !== "core") return json({ error: "Job não encontrado" }, 404);
  return proxyJson(`/jobs/${encodeURIComponent(id)}`);
}
