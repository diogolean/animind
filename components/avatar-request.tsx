"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { AvatarAttempt, AvatarIntent, AvatarPlan, AvatarProgressStage, CharacterView, CoreUsageView } from "@/lib/contract";
import { addAvatarParticipant, avatarIssues, inferAvatarPlan, pinAvatarParticipant, toggleAvatarParticipant, type AvatarIssue } from "@/lib/avatar-plan";
import { avatarReconnect, rememberedAvatarPoll, rememberAvatarPoll } from "@/lib/avatar-core";
import { avatarJobFeedback, avatarRunning, emptyAvatarProgress, foldAvatarEvents, type AvatarProgressView } from "@/lib/avatar-progress";
import { readAvatarAttempt, requestAvatarBatch } from "@/lib/api";
import { AvatarStage } from "@/components/avatar-stage";
import { FixtureDebate } from "@/components/fixture-debate";
import { useI18n } from "@/components/locale";
import { artStyleLabel, fill, type MessageKey } from "@/lib/i18n";
import { track } from "@/lib/analytics-client";

const ANALYSIS_MS = 450;

type CoreSheet = {
  name: string;
  found: boolean;
  source: "core-fixture" | "core" | "fixture";
  quotes: { id: string; text: string; source: string; url: string; verification?: "verified" }[];
};

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
  viewer: { generationEnabled: boolean; role?: "user" | "admin" | "super_admin" } | null;
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
  const [sheets, setSheets] = useState<CoreSheet[]>([]);
  const [coreView, setCoreView] = useState("front");
  const [planUsage, setPlanUsage] = useState<CoreUsageView | null>(null);
  const [coreMode, setCoreMode] = useState<"unknown" | "core" | "mock" | "off">("unknown");
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
    setPlanUsage(null);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { mode?: string }) => {
        const mode = data?.mode === "core" || data?.mode === "mock" || data?.mode === "off" ? data.mode : "off";
        if (!cancelled) setCoreMode(mode);
      })
      .catch(() => {
        if (!cancelled) setCoreMode("off");
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        const terminal = data.review != null || data.jobs.every((job) => job.stage === "fail" || job.stage === "ready" || job.disposition === "cancelled");
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
  const sheetKey = shown ? `${shown.language}\n${shown.participants.map((person) => person.name).join("\n")}` : "";

  useEffect(() => {
    if (!viewer || !sheetKey) return;
    const [language, ...names] = sheetKey.split("\n");
    const controller = new AbortController();
    void Promise.all(names.filter(Boolean).slice(0, 2).map(async (name) => {
      const response = await fetch(`/api/personas/sheet?${new URLSearchParams({ name, lang: language ?? "en-US" })}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) return null;
      const data = await response.json() as CoreSheet;
      if (!data?.found) return null;
      const verified = data.quotes.filter((quote) => quote.verification === "verified");
      if (!verified.length) return null;
      if (data.source !== "core-fixture" && data.source !== "core" && data.source !== "fixture") return null;
      return { ...data, quotes: verified };
    })).then((rows) => {
      if (!controller.signal.aborted) setSheets(rows.filter((row): row is CoreSheet => Boolean(row)));
    }).catch(() => undefined);
    return () => controller.abort();
  }, [viewer, sheetKey]);
  const usagePrompt = shown?.prompt ?? "";
  const usageLanguage = shown?.language ?? "";
  const usageResolution = shown?.requestedResolution ?? "1k";

  useEffect(() => {
    if (!viewer || !usagePrompt || !usageLanguage) return;
    const controller = new AbortController();
    const body = { prompt: usagePrompt, language: usageLanguage, requestedResolution: usageResolution };
    void fetch("/api/avatars/plan", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (response) => {
      if (!response.ok) return null;
      const data = await response.json() as { usage?: CoreUsageView };
      const usage = data.usage;
      if (!usage || usage.cost !== "unknown") return null;
      if (!Number.isInteger(usage.attempts) || !Number.isInteger(usage.providerCalls)) return null;
      return usage;
    }).then((usage) => {
      if (!controller.signal.aborted) setPlanUsage(usage);
    }).catch(() => {
      if (!controller.signal.aborted) setPlanUsage(null);
    });
    return () => controller.abort();
  }, [viewer, usagePrompt, usageLanguage, usageResolution]);

  const issues = shown ? avatarIssues(shown) : [];
  const included = avatarRunning(automaticStages, "automatic");
  const mayRequest = viewer?.role === "admin" || viewer?.role === "super_admin";
  const state = !shown ? "incomplete" : included ? "included" : issues.length ? "incomplete" : !viewer ? "sign-in" : !mayRequest ? "blocked" : coreMode === "core" ? "confirm" : coreMode === "mock" ? "preview" : "offline";

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
    if (viewer.role !== "admin" && viewer.role !== "super_admin") {
      track("avatar_attempt", { result: "unapproved" });
      track("access_denied", { reason: "unapproved" });
      onBlocked("unapproved");
      return;
    }
    if (coreMode !== "core" && coreMode !== "mock") {
      track("avatar_attempt", { result: "offline" });
      onBlocked("avatar_provider_unavailable");
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
        aria-disabled={state !== "sign-in" && state !== "confirm" && state !== "preview"}
        aria-describedby="avatar-note"
        onClick={() => void confirmAvatar()}
        className="inline-flex min-h-11 items-center rounded-full border border-white/45 bg-black px-4 text-sm font-medium text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {t("generateAvatar")}
      </button>
      <p id="avatar-note" data-testid="avatar-note" className="mt-2 max-w-xl text-sm leading-relaxed text-white/85">
        {t("avatarNoVideo")}
        {state === "offline" ? ` ${t("avatarProviderOff")}` : ""}
        {state === "preview" ? ` ${t("avatarPreviewHint")}` : ""}
        {state === "blocked" ? ` ${t("generationUnapproved")}` : ""}
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
          <p data-testid="plan-price" className="mt-1 text-white/80">{t("planPrice")}</p>
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
          {planUsage ? (
            <p data-testid="avatar-usage" className="mt-2 text-white/85">
              {fill(t("usageAttempts"), { count: planUsage.attempts })}
              {" · "}
              {fill(t("usageProviderCalls"), { count: planUsage.providerCalls })}
              {" · "}
              {t("unknownCost")}
            </p>
          ) : null}
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
      {sheets.map((sheet) => (
        <article key={sheet.name} data-testid="core-persona-sheet" className="mt-3 max-w-xl rounded-2xl border border-white/10 p-4 text-sm text-white/90">
          <p className="text-xs text-amber-200">{sheet.source === "core" ? t("coreVerifiedSheet") : t("fixtureSheet")}</p>
          <p className="mt-1 text-white/80">{sheet.source === "core" ? t("coreVerifiedSheetBody") : sheet.source === "core-fixture" ? t("coreFixtureSheetBody") : t("fixtureSheetBody")}</p>
          <h3 className="mt-3 text-sm font-medium">{sheet.name}</h3>
          <ul className="mt-2 space-y-2">
            {sheet.quotes.map((quote) => (
              <li key={quote.id} data-testid="core-quote">
                <p>{quote.text}</p>
                <p className="text-xs text-white/70">{quote.source} · {t("coreFixtureVerified")}</p>
                <a data-testid="core-quote-url" href={quote.url} className="break-all text-xs text-white/70 underline" target="_blank" rel="noreferrer">{quote.url}</a>
              </li>
            ))}
          </ul>
        </article>
      ))}
      {sheets[0] && sheets[1] && shown ? (
        <FixtureDebate
          names={[sheets[0].name, sheets[1].name]}
          theme={(shown.context || shown.prompt).slice(0, 200)}
          language={shown.language}
        />
      ) : null}
      {attempt?.fixture ? (
        <p data-testid="avatar-preview-result" role="status" className="mt-3 max-w-xl rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          {t("avatarPreviewResult")}
        </p>
      ) : null}
      {attempt ? (
        <ul data-testid="avatar-progress" role="status" className="mt-3 max-w-xl space-y-1 text-sm text-white/90">
          {attempt.outcome === "partial" ? (
            <li data-testid="avatar-partial">{attempt.jobs.some((job) => job.disposition === "reused") ? t("avatarPartial") : t("avatarPartialKept")}</li>
          ) : null}
          {attempt.review ? (
            <>
              <li data-testid="avatar-review" data-status={attempt.review.status} data-ready={attempt.review.ready ? "true" : "false"}>
                {attempt.review.ready ? t("avatarCoreReady") : t("avatarReviewRequired")}
              </li>
              {attempt.review.defects.map((code) => (
                <li key={code} data-testid="avatar-defect">{fill(t("avatarDefect"), { code })}</li>
              ))}
              {attempt.scenery ? (
                <li data-testid="avatar-scenery" data-separate={attempt.scenery.separate ? "true" : "false"}>
                  {attempt.scenery.separate ? t("avatarScenerySeparate") : t("avatarSceneryEmbedded")}
                </li>
              ) : null}
              <li data-testid="avatar-core-cost">
                {attempt.coreMicro == null ? t("unknownCost") : fill(t("coreReportedMicro"), { micro: attempt.coreMicro })}
              </li>
            </>
          ) : null}
          {attempt.transport === "core" && !attempt.review ? (
            <>
              {(attempt.events ?? []).filter((event) => event.index === 0).map((event) => (
                <li key={`${event.index}-${event.stage}`} data-testid={`avatar-core-${event.stage}`}>{fill(t("avatarCoreStage"), { stage: event.stage })}</li>
              ))}
              <li data-testid="avatar-core-block">{attempt.code === "price_unavailable" ? t("priceUnavailable") : t("avatarProviderOff")}</li>
              {attempt.usage?.cost === "unknown" ? (
                <li data-testid="avatar-job-usage">
                  {fill(t("usageAttempts"), { count: attempt.usage.attempts })}
                  {" · "}
                  {fill(t("usageProviderCalls"), { count: attempt.usage.providerCalls })}
                  {" · "}
                  {t("unknownCost")}
                </li>
              ) : null}
              <li>{t("avatarCoreNote")}</li>
            </>
          ) : attempt.review ? null : attempt.jobs.map((job) => {
            const stage = view.stages[job.index] ?? job.stage;
            const feedback = avatarJobFeedback({ ...job, stage });
            return <li key={job.id} data-testid={`avatar-job-${job.index}`}>{fill(t(feedback.key), feedback.values)}</li>;
          })}
          {attempt.transport !== "core" && attempt.outcome !== "partial" && attempt.jobs.some((job) => job.disposition === "blocked") ? <li>{t("avatarProviderOff")}</li> : null}
        </ul>
      ) : null}
      {attempt?.views && Object.keys(attempt.views).length ? (
        <CorePuppet attempt={attempt} viewId={coreView} onView={setCoreView} />
      ) : null}
    </section>
  );
}

function CorePuppet({
  attempt,
  viewId,
  onView,
}: {
  attempt: AvatarAttempt;
  viewId: string;
  onView: (id: string) => void;
}) {
  const { t } = useI18n();
  const order = ["front", "left", "right", "profile"];
  const sorted = Object.keys(attempt.views ?? {}).sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const selected = sorted.includes(viewId) ? viewId : sorted[0];
  const view: CharacterView | undefined = selected ? attempt.views?.[selected] : undefined;
  if (!view) return null;
  return (
    <div data-testid="avatar-core-views" className="mt-3 max-w-md">
      <div className="flex flex-wrap gap-2">
        {sorted.map((key) => (
          <button
            key={key}
            type="button"
            data-testid={`avatar-view-${key}`}
            data-selected={key === selected ? "true" : "false"}
            onClick={() => onView(key)}
            className="min-h-11 rounded-full border border-white/40 px-3 text-sm text-white"
          >
            {fill(t("avatarViewLabel"), { view: key })}
          </button>
        ))}
      </div>
      <figure data-testid="avatar-core-stage" data-template="face" data-scenery={attempt.scenery?.separate ? "separate" : "embedded"} className="mx-auto mt-3 w-full max-w-md bg-black">
        <AvatarStage view={view} emotion="neutral" lids="open" gaze="center" framing="close" scenery={false} />
      </figure>
    </div>
  );
}

function applyEdits(plan: AvatarPlan, added: string[], picked: string[] | null): AvatarPlan {
  let next = plan;
  for (const name of added) next = addAvatarParticipant(next, name);
  if (picked) next = { ...next, selectedIds: picked.filter((id) => next.participants.some((item) => item.id === id)) };
  return next;
}
