import { coreMode, json, proxyJson } from "@/lib/core";
import { mockGetJob } from "@/lib/mock";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
