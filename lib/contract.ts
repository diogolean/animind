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
export type LayerName =
  // torso + neck + mouthless head (core v4); "body" is the older single torso layer
  | "body" | "torso" | "neck" | "head" | "hair" | "brows" | "eyes" | "eyes_closed" | "nose" | "accessory"
  // movable eyes (core v3): sclera without iris, iris discs, the eye opening they are clipped to, half lids
  | "eye_white" | "iris" | "eye_socket" | "eyes_half";

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
  /** Movable eyes: max iris travel (canvas px) and iris circles [cx, cy, r]. */
  eyeRig?: { maxShift: [number, number]; irises: [number, number, number][] };
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

/** Animation style: feeds the Gemini character prompt and the scene look (palette, grade, backgrounds). */
export type ArtStyle = "ghibli" | "cartoon" | "anime" | "retro" | "realista" | "cyberpunk" | "aquarela";

export const ART_STYLES: { id: ArtStyle; label: string }[] = [
  { id: "ghibli", label: "Ghibli retrô" },
  { id: "cartoon", label: "Cartoon" },
  { id: "anime", label: "Anime" },
  { id: "retro", label: "Retrô" },
  { id: "realista", label: "Realista" },
  { id: "cyberpunk", label: "Cyberpunk" },
  { id: "aquarela", label: "Aquarela" },
];

/** Stick figures are the MVP path; illustrated characters use the Aiwake factory. */
export type CharacterType = "stick" | "illustrated";

export interface CreateCharacterRequest {
  source: CharacterSource;
  /** Display/persona name, kept separate from the visual prompt. */
  name?: string;
  /** MVP defaults to a lightweight stick figure. */
  characterType?: CharacterType;
  /** Drawing style for generated (prompt) characters. Default ghibli. */
  artStyle?: ArtStyle;
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
  /** One image with every viseme (X, A–H + phonemes) and eye state per view, for a human check. */
  reviewSheetUrl?: string;
  /** Style the character was drawn in (core rigs). */
  artStyle?: ArtStyle;
  characterType?: CharacterType;
  /** Side (3/4) art and the real front view (Gemini, side as reference), when the core drew one. */
  imageUrl?: string;
  frontImageUrl?: string | null;
  /** Voice override for this character (else the core casts one from the persona). */
  voice?: VoicePick;
  /** Who drew the art (core rigs): "gemini", or "mock" when there is no key or no credit. */
  generator?: "gemini" | "mock";
  /** Why the art is mock (e.g. "Gemini indisponível: 402 ..."); null when Gemini drew it. */
  generatorNote?: string | null;
  /** true when the core returned a saved, QA-approved rig of the same persona instead of drawing a new one. */
  reused?: boolean;
  createdAt: string;
}

/** Output frame: 16:9 (1280x720) or vertical 9:16 (1080x1920, shot/countershot). */
export type VideoFormat = "16:9" | "9:16";

/** quick: key-term inference + shallow cached RAG; deep: background per-character RAG over full texts. */
export type PersonaMode = "quick" | "deep";

export interface DeepStatus {
  name: string;
  lang: string;
  status: "ready" | "building" | "failed" | "missing";
  chunks?: number;
  counts?: Record<string, number>;
  error?: string;
}

export interface VoicePick {
  voice: string;
  /** Human name of the voice (e.g. "Rémy"); each speaker in a scene gets a different voice. */
  label?: string;
  pitchHz?: number;
  ratePct?: number;
  /** true when the core picked it from the persona. */
  auto?: boolean;
  traits?: { gender: "m" | "f"; born?: number | null; age: string; temper: string };
}

export type LanguageCode = "en-US" | "pt-BR" | (string & {});
export type VoiceGender = "male" | "female";

export interface VoiceOption {
  id: string;
  label: string;
  language: LanguageCode;
  gender: VoiceGender;
  previewUrl?: string;
}

export interface VoiceLanguage {
  id: LanguageCode;
  nativeName: string;
  englishName: string;
  flag?: string;
}

export interface VoiceCatalog {
  voices: VoiceOption[];
  defaultByGender: Record<VoiceGender, string>;
  /** Locales advertised by GET /v1/voices, or the complete edge-tts fallback. */
  languages: VoiceLanguage[];
  source: "core" | "fallback";
}

export type SceneTemplate = "debate" | "lesson" | "solo";
export type Scenario = "studio" | "classroom" | "arena" | "space" | "agora";
export type CreationMode = "monologue" | "dialogue" | "debate";
/** Product-facing tone ids; adapters map these to the ids advertised by the core. */
export type Tone = "humor" | "terror" | "educacional" | "sabio" | "serio";
export type Objective = "ensinar" | "debater" | "entreter" | "convencer";
export type Narrative = "direto" | "historia" | "aula" | "debate";

