import type { AvatarAnchorReport, AvatarAttempt, AvatarEventRecord, AvatarJobState, AvatarOutcome, AvatarProgressStage, AvatarReview, AvatarSceneryReport, CharacterView, CoreUsageView, Layer, Viseme } from "./contract";
import { VISEMES } from "./contract";
import { AVATAR_PROGRESS_STAGES } from "./contract";

/** Browser key for the poll id. It does not start a job and it is not a generate flag. */
export const AVATAR_POLL_KEY = "animindly-avatar-poll";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const CORE_IDENTITY = /^[A-Za-z0-9_-]{8,80}$/;
const ALLOWED_ERROR = new Set(["generation_not_authorized", "price_unavailable", "qa_rejected", "avatar_not_found", "login"]);
const LEAK = /@|\/|\\|gemini|deepseek|openai|birefnet|api[_-]?key|secret|users\/|provider|costUsd|token/i;

export function avatarTransport(mode: "core" | "mock" | "off"): "core" | "fixture" {
  return mode === "core" ? "core" : "fixture";
}

/** Reload and reconnect use GET. A missing or unsafe id does not create a job. */
export function avatarReconnect(requestId: string | null | undefined): { method: "GET"; path: string } | null {
  const id = requestId?.trim() ?? "";
  if (!ID.test(id)) return null;
  return { method: "GET", path: `/api/avatars?requestId=${encodeURIComponent(id)}` };
}

export function rememberAvatarPoll(storage: { setItem(key: string, value: string): void }, requestId: string): void {
  if (avatarReconnect(requestId)) storage.setItem(AVATAR_POLL_KEY, requestId);
}

export function rememberedAvatarPoll(storage: { getItem(key: string): string | null }): string | null {
  const value = storage.getItem(AVATAR_POLL_KEY);
  return avatarReconnect(value) ? value : null;
}

/** Core stage names that already exist. "QA" is the core's spelling of qa. Anything else is dropped. */
export function mapCoreStage(stage: unknown): AvatarProgressStage | null {
  if (stage === "QA") return "qa";
  if (typeof stage === "string" && (AVATAR_PROGRESS_STAGES as readonly string[]).includes(stage)) return stage as AvatarProgressStage;
  return null;
}

export function sanitizeAvatarError(error: unknown): { code: string; recoverable: boolean } | null {
  if (!error || typeof error !== "object") return null;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  if (!ALLOWED_ERROR.has(code) || LEAK.test(code)) return null;
  return { code, recoverable: "recoverable" in error && error.recoverable === true };
}

export function avatarMissBody(): { error: "Pedido não encontrado" } {
  return { error: "Pedido não encontrado" };
}

/**
 * Identity the core requires on a paid `POST /v1/avatars`.
 * Both values are 8–80 URL-safe characters and stay the same for the same body.
 */
export function coreAvatarIdentity(body: string): { "idempotency-key": string; "x-request-id": string } {
  let hash = 5381;
  for (let i = 0; i < body.length; i += 1) hash = ((hash << 5) + hash + body.charCodeAt(i)) >>> 0;
  const hex = hash.toString(16).padStart(8, "0");
  const key = `coreav_${hex}`;
  const requestId = `corereq_${hex}`;
  if (!CORE_IDENTITY.test(key) || !CORE_IDENTITY.test(requestId)) throw new Error("core identity");
  return { "idempotency-key": key, "x-request-id": requestId };
}

export function promptForCore(prompt: string, names: string[]): string {
  const base = prompt.trim();
  const extra = names.filter((name) => {
    const clean = name.trim();
    if (!clean || clean.length > 80 || LEAK.test(clean)) return false;
    return !base.toLowerCase().includes(clean.toLowerCase());
  });
  if (!extra.length) return base;
  return `${base}\n${extra.join(", ")}`;
}

function safeName(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.trim();
  if (!name || name.length > 80 || LEAK.test(name)) return "";
  return name;
}

