import { coreFetch, coreUrl, json } from "@/lib/core";
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
  if (!coreUrl()) return json({ error: "Job não encontrado" }, 404);
  const r = await coreFetch(`/jobs/${encodeURIComponent(id)}`);
  return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
}