export interface CatalogOption<T extends string> {
  id: T;
  label: string;
}

export interface ToneOption extends CatalogOption<Tone> {
  /** Actual id accepted by the connected core. */
  coreId: string;
  /** True when the product tone is approximated by another core tone. */
  fallback: boolean;
}

export interface ToneCatalog {
  tones: ToneOption[];
  default: Tone;
  source: "core" | "fallback";
}

/**
 * Contract reserved for a future core scenario generator.
 * Until `/v1/scenarios` exists, the app resolves a prompt to a built-in set.
 */
export type ScenarioRequest =
  | { mode: "auto"; characterNames: string[] }
  | { mode: "prompt"; prompt: string; characterNames: string[] };

export interface ScenarioResolution {
  scenario: Scenario;
  source: "core" | "era" | "fallback";
  prompt?: string;
  note?: string;
}

export interface CreationPlanCharacter {
  name: string;
  prompt: string;
  /** Used for automatic casting; voiceId absent means pick from this gender. */
  gender?: VoiceGender;
  voiceId?: string;
}

/** Prompt-to-controls contract, ready for a future POST /v1/plan planner. */
export interface CreationPlan {
  prompt: string;
  language: LanguageCode;
  mode: CreationMode;
  characters: CreationPlanCharacter[];
  topic: string;
  tone: Tone;
  objective: Objective;
  artStyle: ArtStyle;
  characterType: CharacterType;
  scenarioRequest: ScenarioRequest;
  scenarioLabel: string;
  duration: 30 | 60 | 90;
  source: "core" | "local";
}

export interface CreationPlanRequest {
  prompt: string;
  language?: LanguageCode;
  /** Legacy alias accepted by the app adapter. */
  lang?: LanguageCode;
}

export interface RenderRequest {
  /** 1 character for a monologue, 2+ for dialogue. */
  characters: Character[];
  template: SceneTemplate;
  scenario: Scenario;
  topic?: string;
  /** Preferred field for the core; the app also sends `lang` to older cores. */
  language?: LanguageCode;
  lang?: LanguageCode;
  format?: VideoFormat;
  /** Per-speaker voice override; null/absent entries are cast automatically. */
  voices?: (VoicePick | null)[];
  /** Knowledge depth behind written lines (quotes stay verbatim either way). Default quick. */
  personaMode?: PersonaMode;
  /** Scene look; defaults to the first character's artStyle. */
  style?: ArtStyle;
  /** Script tone from GET /v1/tones. */
  tone?: Tone;
  /** Intended result of the script; additive until the core consumes it. */
  objective?: Objective;
  /** Whether the client inferred the controls or received explicit choices. */
  configurationSource?: "automatic" | "manual";
  /** Desired narrative shape and free direction for the writer. */
  narrative?: Narrative;
  scriptPrompt?: string;
  /** Target requested by the UI; the current core may adjust it to the spoken script. */
  targetDurationSec?: 30 | 60 | 90;
  /** Original scenario choice, retained while the core only accepts built-in scenario ids. */
  scenarioRequest?: ScenarioRequest;
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
  /** Script beat. Debate: gancho, tese, réplica, virada, tréplica, fechamento; lesson: gancho, pergunta, citação, exemplo, virada, síntese (a written idea line is "ideia", never "citação"). */
  beat?: string;
  /** Debate act: abertura (hook), confronto (clash), virada (the turn, mid-video), fechamento (close). */
  act?: "abertura" | "confronto" | "virada" | "fechamento" | string;
  /** Debate: the line this one answers and the idea (word, or "a~b" related concepts) it picks up from it. */
  replyTo?: { line: number; idea: string };
  quote?: QuoteRef;
  /** The quote a paraphrase restates, when the writer said so. */
  basis?: { id: string; source: string; label?: string; url: string };
}

/** A literal quote with its source (Wikiquote page; Wikisource when the page links one). */
export interface QuoteRef {
  id: string;
  text: string;
  source: string;
  /** Short on-screen source (no pages, translators or publishers); `source` stays complete. */
  label?: string;
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
  /**
   * Script self-check, every template. `problems` fail it: a quote not literally in the speaker's sheet (invented,
   * or paraphrased but shown as literal), a wrong source or link, a written line that claims literal wording, and the
   * arc (debate: alternation, replies, hook, turn, memorable close; lesson: hook, question, quote, turn, synthesis).
   * `notes` are soft style remarks.
   */
  scriptQA?: { pass: boolean; problems: string[]; notes?: string[] };
  topic?: string;
  personas?: PersonaSheet[];
  format?: VideoFormat;
  width?: number;
  height?: number;
  /** Voice used per speaker. */
  voices?: VoicePick[];
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
