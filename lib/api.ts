import type {
  Character,
  CreationPlan,
  CreationPlanRequest,
  CreateCharacterRequest,
  DeepStatus,
  RenderJob,
  RenderRequest,
  ScenarioRequest,
  ScenarioResolution,
  ToneCatalog,
} from "./contract";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Erro ${r.status}`);
  return data as T;
}

export const createCharacter = (body: CreateCharacterRequest) =>
  call<Character>("/api/characters", { method: "POST", body: JSON.stringify(body) });

export const startRender = (body: RenderRequest) => call<RenderJob>("/api/render", { method: "POST", body: JSON.stringify(body) });

export const planCreation = (body: CreationPlanRequest) =>
  call<CreationPlan>("/api/plan", { method: "POST", body: JSON.stringify(body) });

export const getTones = () => call<ToneCatalog>("/api/tones");

export const resolveScenario = (body: ScenarioRequest) =>
  call<ScenarioResolution>("/api/scenarios", { method: "POST", body: JSON.stringify(body) });

export const deepStatus = (name: string) => call<DeepStatus>(`/api/personas/deep?${new URLSearchParams({ name, lang: "pt-BR" })}`);

export const startDeep = (name: string) => call<DeepStatus>("/api/personas/deep", { method: "POST", body: JSON.stringify({ name, lang: "pt-BR" }) });

export const getJob = (id: string) => call<RenderJob>(`/api/jobs/${encodeURIComponent(id)}`);

export async function waitJob(id: string, onProgress: (j: RenderJob) => void, signal?: AbortSignal): Promise<RenderJob> {
  for (;;) {
    if (signal?.aborted) throw new Error("cancelado");
    const j = await getJob(id);
    onProgress(j);
    if (j.status === "done") return j;
    if (j.status === "failed") throw new Error(j.error ?? "Falha no render");
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Window event: the core’s capabilities may have changed (e.g. Gemini art fell back to mock), re-read /api/health. */
export const HEALTH_EVENT = "animind:health";
