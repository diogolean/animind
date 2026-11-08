import type {
  Character,
  CharacterPreview,
  CharacterPreviewRequest,
  CreationPlan,
  CreationPlanRequest,
  CreateCharacterRequest,
  DeepStatus,
  LanguageCode,
  RenderJob,
  RenderRequest,
  ScenarioRequest,
  ScenarioResolution,
  ToneCatalog,
  VoiceCatalog,
} from "./contract";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const data = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!r.ok) throw new ApiError(r.status, data.code ?? "", data.error ?? "");
  return data as T;
}

export const createCharacter = (body: CreateCharacterRequest) =>
  call<Character>("/api/characters", { method: "POST", body: JSON.stringify(body) });

export const createPreview = (body: CharacterPreviewRequest) =>
  call<CharacterPreview>("/api/preview", { method: "POST", body: JSON.stringify(body) });

export const startRender = (body: RenderRequest) => call<RenderJob>("/api/render", { method: "POST", body: JSON.stringify(body) });

export const planCreation = (body: CreationPlanRequest) =>
  call<CreationPlan>("/api/plan", { method: "POST", body: JSON.stringify(body) });

export const getTones = () => call<ToneCatalog>("/api/tones");

export const getVoices = (language: LanguageCode) =>
  call<VoiceCatalog>(`/api/voices?${new URLSearchParams({ lang: language })}`);

export const resolveScenario = (body: ScenarioRequest) =>
  call<ScenarioResolution>("/api/scenarios", { method: "POST", body: JSON.stringify(body) });

export const deepStatus = (name: string) => call<DeepStatus>(`/api/personas/deep?${new URLSearchParams({ name, lang: "pt-BR" })}`);

export const startDeep = (name: string) => call<DeepStatus>("/api/personas/deep", { method: "POST", body: JSON.stringify({ name, lang: "pt-BR" }) });

export const getJob = (id: string) => call<RenderJob>(`/api/jobs/${encodeURIComponent(id)}`);

export async function waitJob(id: string, onProgress: (j: RenderJob) => void, signal?: AbortSignal): Promise<RenderJob> {
  for (;;) {
    if (signal?.aborted) throw new ApiError(0, "cancelled", "cancelled");
    const j = await getJob(id);
    onProgress(j);
    if (j.status === "done") return j;
    if (j.status === "failed") throw new ApiError(0, "render_failed", j.error ?? "");
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Window event: the core’s capabilities may have changed (e.g. Gemini art fell back to mock), re-read /api/health. */
export const HEALTH_EVENT = "animind:health";