function participantRows(payload: Record<string, unknown>): { id: string; name: string; status: string }[] {
  if (!Array.isArray(payload.participants)) return [];
  return payload.participants.slice(0, 4).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { name?: unknown; status?: unknown; idempotency?: unknown };
    const name = safeName(row.name);
    if (!name) return [];
    const id = typeof row.idempotency === "string" && /^[a-f0-9]{8,64}$/.test(row.idempotency) ? row.idempotency : `p${index}`;
    const status = typeof row.status === "string" && /^[a-z_]{1,32}$/.test(row.status) ? row.status : "blocked";
    return [{ id, name, status }];
  });
}

function liveImage(payload: Record<string, unknown>): boolean {
  return payload.liveImage === true;
}

function fixtureLabel(payload: Record<string, unknown>): boolean {
  if (liveImage(payload)) return false;
  return true;
}

export function coreEvents(payload: unknown, participants: { id: string }[], requestId: string, fixture: boolean): AvatarEventRecord[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { events?: unknown }).events)) return [];
  const events = (payload as { events: unknown[] }).events;
  const out: AvatarEventRecord[] = [];
  for (const item of events) {
    if (!item || typeof item !== "object") continue;
    const row = item as { stage?: unknown; participant?: unknown; requestId?: unknown };
    const stage = mapCoreStage(row.stage);
    if (!stage) continue;
    if (typeof row.requestId === "string" && row.requestId !== requestId) continue;
    if (row.participant == null) {
      const indexes = participants.length ? participants.map((_, index) => index) : [0];
      for (const index of indexes) out.push({ index, stage, fixture });
      continue;
    }
    if (typeof row.participant !== "string") continue;
    const index = participants.findIndex((person) => person.id === row.participant);
    if (index >= 0) out.push({ index, stage, fixture });
  }
  return out;
}

function latestStage(events: AvatarEventRecord[], index: number, fallback: AvatarProgressStage): AvatarProgressStage {
  let stage = fallback;
  for (const event of events) {
    if (event.index === index) stage = event.stage;
  }
  return stage;
}

/** Maps one core poll body onto the attempt the page can show. Drops telemetry, paths, and percents. */
export function mapCoreAvatar(payload: unknown, ownerId: string): AvatarAttempt | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const requestId = typeof body.requestId === "string" ? body.requestId : typeof body.id === "string" ? body.id : "";
  if (!ID.test(requestId) || !ID.test(ownerId)) return null;
  const people = participantRows(body);
  if (!people.length) return null;
  const fixture = fixtureLabel(body);
  const events = coreEvents(body, people, requestId, fixture);
  const ready = people.filter((person) => person.status === "ready").length;
  const outcome: AvatarOutcome = body.status === "partial" || (ready > 0 && ready < people.length) ? "partial" : "blocked";
  const error = (Array.isArray(body.events) ? body.events : []).map((item) => (
    item && typeof item === "object" ? sanitizeAvatarError((item as { error?: unknown }).error) : null
  )).find((item) => item);
  const code = error?.code === "price_unavailable"
    ? "price_unavailable"
    : error?.code === "generation_not_authorized"
      ? "generation_not_authorized"
      : "avatar_provider_unavailable";
  const jobs: AvatarJobState[] = people.map((person, index) => ({
    id: person.id,
    index,
    name: person.name,
    stage: latestStage(events, index, person.status === "ready" ? "ready" : "plan"),
    disposition: person.status === "cancelled" ? "cancelled" : "blocked",
    fixture,
    actual: null,
    qa: null,
    rig: null,
  }));
  const reportedCalls = typeof body.providerCalls === "number" && Number.isFinite(body.providerCalls) && body.providerCalls > 0 ? body.providerCalls : 0;
  return {
    requestId,
    ownerId,
    outcome,
    code,
    cost: "unknown",
    fixture,
    transport: "core",
    providerCalls: reportedCalls,
    providerFunction: null,
    usage: presentCoreUsage(body),
    jobs,
    events,
    keepsDraft: true,
  };
}

