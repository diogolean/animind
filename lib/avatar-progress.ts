import type { AvatarJobState, AvatarProgressStage } from "./contract";
import { AVATAR_PROGRESS_STAGES } from "./contract";
import type { MessageKey } from "./i18n";

const ORDER: Record<AvatarProgressStage, number> = {
  login: 0,
  plan: 1,
  queued: 2,
  image: 3,
  cutout: 4,
  rig: 5,
  qa: 6,
  save: 7,
  ready: 8,
  fail: 9,
  retry: 10,
};

/** Stages that mean an avatar job is already running, so a second click must not start another. */
export const AVATAR_RUNNING_STAGES: readonly AvatarProgressStage[] = ["queued", "image", "cutout", "rig", "qa", "save", "retry"];

export interface AvatarProgressEvent {
  requestId: string;
  index: number;
  stage: AvatarProgressStage;
  fixture: boolean;
  /** Ignored by the friendly line. A timer percent is not a backend event. */
  percent?: number;
}

export interface AvatarProgressView {
  requestId: string | null;
  aborted: boolean;
  stages: Partial<Record<number, AvatarProgressStage>>;
}

export function emptyAvatarProgress(): AvatarProgressView {
  return { requestId: null, aborted: false, stages: {} };
}

/** Drops a stale or duplicate event. Does not invent the next stage. */
export function applyAvatarEvent(view: AvatarProgressView, event: AvatarProgressEvent): AvatarProgressView {
  if (view.aborted) return view;
  if (!AVATAR_PROGRESS_STAGES.includes(event.stage)) return view;
  if (view.requestId && event.requestId !== view.requestId) return view;
  const current = view.stages[event.index];
  if (current && ORDER[event.stage] <= ORDER[current]) return view;
  return {
    requestId: event.requestId,
    aborted: false,
    stages: { ...view.stages, [event.index]: event.stage },
  };
}

export function abortAvatarProgress(view: AvatarProgressView): AvatarProgressView {
  return { ...view, aborted: true };
}

/** Applies core or fixture events in order. An aborted view and a stale request stay unchanged. */
export function foldAvatarEvents(
  view: AvatarProgressView,
  attempt: { requestId: string; events?: { index: number; stage: AvatarProgressStage; fixture: boolean }[] } | null,
  aborted: boolean,
): AvatarProgressView {
  if (aborted) return abortAvatarProgress(view);
  if (!attempt) return view;
  const base = view.requestId && view.requestId !== attempt.requestId ? emptyAvatarProgress() : view;
  return (attempt.events ?? []).reduce(
    (current, event) => applyAvatarEvent(current, { ...event, requestId: attempt.requestId }),
    base,
  );
}

export function avatarRunning(stages: Partial<Record<number, AvatarProgressStage>>, source: "automatic" | "manual"): boolean {
  if (source !== "automatic") return false;
  return Object.values(stages).some((stage) => stage && AVATAR_RUNNING_STAGES.includes(stage));
}

export function avatarBatchShape(jobs: Pick<AvatarJobState, "disposition">[]): "partial" | "blocked" | "reused" | "cancelled" | "open" {
  if (jobs.length === 0) return "open";
  const reused = jobs.filter((job) => job.disposition === "reused").length;
  const blocked = jobs.filter((job) => job.disposition === "blocked").length;
  const cancelled = jobs.filter((job) => job.disposition === "cancelled").length;
  if (reused && (blocked || cancelled)) return "partial";
  if (blocked && cancelled) return "partial";
  if (reused === jobs.length) return "reused";
  if (cancelled === jobs.length) return "cancelled";
  if (blocked === jobs.length) return "blocked";
  return "partial";
}

export function avatarJobFeedback(job: { name: string; disposition: AvatarJobState["disposition"]; stage: string; fixture: boolean }): { key: MessageKey; values: Record<string, string> } {
  if (job.fixture) return { key: "avatarFixtureStage", values: { stage: job.stage } };
  if (job.disposition === "reused") return { key: "avatarReused", values: { name: job.name } };
  if (job.disposition === "cancelled") return { key: "avatarCancelled", values: { name: job.name } };
  return { key: "avatarBlocked", values: { name: job.name } };
}

/** Unknown is not zero. A missing report stays unknown. */
export function costIsReportedZero(cost: "unknown" | number | null | undefined): boolean {
  return typeof cost === "number" && cost === 0;
}
