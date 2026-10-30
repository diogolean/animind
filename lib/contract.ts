/**
 * Animind <-> Omni-Engine core HTTP contract (v1).
 *
 * The core (Aiwake character factory + Rigly scene engine) lives in
 * github.com/diogolean/Omni-Engine and is never copied here. The Next.js
 * routes under app/api proxy to `${CORE_URL}/v1/*` when CORE_URL is set, and
 * fall back to a self-contained mock (lib/mock.ts) otherwise.
 *
 *   POST /api/characters   CreateCharacterRequest -> Character
 *   POST /api/render       RenderRequest          -> RenderJob (status "queued")
 *   GET  /api/jobs/:id                            -> RenderJob
 */
export const CONTRACT_VERSION = "v1" as const;

export type LayerName =
  | "body"
  | "head"
  | "brows"
  | "eyes"
  | "eyes_closed"
  | "mouth_rest"
  | "mouth_A"
  | "mouth_E"
  | "mouth_O"
  | "mouth_M";

export const VISEMES = ["mouth_rest", "mouth_A", "mouth_E", "mouth_O", "mouth_M"] as const;
export type Viseme = (typeof VISEMES)[number];

/** One cut-out layer, positioned in the character's own canvas space. */
export interface Layer {
  name: LayerName;
  /** PNG/SVG URL (absolute, relative or data:). */
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface Attribution {
  title: string;
  author: string;
  license: string;
  sourceUrl: string;
}

/** Monty-Python style cut-out: a photo whose jaw box moves with the audio. */
export interface PhotoRig {
  url: string;
  /** Jaw box, as fractions (0..1) of the image. */
  jaw: { x: number; y: number; w: number; h: number };
  attribution?: Attribution;
}

export type CharacterSource =
  | { kind: "prompt"; prompt: string }
  | { kind: "catalog"; portraitId: string }
  | { kind: "upload"; imageDataUrl: string; name?: string; rightsConfirmed: true };

export interface CreateCharacterRequest {
  source: CharacterSource;
  style?: "cartoon" | "cutout";
}

export interface Character {
  id: string;
  name: string;
  style: "cartoon" | "cutout";
  canvas: { w: number; h: number };
  /** Cartoon rig layers (empty for pure photo cut-outs). */
  layers: Layer[];
  photo?: PhotoRig;
  palette?: { primary: string; accent: string };
  createdAt: string;
}

export type SceneTemplate = "debate" | "lesson" | "solo";
export type Scenario = "studio" | "classroom" | "arena" | "space";

export interface RenderRequest {
  /** 1 character for solo/lesson, 2 for debate (the core may generate a rival). */
  characters: Character[];
  template: SceneTemplate;
  scenario: Scenario;
  topic?: string;
  lang?: "pt-BR" | "en-US";
}

export interface ScriptLine {
  /** Index into RenderRequest.characters. */
  speaker: number;
  text: string;
  startMs: number;
  endMs: number;
  /** Optional Rhubarb-style visemes; absent -> client derives from audio. */
  visemes?: { t: number; v: Viseme }[];
}

export interface RenderResult {
  template: SceneTemplate;
  scenario: Scenario;
  characters: Character[];
  script: ScriptLine[];
  durationMs: number;
  /** TTS track; null -> client synthesizes a placeholder voice. */
  audioUrl: string | null;
  /** Server "high quality" render (optional, from the VM worker). */
  videoUrl: string | null;
  disclaimer: string;
}

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface RenderJob {
  id: string;
  status: JobStatus;
  progress: number;
  result?: RenderResult;
  error?: string;
}

export const PARODY_DISCLAIMER = "Paródia • Gerado por IA";

export interface ApiError {
  error: string;
}