const COUNT = (value: unknown, max: number): number | null => (
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max ? value : null
);

function microIsUnknown(value: unknown): boolean {
  return value == null || value === 0;
}

/** Counts from `animind.usage.v1`. Model names, hashes, and money amounts stay on the server. */
export function presentCoreUsage(payload: unknown): CoreUsageView | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { providerCalls?: unknown; usage?: unknown };
  if (!body.usage || typeof body.usage !== "object") return null;
  const usage = body.usage as { schema?: unknown; calls?: unknown; totals?: unknown };
  if (usage.schema !== "animind.usage.v1") return null;
  const totals = usage.totals && typeof usage.totals === "object"
    ? usage.totals as { calls?: unknown; estimatedMicro?: unknown; reportedMicro?: unknown }
    : {};
  if (!microIsUnknown(totals.estimatedMicro) || !microIsUnknown(totals.reportedMicro)) return null;
  const calls = Array.isArray(usage.calls) ? usage.calls : [];
  const attempts = COUNT(totals.calls, 100) ?? Math.min(calls.length, 100);
  const providerCalls = COUNT(body.providerCalls, 100) ?? 0;
  return { attempts, providerCalls, cost: "unknown" };
}

export function coreNeedsChoice(payload: unknown): boolean {
  return Boolean(payload && typeof payload === "object" && (payload as { status?: unknown }).status === "needs_choice");
}

const DEFECT = /^[a-z0-9_]{1,80}$/;
const VIEW_KEY = /^[a-z0-9_]{1,40}$/;
const LAYER_URL = /^\/api\/files\/[A-Za-z0-9_./%-]{1,240}$/;
const DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]{8,180000}$/;

function boxInt(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function pair(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const x = typeof value[0] === "number" && Number.isFinite(value[0]) ? value[0] : null;
  const y = typeof value[1] === "number" && Number.isFinite(value[1]) ? value[1] : null;
  if (x == null || y == null) return undefined;
  return [x, y];
}

function safeLayerUrl(url: string): boolean {
  if (/secret|api[_-]?key/i.test(url)) return false;
  if (DATA_URL.test(url)) return !/users\//i.test(url);
  return LAYER_URL.test(url) && !url.includes("..");
}

function coreLayer(value: unknown): Layer | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { name?: unknown; url?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown; z?: unknown };
  const name = typeof row.name === "string" && VIEW_KEY.test(row.name) ? row.name : "";
  const url = typeof row.url === "string" ? row.url : "";
  const x = boxInt(row.x, -8192, 8192);
  const y = boxInt(row.y, -8192, 8192);
  const w = boxInt(row.w, 1, 8192);
  const h = boxInt(row.h, 1, 8192);
  const z = boxInt(row.z, 0, 100);
  if (!name || !safeLayerUrl(url) || x == null || y == null || w == null || h == null || z == null) return null;
  return { name, url, x, y, w, h, z };
}

