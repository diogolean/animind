"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { AvatarAttempt, AvatarIntent, AvatarPlan, AvatarProgressStage } from "@/lib/contract";
import { addAvatarParticipant, avatarIssues, inferAvatarPlan, pinAvatarParticipant, toggleAvatarParticipant, type AvatarIssue } from "@/lib/avatar-plan";
import { avatarReconnect, rememberedAvatarPoll, rememberAvatarPoll } from "@/lib/avatar-core";
import { avatarJobFeedback, avatarRunning, emptyAvatarProgress, foldAvatarEvents, type AvatarProgressView } from "@/lib/avatar-progress";
import { readAvatarAttempt, requestAvatarBatch } from "@/lib/api";
import { useI18n } from "@/components/locale";
import { artStyleLabel, fill, type MessageKey } from "@/lib/i18n";
import { track } from "@/lib/analytics-client";

const ANALYSIS_MS = 450;

const INTENT_KEY: Record<AvatarIntent, MessageKey> = {
  monologue: "avatarMonologue",
  presentation: "avatarPresentation",
  speech: "avatarSpeech",
  debate: "avatarDebate",
  unspecified: "avatarUnspecified",
};

const ISSUE_KEY: Record<AvatarIssue, MessageKey> = {
  speaker: "avatarMissingSpeaker",
  "second-identity": "avatarMissingSecond",
  selection: "avatarTooMany",
  resolution: "avatarResolution",
};

