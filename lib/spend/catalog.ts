/**
 * Every request this app can make that might touch a provider.
 * A read does not reserve money and does not receive invented tokens.
 * The effective model id comes from response metadata, never from an env guess.
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
  | "tone"
  | "health";

export type SpendClass = "generation" | "read";

export interface SpendPath {
  method: "GET" | "POST";
  path: string;
  operation: SpendOperation;
  class: SpendClass;
  /** What a denied or unbilled call does. */
  denial: "local-rules" | "local-catalog" | "http-deny" | "unbilled-read";
  guard: "beginGeneration" | "guardedRead" | "none";
  meter: "reservation" | "none";
  test: string;
}

export const SPEND_PATHS: readonly SpendPath[] = [
  { method: "POST", path: "/api/plan", operation: "plan", class: "generation", denial: "local-rules", guard: "beginGeneration", meter: "reservation", test: "plan denial never calls the core" },
  { method: "POST", path: "/api/render", operation: "render", class: "generation", denial: "http-deny", guard: "beginGeneration", meter: "reservation", test: "render denial and a blocked retry make zero extra provider calls" },
  { method: "POST", path: "/api/preview", operation: "preview", class: "generation", denial: "http-deny", guard: "beginGeneration", meter: "reservation", test: "preview route is guarded" },
  { method: "POST", path: "/api/characters", operation: "character", class: "generation", denial: "http-deny", guard: "beginGeneration", meter: "reservation", test: "character route is guarded" },
  { method: "POST", path: "/api/scenarios", operation: "scenario", class: "generation", denial: "http-deny", guard: "beginGeneration", meter: "reservation", test: "scenario route is guarded" },
  { method: "POST", path: "/api/personas/deep", operation: "persona_deep", class: "generation", denial: "http-deny", guard: "beginGeneration", meter: "reservation", test: "persona deep write is guarded" },
  { method: "GET", path: "/api/personas/deep", operation: "persona_deep", class: "generation", denial: "http-deny", guard: "beginGeneration", meter: "reservation", test: "persona deep read can start core work, so it stays priced" },
  { method: "GET", path: "/api/personas/sheet", operation: "persona_sheet", class: "read", denial: "unbilled-read", guard: "none", meter: "none", test: "the core labeled fixture sheet is an unbilled read" },
  { method: "GET", path: "/api/jobs/:id", operation: "job", class: "read", denial: "unbilled-read", guard: "guardedRead", meter: "none", test: "job polling does not reserve or retry a generation" },
  { method: "GET", path: "/api/files/*", operation: "file", class: "read", denial: "unbilled-read", guard: "guardedRead", meter: "none", test: "file download does not reserve a generation" },
  { method: "GET", path: "/api/voices", operation: "voice", class: "read", denial: "local-catalog", guard: "none", meter: "none", test: "voices stay local and never call the core" },
  { method: "GET", path: "/api/tones", operation: "tone", class: "read", denial: "local-catalog", guard: "none", meter: "none", test: "tones stay local and never call the core" },
  { method: "GET", path: "/api/health", operation: "health", class: "read", denial: "unbilled-read", guard: "none", meter: "none", test: "health is classified and not billed" },
];

/**
 * Names hardcoded on Omni-Engine branch feat/animind-core-api.
 * That branch is not the default branch. These are not prices and not the live model.
 */
export const CORE_BRANCH_MODELS = [
  { provider: "deepseek", model: "deepseek-flash", where: "products/animind_core/llm_providers.py DEEPSEEK_MODEL", note: "default writer; DEEPSEEK_MODEL can override it on that process" },
  { provider: "google", model: "gemini-3.5-flash-lite", where: "products/animind_core/llm_providers.py GEMINI_MODEL", note: "writer fallback on that branch" },
  { provider: "together", model: "Qwen/Qwen-Image", where: "products/animind_core/image_models.py together-qwen-image", note: "default image id on that branch" },
  { provider: "gemini", model: "gemini-2.5-flash-image", where: "products/animind_core/image_models.py nano-banana", note: "image option on that branch" },
  { provider: "together", model: "black-forest-labs/FLUX.1-kontext-pro", where: "products/animind_core/image_models.py DEFAULT_EDIT_MODEL", note: "edit option on that branch" },
] as const;