function coreView(value: unknown): { view: CharacterView; anchor: Omit<AvatarAnchorReport, "view"> } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { canvas?: unknown; layers?: unknown; visemes?: unknown; expressions?: unknown; eyeRig?: unknown; mouthQA?: unknown; anchors?: unknown };
  const canvas = row.canvas && typeof row.canvas === "object" ? row.canvas as { w?: unknown; h?: unknown } : null;
  const w = boxInt(canvas?.w, 1, 8192);
  const h = boxInt(canvas?.h, 1, 8192);
  if (w == null || h == null || !Array.isArray(row.layers)) return null;
  const layers = row.layers.slice(0, 24).map(coreLayer).filter((layer): layer is Layer => Boolean(layer));
  if (!layers.length) return null;
  const visemes: CharacterView["visemes"] = {};
  if (row.visemes && typeof row.visemes === "object") {
    for (const key of VISEMES) {
      const layer = coreLayer((row.visemes as Record<string, unknown>)[key]);
      if (layer) visemes[key as Viseme] = layer;
    }
  }
  const expressions: Record<string, Layer> = {};
  if (row.expressions && typeof row.expressions === "object") {
    for (const [key, item] of Object.entries(row.expressions as Record<string, unknown>).slice(0, 12)) {
      if (!VIEW_KEY.test(key)) continue;
      const layer = coreLayer(item);
      if (layer) expressions[key] = layer;
    }
  }
  const eye = row.eyeRig && typeof row.eyeRig === "object" ? row.eyeRig as { maxShift?: unknown; irises?: unknown } : null;
  const shift = pair(eye?.maxShift);
  const irises = Array.isArray(eye?.irises)
    ? eye.irises.slice(0, 4).flatMap((item) => {
      if (!Array.isArray(item) || item.length !== 3) return [];
      const circle = item.filter((part): part is number => typeof part === "number" && Number.isFinite(part));
      return circle.length === 3 ? [circle as [number, number, number]] : [];
    })
    : [];
  const mouth = row.mouthQA && typeof row.mouthQA === "object" ? (row.mouthQA as { anchor?: unknown }).anchor : null;
  const mouthAnchor = mouth && typeof mouth === "object" ? mouth as { x?: unknown; y?: unknown; nose?: unknown; chin?: unknown; view?: unknown; along?: unknown; moustacheBottom?: unknown } : null;
  const published = row.anchors && typeof row.anchors === "object" && (row.anchors as { coordinateSpace?: unknown }).coordinateSpace === "canvas_px"
    ? row.anchors as { mouth?: unknown; eyes?: unknown; neck?: unknown; head?: unknown; torso?: unknown }
    : null;
  const mouthPoint = pair(published?.mouth);
  const eyePoints = Array.isArray(published?.eyes) ? published.eyes.flatMap((item) => pair(item) ? [item] : []) : [];
  const neck = pair(published?.neck);
  const head = pair(published?.head);
  const torso = pair(published?.torso);
  const mouthX = typeof mouthAnchor?.x === "number" && Number.isFinite(mouthAnchor.x) ? mouthAnchor.x : mouthPoint?.[0] ?? null;
  const mouthY = typeof mouthAnchor?.y === "number" && Number.isFinite(mouthAnchor.y) ? mouthAnchor.y : mouthPoint?.[1] ?? null;
  const nose = pair(mouthAnchor?.nose);
  const chin = pair(mouthAnchor?.chin);
  const view: CharacterView = {
    canvas: { w, h },
    layers,
    visemes,
    ...(Object.keys(expressions).length ? { expressions } : {}),
    ...(shift && irises.length ? { eyeRig: { maxShift: shift, irises } } : {}),
  };
  return {
    view,
    anchor: {
      mouth: mouthX != null && mouthY != null,
      eyes: Boolean(shift && irises.length) || eyePoints.length > 0,
      ...(neck ? { neck } : {}),
      ...(head ? { head } : {}),
      ...(torso ? { torso } : {}),
      ...(mouthX != null && mouthY != null ? {
        mouthAnchor: {
          x: mouthX,
          y: mouthY,
          ...(nose ? { nose } : {}),
          ...(chin ? { chin } : {}),
          ...(typeof mouthAnchor?.view === "string" && VIEW_KEY.test(mouthAnchor.view) ? { view: mouthAnchor.view } : {}),
          ...(typeof mouthAnchor?.along === "number" && Number.isFinite(mouthAnchor.along) ? { along: mouthAnchor.along } : {}),
          ...(typeof mouthAnchor?.moustacheBottom === "number" && Number.isFinite(mouthAnchor.moustacheBottom) ? { moustacheBottom: mouthAnchor.moustacheBottom } : {}),
        },
      } : {}),
    },
  };
}

function reportedMicro(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 1_000_000_000 ? value : null;
}

