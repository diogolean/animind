import type { AvatarAttempt, AvatarEventRecord, AvatarJobState, AvatarOutcome, AvatarProgressStage } from "./contract";
import { AVATAR_PROGRESS_STAGES } from "./contract";

/** Browser key for the poll id. It does not start a job and it is not a generate flag. */
export const AVATAR_POLL_KEY = "animindly-avatar-poll";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
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
    jobs,
    events,
    keepsDraft: true,
  };
}

export function coreNeedsChoice(payload: unknown): boolean {
  return Boolean(payload && typeof payload === "object" && (payload as { status?: unknown }).status === "needs_choice");
}

/** A core status that is not the owner's job becomes a fixed 404. The payload is not copied. */
export function presentCorePayload(status: number, payload: unknown, ownerId: string): { status: number; body: AvatarAttempt | { error: string; code?: string } } {
  if (status === 404 || payload == null) return { status: 404, body: avatarMissBody() };
  if (status !== 200) return { status: status === 403 ? 403 : 502, body: avatarMissBody() };
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
