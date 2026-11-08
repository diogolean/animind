import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AvatarAttempt, AvatarJobState, AvatarOutcome, LanguageCode } from "./contract";
import { addAvatarParticipant, avatarAttemptKey, avatarIssues, inferAvatarPlan } from "./avatar-plan";
import { authorizeResolution, FOUR_K_LONG_SIDE, MIN_LONG_SIDE, productResolutionSupport } from "./avatar-source";
import { avatarProviderSupport, AVATAR_PAID_CALLS_AUTHORIZED } from "./avatar-provider";
import { dataDir } from "./accounts/paths";

export { avatarProviderSupport, AVATAR_PAID_CALLS_AUTHORIZED } from "./avatar-provider";

export interface AvatarLibraryHit {
  id: string;
  ownerId: string;
  name: string;
  status: string;
  catalog?: boolean;
}

export interface AvatarStore {
  read(ownerId: string, key: string): AvatarAttempt | undefined;
  save(ownerId: string, key: string, attempt: AvatarAttempt): AvatarAttempt;
  find(ownerId: string, requestId: string): AvatarAttempt | undefined;
  update(ownerId: string, requestId: string, attempt: AvatarAttempt): void;
}

interface RowFile {
  rows: Record<string, AvatarAttempt>;
}

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function memoryAvatarStore(): AvatarStore {
  const rows = new Map<string, AvatarAttempt>();
  const id = (ownerId: string, key: string) => `${ownerId}\n${key}`;
  return {
    read(ownerId, key) {
      return rows.get(id(ownerId, key));
    },
    save(ownerId, key, attempt) {
      const existing = rows.get(id(ownerId, key));
      if (existing) return existing;
      rows.set(id(ownerId, key), attempt);
      return attempt;
    },
    find(ownerId, requestId) {
      for (const [key, attempt] of rows) {
        if (key.startsWith(`${ownerId}\n`) && attempt.requestId === requestId) return attempt;
      }
      return undefined;
    },
    update(ownerId, requestId, attempt) {
      for (const [key, current] of rows) {
        if (key.startsWith(`${ownerId}\n`) && current.requestId === requestId) rows.set(key, attempt);
      }
    },
  };
}

export function fileAvatarStore(dir = dataDir()): AvatarStore {
  const file = path.join(dir, "avatar-attempts.json");
  const load = (): RowFile => {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as RowFile;
      return parsed?.rows ? parsed : { rows: {} };
    } catch {
      return { rows: {} };
    }
  };
  const write = (data: RowFile) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(data));
  };
  return {
    read(ownerId, key) {
      return load().rows[`${ownerId}\n${key}`];
    },
    save(ownerId, key, attempt) {
      const data = load();
      const id = `${ownerId}\n${key}`;
      if (data.rows[id]) return data.rows[id];
      data.rows[id] = attempt;
      write(data);
      return attempt;
    },
    find(ownerId, requestId) {
      const data = load();
      return Object.entries(data.rows).find(([key, attempt]) => key.startsWith(`${ownerId}\n`) && attempt.requestId === requestId)?.[1];
    },
    update(ownerId, requestId, attempt) {
      const data = load();
      for (const [key, current] of Object.entries(data.rows)) {
        if (key.startsWith(`${ownerId}\n`) && current.requestId === requestId) data.rows[key] = attempt;
      }
      write(data);
    },
  };
}

export interface AvatarDecision {
  status: number;
  body: AvatarAttempt | { error: string; code: string; planIssues?: string[] };
}

function selectedPlan(prompt: string, language: LanguageCode | undefined, addedNames: string[], selectedIds: string[]) {
  let plan = inferAvatarPlan(prompt, language);
  for (const name of addedNames) plan = addAvatarParticipant(plan, name);
  if (selectedIds.length) {
    const known = new Set(plan.participants.map((item) => item.id));
    plan = { ...plan, selectedIds: selectedIds.filter((id) => known.has(id)) };
  }
  return plan;
}

function reuseHit(name: string, ownerId: string, library: AvatarLibraryHit[]): AvatarLibraryHit | undefined {
  const key = fold(name);
  return library.find((item) => item.ownerId === ownerId && !item.catalog && item.status === "ready" && fold(item.name) === key);
}

function outcomeOf(jobs: AvatarJobState[]): AvatarOutcome {
  const reused = jobs.filter((job) => job.disposition === "reused").length;
  const blocked = jobs.filter((job) => job.disposition === "blocked").length;
  if (reused && blocked) return "partial";
  if (reused === jobs.length) return "reused";
  return "blocked";
}