/** A null, missing, or zero core total stays unknown. A positive micro-USD is the core's figure. */
export function coreSpendMicro(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const body = usage as { schema?: unknown; totals?: unknown };
  if (body.schema !== "animind.usage.v1" || !body.totals || typeof body.totals !== "object") return null;
  const totals = body.totals as { reportedMicro?: unknown; estimatedMicro?: unknown };
  return reportedMicro(totals.reportedMicro) ?? reportedMicro(totals.estimatedMicro);
}

/**
 * `animind.puppet.v3` from Omni-Engine 14dcc109.
 * `review_required`, a defect, or `ready: false` never becomes a ready avatar.
 */
export function mapPuppetAvatar(payload: unknown, ownerId: string): AvatarAttempt | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  if (body.schema !== "animind.puppet.v3") return null;
  const requestId = typeof body.id === "string" ? body.id : "";
  if (!ID.test(requestId) || !ID.test(ownerId)) return null;
  const defects = Array.isArray(body.defects)
    ? [...new Set(body.defects.filter((item): item is string => typeof item === "string" && DEFECT.test(item)))].sort()
    : [];
  const coreSaysReady = body.status === "ready" && body.ready === true && body.review_required !== true && defects.length === 0;
  const review: AvatarReview = {
    status: coreSaysReady ? "ready" : "review_required",
    ready: coreSaysReady,
    defects,
  };
  const views: Record<string, CharacterView> = {};
  const anchors: AvatarAnchorReport[] = [];
  if (body.views && typeof body.views === "object") {
    for (const [key, item] of Object.entries(body.views as Record<string, unknown>)) {
      if (!VIEW_KEY.test(key)) continue;
      const mapped = coreView(item);
      if (!mapped) continue;
      views[key] = mapped.view;
      anchors.push({ view: key, ...mapped.anchor });
    }
  }
  const scenario = body.scenario && typeof body.scenario === "object"
    ? body.scenario as { embedded?: unknown; control?: unknown; states?: unknown }
    : {};
  const embedded = scenario.embedded === true;
  const states = Array.isArray(scenario.states)
    ? scenario.states.filter((item): item is "on" | "off" => item === "on" || item === "off")
    : [];
  const scenery: AvatarSceneryReport = {
    embedded,
    separate: scenario.embedded === false,
    control: typeof scenario.control === "string" && /^[a-z-]{1,24}$/.test(scenario.control) ? scenario.control : null,
    states,
  };
  const name = safeName(body.name) || "person";
  const fixture = !(body.provenance && typeof body.provenance === "object" && (body.provenance as { realImage?: unknown }).realImage === true);
  const jobs: AvatarJobState[] = [{
    id: requestId,
    index: 0,
    name,
    stage: review.ready ? "ready" : "qa",
    disposition: "blocked",
    fixture,
    actual: null,
    qa: null,
    rig: null,
  }];
  const outcome: AvatarOutcome = "blocked";
  return {
    requestId,
    ownerId,
    outcome,
    code: review.ready ? "core_ready" : "review_required",
    transport: "core",
    cost: "unknown",
    fixture,
    providerCalls: 0,
    providerFunction: null,
    usage: presentCoreUsage(body),
    coreMicro: coreSpendMicro(body),
    review,
    views,
    anchors,
    scenery,
    jobs,
    events: [{ index: 0, stage: review.ready ? "ready" : "qa", fixture }],
    keepsDraft: !review.ready,
  };
}

