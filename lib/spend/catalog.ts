/**
 * Every proxy this app can make toward a provider.
 * The model id is not in this repository. `model` stays null until a response says otherwise.
 * Local rules are not a provider.
 */
export type SpendOperation =
  | "plan"
  | "render"
  | "preview"
  | "character"
  | "job"
  | "file"
  | "scenario"
  | "persona_deep"
  | "persona_sheet"
  | "voice"
  | "tone";

export interface SpendPath {
  method: "GET" | "POST";
  path: string;
  operation: SpendOperation;
  /** What this route does when the paid guard denies. */
  denial: "local-rules" | "local-catalog" | "http-deny";
  guard: "beginGeneration";
  test: string;
}

export const SPEND_PATHS: readonly SpendPath[] = [
  { method: "POST", path: "/api/plan", operation: "plan", denial: "local-rules", guard: "beginGeneration", test: "plan denial never calls the core" },
  { method: "POST", path: "/api/render", operation: "render", denial: "http-deny", guard: "beginGeneration", test: "render denial never calls the core" },
  { method: "POST", path: "/api/preview", operation: "preview", denial: "http-deny", guard: "beginGeneration", test: "preview route is guarded" },
  { method: "POST", path: "/api/characters", operation: "character", denial: "http-deny", guard: "beginGeneration", test: "character route is guarded" },
  { method: "GET", path: "/api/jobs/:id", operation: "job", denial: "http-deny", guard: "beginGeneration", test: "job route is guarded" },
  { method: "GET", path: "/api/files/*", operation: "file", denial: "http-deny", guard: "beginGeneration", test: "file route is guarded" },
  { method: "POST", path: "/api/scenarios", operation: "scenario", denial: "http-deny", guard: "beginGeneration", test: "scenario route is guarded" },
  { method: "GET", path: "/api/personas/deep", operation: "persona_deep", denial: "http-deny", guard: "beginGeneration", test: "persona deep route is guarded" },
  { method: "POST", path: "/api/personas/deep", operation: "persona_deep", denial: "http-deny", guard: "beginGeneration", test: "persona deep route is guarded" },
  { method: "GET", path: "/api/personas/sheet", operation: "persona_sheet", denial: "http-deny", guard: "beginGeneration", test: "persona sheet route is guarded" },
  { method: "GET", path: "/api/voices", operation: "voice", denial: "local-catalog", guard: "beginGeneration", test: "voices stay local when spend is closed" },
  { method: "GET", path: "/api/tones", operation: "tone", denial: "local-catalog", guard: "beginGeneration", test: "tones stay local when spend is closed" },
];

/** Not a generation bill. Left unmetered on purpose and reported as a gap. */
export const UNMETERED_CORE = [{ method: "GET", path: "/api/health", note: "pings /health with no body; not a generation" }] as const;