/**
 * Confirms an avatar attempt without calling a provider.
 * Paid calls are not authorized, and `generate_avatar` is not available.
 */
export function decideAvatarRequest(input: {
  ownerId: string;
  generationEnabled: boolean;
  prompt: string;
  language?: LanguageCode;
  addedNames?: string[];
  selectedIds?: string[];
  library: AvatarLibraryHit[];
  store: AvatarStore;
  requestId: string;
  onProvider?: () => void;
}): AvatarDecision {
  if (!input.generationEnabled) return { status: 403, body: { error: "Esta conta ainda não pode gerar", code: "unapproved" } };
  const prompt = input.prompt.trim();
  if (!prompt) return { status: 400, body: { error: "Descreva o avatar", code: "avatar_incomplete" } };
  const plan = selectedPlan(prompt, input.language, input.addedNames ?? [], input.selectedIds ?? []);
  const issues = avatarIssues(plan);
  if (issues.some((issue) => issue !== "resolution")) {
    return { status: 400, body: { error: "O plano do avatar está incompleto", code: "avatar_incomplete", planIssues: issues } };
  }
  const resolution = authorizeResolution(plan.requestedResolution, productResolutionSupport());
  if (!resolution.ok) return { status: 403, body: { error: "4K não está habilitado", code: resolution.code } };
  const names = plan.participants.filter((item) => plan.selectedIds.includes(item.id)).map((item) => item.name);
  const key = avatarAttemptKey(plan.prompt, names);
  const existing = input.store.read(input.ownerId, key);
  if (existing) return { status: existing.outcome === "reused" ? 200 : 403, body: existing };
  if (AVATAR_PAID_CALLS_AUTHORIZED || avatarProviderSupport().available) input.onProvider?.();
  const jobs: AvatarJobState[] = names.map((name, index) => {
    const hit = reuseHit(name, input.ownerId, input.library);
    return {
      id: `${input.requestId}_${index}`,
      index,
      name,
      stage: "plan",
      disposition: hit ? "reused" : "blocked",
      fixture: false,
      ...(hit ? { reusedCharacterId: hit.id } : {}),
      actual: null,
      qa: null,
      rig: null,
    };
  });
  const outcome = outcomeOf(jobs);
  const attempt: AvatarAttempt = {
    requestId: input.requestId,
    ownerId: input.ownerId,
    outcome,
    code: outcome === "reused" ? "reused" : "avatar_provider_unavailable",
    cost: "unknown",
    fixture: false,
    providerCalls: 0,
    providerFunction: null,
    jobs,
  };
  const saved = input.store.save(input.ownerId, key, attempt);
  return { status: saved.outcome === "reused" ? 200 : 403, body: saved };
}

export function cancelAvatarAttempt(store: AvatarStore, ownerId: string, requestId: string): AvatarAttempt | null {
  const current = store.find(ownerId, requestId);
  if (!current) return null;
  const jobs = current.jobs.map((job) => job.disposition === "blocked" ? { ...job, disposition: "cancelled" as const } : job);
  const reused = jobs.some((job) => job.disposition === "reused");
  const cancelled = jobs.every((job) => job.disposition === "cancelled");
  const next: AvatarAttempt = {
    ...current,
    jobs,
    outcome: cancelled ? "cancelled" : reused ? "partial" : "cancelled",
    code: cancelled ? "cancelled" : "avatar_provider_unavailable",
    providerCalls: 0,
  };
  store.update(ownerId, requestId, next);
  return next;
}

/** Ready requires a real plate, a passed QA, and a rig. An upscale is not native 4K. */
export function avatarJobReady(job: {
  stage: string;
  disposition?: string;
  actual: { width: number; height: number; provenance: "source" | "native" | "upscale" } | null;
  qa: { passed: boolean } | null;
  rig: { id: string } | null;
  requestedResolution: "1k" | "4k";
}): boolean {
  if (job.stage !== "ready" || job.disposition === "blocked" || job.disposition === "reused" || job.disposition === "cancelled") return false;
  if (!job.actual || !job.qa?.passed || !job.rig?.id) return false;
  if (job.actual.provenance === "upscale") return false;
  const long = Math.max(job.actual.width, job.actual.height);
  if (job.requestedResolution === "4k") return job.actual.provenance === "native" && long >= FOUR_K_LONG_SIDE;
  return long >= MIN_LONG_SIDE && (job.actual.provenance === "source" || job.actual.provenance === "native");
}