/** A core status that is not the owner's job becomes a fixed 404. The payload is not copied. */
export function presentCorePayload(status: number, payload: unknown, ownerId: string): { status: number; body: AvatarAttempt | { error: string; code?: string } } {
  if (status === 404 || payload == null) return { status: 404, body: avatarMissBody() };
  if (status !== 200) {
    const error = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : "";
    if (error === "admin" || error === "login") return { status: 403, body: { error: "Esta conta ainda não pode gerar", code: "unapproved" } };
    if (error === "spend:approval") return { status: 403, body: { error: "O núcleo não aprovou este gasto", code: "approval" } };
    if (error === "spend:price_unavailable") return { status: 403, body: { error: "Preço desta chamada não está publicado", code: "price_unavailable" } };
    if (error === "spend:credential" || error === "spend:over_cap") return { status: 503, body: { error: "Geração indisponível", code: "unavailable" } };
    return { status: status === 403 ? 403 : 502, body: avatarMissBody() };
  }
  const puppet = mapPuppetAvatar(payload, ownerId);
  if (puppet) return { status: 200, body: puppet };
  if (coreNeedsChoice(payload)) return { status: 400, body: { error: "O plano do avatar está incompleto", code: "avatar_incomplete" } };
  const mapped = mapCoreAvatar(payload, ownerId);
  if (!mapped) return { status: 502, body: avatarMissBody() };
  return { status: 200, body: mapped };
}

const SHEET_LEAK = /@|\\|users\/|api[_-]?key|secret|costUsd|token/i;
const SHEET_URL = /^https:\/\/(?:[a-z0-9-]+\.)?wiki(?:pedia|quote|source)\.org\/wiki\/\S+$/;

/** The core sheet read. Drops the owner hash and any quote that carries a path or a secret. */
export function presentCoreSheet(payload: unknown): {
  name: string;
  found: boolean;
  source: "core-fixture" | "core";
  quotes: { id: string; text: string; source: string; url: string; verification?: "verified" }[];
} | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { name?: unknown; found?: unknown; fixture?: unknown; quotes?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80 || SHEET_LEAK.test(name)) return null;
  const fixtureLabeled = body.fixture === "labeled";
  const quotes = (Array.isArray(body.quotes) ? body.quotes : []).slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const quote = item as { id?: unknown; text?: unknown; source?: unknown; url?: unknown; verification?: unknown };
    if (quote.verification === "not_found") return [];
    const text = typeof quote.text === "string" ? quote.text.trim() : "";
    const source = typeof quote.source === "string" ? quote.source.trim() : "";
    const url = typeof quote.url === "string" ? quote.url.trim() : "";
    const id = typeof quote.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(quote.id) ? quote.id : "";
    if (!id || !text || text.length > 500 || !source || source.length > 160) return [];
    if (SHEET_LEAK.test(text) || SHEET_LEAK.test(source) || !SHEET_URL.test(url)) return [];
    const row: { id: string; text: string; source: string; url: string; verification?: "verified" } = { id, text, source, url };
    if (quote.verification === "verified") row.verification = "verified";
    return [row];
  });
  const labeled = fixtureLabeled || quotes.some((quote) => /labeled fixture|fixture rotulada/i.test(quote.source));
  return { name, found: (body.found === true || fixtureLabeled) && quotes.length > 0, source: labeled ? "core-fixture" : "core", quotes };
}

export type CoreDebateLine = {
  speaker: number;
  name: string;
  kind: "quote" | "fixture";
  text: string | null;
  source: string | null;
  url: string | null;
  verification: "verified" | null;
};

export type CoreDebate = {
  id: string;
  theme: string;
  language: "en" | "pt";
  writer: "fixture";
  live: false;
  lines: CoreDebateLine[];
};

const DEBATE_ID = /^[a-f0-9]{8,32}$/;