export function AvatarRequest({
  prompt,
  pinnedName,
  viewer,
  awaitingSignIn,
  automaticStages = {},
  onNeedLogin,
  onBlocked,
}: {
  prompt: string;
  pinnedName: string | null;
  viewer: { generationEnabled: boolean } | null;
  awaitingSignIn: boolean;
  automaticStages?: Partial<Record<number, AvatarProgressStage>>;
  onNeedLogin: () => void;
  onBlocked: (code: string) => void;
}) {
  const { locale, t } = useI18n();
  const [plan, setPlan] = useState<AvatarPlan | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [attempt, setAttempt] = useState<AvatarAttempt | null>(null);
  const [view, setView] = useState<AvatarProgressView>(emptyAvatarProgress());
  const [pollNonce, setPollNonce] = useState(0);
  const [tracked, setTracked] = useState(`${prompt}\n${pinnedName ?? ""}`);
  const ticket = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<AbortController | null>(null);
  const baseline = useRef<string | undefined>(undefined);
  const trackKey = `${prompt}\n${pinnedName ?? ""}`;
  if (trackKey !== tracked) {
    setTracked(trackKey);
    setPlan(null);
    setAdded([]);
    setPicked(null);
    setAttempt(null);
  }

  useEffect(() => {
    const current = ++ticket.current;
    abortRef.current?.abort();
    const clean = prompt.trim();
    if (!clean) return;
    const handle = setTimeout(() => {
      if (current !== ticket.current) return;
      let next = inferAvatarPlan(clean);
      if (pinnedName) next = pinAvatarParticipant(next, pinnedName);
      setPlan(next);
    }, ANALYSIS_MS);
    return () => clearTimeout(handle);
  }, [prompt, pinnedName]);

  useEffect(() => {
    if (baseline.current === undefined) {
      baseline.current = prompt;
      return;
    }
    const previous = baseline.current;
    baseline.current = prompt;
    if (previous === "" && prompt !== "") return;
    if (previous === prompt) return;
    pollRef.current?.abort();
  }, [prompt]);

  useEffect(() => {
    if (!viewer) return;
    const spec = avatarReconnect(rememberedAvatarPoll(window.sessionStorage));
    if (!spec) return;
    const controller = new AbortController();
    pollRef.current = controller;
    let timer = 0;
    const pull = () => {
      void readAvatarAttempt(spec.path, controller.signal).then((data) => {
        if (controller.signal.aborted) return;
        if (!data) return;
        setAttempt(data);
        setView((current) => foldAvatarEvents(current, data, false));
        const terminal = data.jobs.every((job) => job.stage === "fail" || job.stage === "ready" || job.disposition === "cancelled");
        if (!terminal) timer = window.setTimeout(pull, 2000);
      }).catch(() => {
        if (!controller.signal.aborted) timer = window.setTimeout(pull, 2000);
      });
    };
    pull();
    return () => {
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [viewer, pollNonce]);

  const shown = plan ? applyEdits(plan, added, picked) : null;
  const issues = shown ? avatarIssues(shown) : [];
  const included = avatarRunning(automaticStages, "automatic");
  const state = !shown ? "incomplete" : included ? "included" : issues.length ? "incomplete" : !viewer ? "sign-in" : !viewer.generationEnabled ? "blocked" : "ready";

  function addName() {
    if (!shown) return;
    const next = addAvatarParticipant(shown, nameDraft);
    if (next === shown) return;
    setAdded((current) => [...current, nameDraft]);
    setNameDraft("");
    setAttempt(null);
  }

  async function confirmAvatar() {
    if (included) {
      track("avatar_attempt", { result: "included" });
      return;
    }
    if (!shown || issues.length > 0) return;
    if (!viewer) {
      track("avatar_attempt", { result: "login_required" });
      onNeedLogin();
      return;
    }
    if (!viewer.generationEnabled) {
      track("avatar_attempt", { result: "unapproved" });
      track("access_denied", { reason: "unapproved" });
      onBlocked("unapproved");
      return;
    }
    track("avatar_attempt", { result: "confirmed" });
    const current = ticket.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setChecking(true);
    try {
      const data = await requestAvatarBatch({
        prompt: shown.prompt,
        language: shown.language,
        addedNames: added,
        selectedIds: shown.selectedIds,
      }, controller.signal);
      if (current !== ticket.current || controller.signal.aborted) return;
      rememberAvatarPoll(window.sessionStorage, data.requestId);
      setAttempt(data);
      setView(foldAvatarEvents(emptyAvatarProgress(), data, false));
      setPollNonce((currentNonce) => currentNonce + 1);
    } catch (error) {
      if (controller.signal.aborted || current !== ticket.current) return;
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
      onBlocked(code || "request");
    } finally {
      if (current === ticket.current) setChecking(false);
    }
  }

  return (
    <section className="mt-3" data-testid="avatar-request">
      <button
        type="button"
        data-testid="generate-avatar"
        data-state={state}
        aria-disabled={state !== "sign-in" && state !== "ready"}
        aria-describedby="avatar-note"
        onClick={() => void confirmAvatar()}
        className="inline-flex min-h-11 items-center rounded-full border border-white/45 bg-black px-4 text-sm font-medium text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {t("generateAvatar")}
      </button>
      <p id="avatar-note" data-testid="avatar-note" className="mt-2 max-w-xl text-sm leading-relaxed text-white/85">
        {t("avatarNoVideo")}
        {included ? ` ${t("avatarIncluded")}` : ""}
        {checking ? ` ${t("avatarChecking")}` : ""}
      </p>
      {awaitingSignIn ? <p data-testid="sign-in-wait" role="status" className="mt-2 text-sm font-medium text-white">{t("waitingForSignIn")}</p> : null}
      {shown ? (
        <div data-testid="avatar-plan" className="mt-3 max-w-xl text-sm text-white/90">
          <p className="flex items-center gap-2">
            <Check className="size-4 text-white" aria-hidden="true" />
            <span>{t(INTENT_KEY[shown.intent])}</span>
          </p>
          <p className="mt-1 text-white/80">{t("avatarLocal")}</p>
          <p className="mt-1">{fill(t("avatarStyle"), { style: artStyleLabel(locale, shown.artStyle) })}</p>
          <p className="mt-1">{fill(t("avatarResolution"), { value: shown.requestedResolution.toUpperCase() })}</p>
          {shown.context ? <p className="mt-1">{fill(t("avatarContext"), { context: shown.context })}</p> : null}
          <ul className="mt-2 space-y-1">
            {shown.participants.map((person) => {
              const needsChoice = shown.participants.length > shown.defaultCount;
              return (
                <li key={person.id}>
                  {needsChoice ? (
                    <label className="inline-flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={shown.selectedIds.includes(person.id)}
                        data-testid={`avatar-pick-${person.id}`}
                        onChange={() => {
                          setPicked(toggleAvatarParticipant(shown, person.id).selectedIds);
                          setAttempt(null);
                        }}
                      />
                      <span>{t("avatarChoose")}: {person.name}</span>
                    </label>
                  ) : (
                    <span>{person.name}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {issues.map((issue) => (
            <p key={issue} data-testid={`avatar-issue-${issue}`} className="mt-2 text-white/85">
              {fill(t(ISSUE_KEY[issue]), { count: shown.defaultCount, value: shown.requestedResolution.toUpperCase() })}
            </p>
          ))}
          {issues.includes("speaker") || issues.includes("second-identity") ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-white/85" htmlFor="avatar-name">{t("avatarName")}</label>
              <input
                id="avatar-name"
                data-testid="avatar-name"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                className="min-h-11 rounded-full border border-white/30 bg-black px-3 text-white"
              />
              <button type="button" data-testid="avatar-add" className="min-h-11 rounded-full border border-white/45 px-3 text-white" onClick={addName}>
                {t("avatarAdd")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {attempt ? (
        <ul data-testid="avatar-progress" role="status" className="mt-3 max-w-xl space-y-1 text-sm text-white/90">
          {attempt.outcome === "partial" ? (
            <li data-testid="avatar-partial">{attempt.jobs.some((job) => job.disposition === "reused") ? t("avatarPartial") : t("avatarPartialKept")}</li>
          ) : null}
          {attempt.jobs.map((job) => {
            const stage = view.stages[job.index] ?? job.stage;
            const feedback = avatarJobFeedback({ ...job, stage });
            return <li key={job.id} data-testid={`avatar-job-${job.index}`}>{fill(t(feedback.key), feedback.values)}</li>;
          })}
          {attempt.outcome !== "partial" && attempt.jobs.some((job) => job.disposition === "blocked") ? <li>{t("avatarProviderOff")}</li> : null}
        </ul>
      ) : null}
    </section>
  );
}

function applyEdits(plan: AvatarPlan, added: string[], picked: string[] | null): AvatarPlan {
  let next = plan;
  for (const name of added) next = addAvatarParticipant(next, name);
  if (picked) next = { ...next, selectedIds: picked.filter((id) => next.participants.some((item) => item.id === id)) };
  return next;
}
