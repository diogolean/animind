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
export const CONTRACT_VERSION = "v2" as const;

/** Rig layers of one view. Mouth shapes live in `CharacterView.visemes`. */
export type LayerName = "body" | "head" | "hair" | "brows" | "eyes" | "eyes_closed" | "nose" | "accessory";

/** Rhubarb Lip Sync mouth shapes (A–H + X = rest), as emitted by the core. */
export const VISEMES = ["X", "A", "B", "C", "D", "E", "F", "G", "H"] as const;
export type Viseme = (typeof VISEMES)[number];

export const VIEWS = ["front", "left", "right"] as const;
export type ViewName = (typeof VIEWS)[number];

/** One cut-out image, positioned in the view's own canvas space. */
export interface Layer {
  name: LayerName | string;
  /** PNG/SVG URL (absolute, relative or data:). */
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

/** One camera angle of the character: its layers plus the full viseme set. */
export interface CharacterView {
  canvas: { w: number; h: number };
  layers: Layer[];
  /** Mouth sprite per viseme, drawn at its own box (z above head). Missing -> falls back to "X". */
  visemes: Partial<Record<Viseme, Layer>>;
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
}

export interface Character {
  id: string;
  name: string;
  /** "placeholder": the core has not produced the rig yet (or the app runs on the mock). */
  status: "ready" | "placeholder";
  style: "rig" | "cutout";
  /** Real core format: front, left and right views, each with layers + visemes. */
  views: Record<ViewName, CharacterView>;
  /** Photo cut-out (Monty-Python style); used instead of views when present. */
  photo?: PhotoRig;
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
  /** Rhubarb visemes, `t` in seconds from the start of the track; absent -> derived from audio. */
  visemes?: { t: number; v: Viseme }[];
  /** Camera view for the speaker during this line; absent -> renderer picks one. */
  view?: ViewName;
  /** "quote": `text` is a real quote copied from the persona sheet (see `quote`). "paraphrase": written for the scene. */
  kind?: "quote" | "paraphrase";
  /** Script beat: gancho, tese, réplica, tréplica, fechamento; lesson: ponto 1..3, exemplo, resumo. */
  beat?: string;
  quote?: QuoteRef;
  /** The quote a paraphrase restates, when the writer said so. */
  basis?: { id: string; source: string; url: string };
}

/** A literal quote with its source (Wikiquote page; Wikisource when the page links one). */
export interface QuoteRef {
  id: string;
  text: string;
  source: string;
  url: string;
  site?: string;
  wikisource?: string;
}

export interface PersonaSheet {
  name: string;
  found: boolean;
  wikiquote?: string | null;
  wikipedia?: string | null;
  quotes: number;
  license?: string | null;
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
  /** Who wrote the lines: "gemini" (picks quote ids + writes paraphrases) or "template". */
  writer?: "gemini" | "template";
  topic?: string;
  personas?: PersonaSheet[];
}

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface RenderJob {
  id: string;
  status: JobStatus;
  /** 0..1, as the core reports it (the UI shows it as a percentage). */
  progress: number;
  result?: RenderResult;
  error?: string;
}

export const PARODY_DISCLAIMER = "Paródia • Gerado por IA";

export interface ApiError {
  error: string;
}