function debateLine(item: unknown): CoreDebateLine | null {
  if (!item || typeof item !== "object") return null;
  const row = item as { speaker?: unknown; name?: unknown; text?: unknown; kind?: unknown; quote?: unknown };
  const speaker = COUNT(row.speaker, 5);
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (speaker == null || !name || name.length > 80 || SHEET_LEAK.test(name)) return null;
  if (row.kind !== "quote" && row.kind !== "fixture") return null;
  const rawText = row.text;
  if (rawText != null && typeof rawText !== "string") return null;
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (!text || text === "fixture." || text.length > 500 || SHEET_LEAK.test(text)) {
    return { speaker, name, kind: row.kind, text: null, source: null, url: null, verification: null };
  }
  const quote = row.quote && typeof row.quote === "object" ? row.quote as { source?: unknown; url?: unknown; verification?: unknown; text?: unknown } : null;
  if (quote?.verification === "not_found") {
    return { speaker, name, kind: row.kind, text: null, source: null, url: null, verification: null };
  }
  const source = quote && typeof quote.source === "string" ? quote.source.trim() : "";
  const url = quote && typeof quote.url === "string" ? quote.url.trim() : "";
  const safeSource = source && source.length <= 160 && !SHEET_LEAK.test(source) ? source : null;
  const safeUrl = url && SHEET_URL.test(url) ? url : null;
  if (quote && typeof quote.text === "string" && quote.text.trim() && quote.text.trim() !== text) return null;
  return {
    speaker,
    name,
    kind: row.kind,
    text,
    source: safeSource,
    url: safeUrl,
    verification: quote?.verification === "verified" ? "verified" : null,
  };
}

/** A fixture debate for the owner. A null line stays empty. A live model is not shown. */
export function presentCoreDebate(payload: unknown): CoreDebate | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { id?: unknown; theme?: unknown; language?: unknown; writer?: unknown; llm?: unknown; lines?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  if (!DEBATE_ID.test(id) || body.writer !== "fixture") return null;
  const llm = body.llm && typeof body.llm === "object" ? body.llm as { live?: unknown } : null;
  if (!llm || llm.live !== false) return null;
  if (body.language !== "en" && body.language !== "pt") return null;
  const theme = typeof body.theme === "string" ? body.theme.trim() : "";
  if (!theme || theme.length > 200 || SHEET_LEAK.test(theme)) return null;
  if (!Array.isArray(body.lines) || body.lines.length > 6) return null;
  const lines: CoreDebateLine[] = [];
  for (const item of body.lines) {
    const line = debateLine(item);
    if (!line) return null;
    lines.push(line);
  }
  return { id, theme, language: body.language, writer: "fixture", live: false, lines };
}

export function presentDebateResponse(status: number, payload: unknown): { status: number; body: CoreDebate | { error: string } } {
  if (status !== 200) return { status: status === 404 || status === 400 ? status : 502, body: avatarMissBody() };
  const debate = presentCoreDebate(payload);
  if (!debate) return { status: 502, body: avatarMissBody() };
  return { status: 200, body: debate };
}

export function presentDebateCreated(status: number, payload: unknown): { status: number; body: { id: string } | { error: string } } {
  const presented = presentDebateResponse(status, payload);
  if (!("id" in presented.body)) return presented;
  return { status: 200, body: { id: presented.body.id } };
}

export function presentPlanUsage(status: number, payload: unknown): { status: number; body: { usage: CoreUsageView } | { error: string } } {
  if (status !== 200) return { status: 502, body: avatarMissBody() };
  const usage = presentCoreUsage(payload);
  if (!usage) return { status: 502, body: avatarMissBody() };
  return { status: 200, body: { usage } };
}

/** Offline confirmation. The events are plan and fail only. No image stage is invented. */
export function labelOfflineAttempt(attempt: AvatarAttempt): AvatarAttempt {
  const jobs = attempt.jobs.map((job) => (
    job.disposition === "blocked" ? { ...job, fixture: true, stage: "fail" as const } : job
  ));
  const events: AvatarEventRecord[] = jobs.flatMap((job) => (
    job.disposition === "blocked"
      ? [
          { index: job.index, stage: "plan" as const, fixture: true },
          { index: job.index, stage: "fail" as const, fixture: true },
        ]
      : [{ index: job.index, stage: job.stage, fixture: job.fixture }]
  ));
  return {
    ...attempt,
    fixture: jobs.some((job) => job.fixture),
    jobs,
    events,
    keepsDraft: true,
    providerCalls: 0,
    providerFunction: null,
    cost: "unknown",
  };
}
