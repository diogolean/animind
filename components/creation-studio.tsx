"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Ellipsis, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { ART_STYLES } from "@/lib/contract";
import type {
  ArtStyle,
  Character,
  CharacterPreview,
  CharacterType,
  CreationMode,
  CreationPlan,
  CreationPlanCharacter,
  LanguageCode,
  Objective,
  RenderResult,
  ScenarioRequest,
  ScenarioResolution,
  Tone,
  ToneOption,
  VoiceCatalog,
  VideoFormat,
} from "@/lib/contract";
import type { LibraryCharacter } from "@/lib/accounts/types";
import { HEALTH_EVENT, createCharacter, createPreview, getTones, getVoices, planCreation, resolveScenario, startRender, waitJob } from "@/lib/api";
import { previewFromCharacter, stickPreview } from "@/lib/character-preview";
import { captureGeneration } from "@/lib/library-capture";
import { normalizeToneCatalog } from "@/lib/tones";
import { fallbackVoiceCatalog } from "@/lib/voices";
import { loadDraft, saveDraft } from "@/lib/draft";
import { track } from "@/lib/analytics-client";
import type { PublicUser } from "@/lib/accounts/types";
import { useI18n } from "@/components/locale";
import { apiErrorMessage, fill } from "@/lib/i18n";
import { artStyleLabel, scenarioDisplay, scenarioPresetId, translate, type Locale, type MessageKey } from "@/lib/i18n";
import { fixturePersona, sheetForScreen, type ScreenSheet } from "@/lib/persona-sheet";
import { AvatarRequest } from "@/components/avatar-request";
import { CharacterListEditor } from "@/components/flow/character-list-editor";
import { CharacterVoicesEditor } from "@/components/flow/character-voices-editor";
import { ChoiceCard } from "@/components/flow/choice-card";
import { LanguageCombobox } from "@/components/flow/language-combobox";
import { PlanChips, type PlanField } from "@/components/flow/plan-chips";
import { ProgressivePreview } from "@/components/flow/progressive-preview";
import { Player } from "@/components/player";
import { Transcript } from "@/components/transcript";

const MODE_IDS: CreationMode[] = ["monologue", "dialogue", "debate"];
const MODE_COPY: Record<CreationMode, { label: MessageKey; body: MessageKey }> = {
  monologue: { label: "monologue", body: "monologueBody" },
  dialogue: { label: "dialogue", body: "dialogueBody" },
  debate: { label: "debateMode", body: "debateBody" },
};
const OBJECTIVE_IDS: Objective[] = ["ensinar", "debater", "entreter", "convencer"];
const OBJECTIVE_COPY: Record<Objective, MessageKey> = {
  ensinar: "teach",
  debater: "debateObjective",
  entreter: "entertain",
  convencer: "persuade",
};
const TONE_COPY: Record<Tone, MessageKey> = {
  humor: "toneHumor",
  terror: "toneHorror",
  educacional: "toneEducational",
  sabio: "toneWise",
  serio: "toneSerious",
};

function toneLabel(locale: Locale, tone: ToneOption): string {
  return tone.id in TONE_COPY ? translate(locale, TONE_COPY[tone.id as Tone]) : tone.label;
}
const SCENARIO_PROMPTS = {
  studio: { label: "Estúdio", prompt: "estúdio minimalista" },
  classroom: { label: "Sala de aula", prompt: "sala de aula com lousa" },
  arena: { label: "Arena", prompt: "arena com plateia" },
  space: { label: "Espaço", prompt: "nave no espaço entre planetas" },
  agora: { label: "Ágora", prompt: "ágora clássica com colunas gregas" },
} as const;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function showPreview(current: CharacterPreview[], next: CharacterPreview) {
  const existing = current.find((item) => item.index === next.index);
  // A finished core cut-out is never replaced by the local silhouette.
  if (existing?.source === "core" && next.source !== "core") return current;
  return [...current.filter((item) => item.index !== next.index), next].sort((a, b) => a.index - b.index);
}
function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{children}</span>;
}

export function CreationStudio() {
  const searchParams = useSearchParams();
  const libraryId = searchParams.get("library");
  const libraryIntent = searchParams.get("intent") === "debate" ? "debate" : libraryId ? "video" : null;
  const libraryRigRef = useRef<Character | null>(null);
  const hadLibrary = useRef(false);
  const [libraryCharacter, setLibraryCharacter] = useState<LibraryCharacter | null>(null);
  const [prompt, setPrompt] = useState("");
  const [automatic, setAutomatic] = useState(true);
  const [plan, setPlan] = useState<CreationPlan | null>(null);
  const [personaSheets, setPersonaSheets] = useState<{ key: string; sheets: ScreenSheet[] }>({ key: "", sheets: [] });
  const [planning, setPlanning] = useState(false);
  const [editing, setEditing] = useState<PlanField | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planTicket = useRef(0);
  const [tones, setTones] = useState<ToneOption[]>(normalizeToneCatalog().tones);

  const [manualMode, setManualMode] = useState<CreationMode>("monologue");
  const [manualCharacters, setManualCharacters] = useState<CreationPlanCharacter[]>([{ name: "", prompt: "" }]);
  const [manualType, setManualType] = useState<CharacterType>("stick");
  const [manualStyle, setManualStyle] = useState<ArtStyle>("ghibli");
  const [manualTopic, setManualTopic] = useState("");
  const [manualTone, setManualTone] = useState<Tone>("humor");
  const [manualObjective, setManualObjective] = useState<Objective>("entreter");
  const [manualScenarioMode, setManualScenarioMode] = useState<"auto" | "prompt">("auto");
  const [manualScenarioPrompt, setManualScenarioPrompt] = useState("");
  const [manualDuration, setManualDuration] = useState<30 | 60 | 90>(60);
  const [manualLanguage, setManualLanguage] = useState<LanguageCode>("en-US");
  const [format, setFormat] = useState<VideoFormat>("16:9");
  const [viewer, setViewer] = useState<PublicUser | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginReason, setLoginReason] = useState<"create" | "avatar">("create");
  const [awaitingSignIn, setAwaitingSignIn] = useState(false);
  const { locale, t } = useI18n();

  const [rendering, setRendering] = useState(false);
  const [status, setStatus] = useState("");
  const [blockCode, setBlockCode] = useState("");
  const [progress, setProgress] = useState(0);
  const [audio, setAudio] = useState<AudioContext | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [scenarioResolution, setScenarioResolution] = useState<ScenarioResolution | null>(null);
  const [progressivePreviews, setProgressivePreviews] = useState<CharacterPreview[]>([]);
  const [streamScenario, setStreamScenario] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const currentLanguage = automatic ? plan?.language ?? "en-US" : manualLanguage;
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalog>(fallbackVoiceCatalog("en-US"));

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = (await response.json()) as { user?: PublicUser | null };
        return data.user ?? null;
      })
      .then(setViewer)
      .catch(() => setViewer(null));
    if (!libraryId) {
      const draft = loadDraft();
      if (draft) {
        setPrompt(draft.prompt);
        setFormat(draft.format);
      }
    }
    getTones().then((catalog) => setTones(catalog.tones)).catch(() => {});
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    getVoices(currentLanguage)
      .then(setVoiceCatalog)
      .catch(() => setVoiceCatalog(fallbackVoiceCatalog(currentLanguage)));
  }, [currentLanguage]);

  const sheetNames = plan?.characters.map((character) => character.name.trim()).filter(Boolean).slice(0, 2).join("\n") ?? "";
  const sheetLanguage = plan?.language ?? "";
  const sheetKey = `${sheetLanguage}\n${sheetNames}`;
  const shownSheets = personaSheets.key === sheetKey ? personaSheets.sheets : [];
  useEffect(() => {
    if (!sheetNames) return;
    const controller = new AbortController();
    const key = `${sheetLanguage}\n${sheetNames}`;
    const local = (plan?.personaSheets ?? []).flatMap((sheet) => {
      const visible = sheetForScreen(sheet);
      return visible ? [visible] : [];
    });
    void Promise.all(sheetNames.split("\n").map(async (name) => {
      const response = await fetch(`/api/personas/sheet?${new URLSearchParams({ name, lang: sheetLanguage || "en-US" })}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) return null;
      return sheetForScreen(await response.json());
    })).then((rows) => {
      if (controller.signal.aborted) return;
      const fetched = rows.filter((row): row is ScreenSheet => Boolean(row));
      setPersonaSheets({ key, sheets: fetched.length ? fetched : local });
    }).catch(() => {
      if (!controller.signal.aborted) setPersonaSheets({ key, sheets: local });
    });
    return () => controller.abort();
  }, [sheetNames, sheetLanguage, plan]);

  useEffect(() => {
    if (!libraryId) {
      if (hadLibrary.current) {
        hadLibrary.current = false;
        setLibraryCharacter(null);
        libraryRigRef.current = null;
        setPrompt("");
        setAutomatic(true);
        setDetailsOpen(false);
        setPlan(null);
      }
      return;
    }
    hadLibrary.current = true;
    let cancelled = false;
    fetch(`/api/library/${encodeURIComponent(libraryId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { error?: string; character?: LibraryCharacter; rig?: Character | null };
        if (!response.ok || !data.character) throw Object.assign(new Error(data.error ?? ""), { code: (data as { code?: string }).code ?? "" });
        return data;
      })
      .then((data) => {
        if (cancelled || !data.character) return;
        const name = data.character.name;
        const persona = data.character.personaSheetRef || name;
        setLibraryCharacter(data.character);
        libraryRigRef.current = data.rig ?? null;
        setAutomatic(false);
        setDetailsOpen(true);
        setManualMode(libraryIntent === "debate" ? "debate" : "monologue");
        setManualObjective(libraryIntent === "debate" ? "debater" : "entreter");
        setManualTopic(name);
        setManualCharacters(
          libraryIntent === "debate"
            ? [{ name, prompt: persona }, { name: t("guestName"), prompt: t("guestPrompt") }]
            : [{ name, prompt: persona }],
        );
        setPrompt(fill(t(libraryIntent === "debate" ? "debateWith" : "videoWith"), { name }));
      })
      .catch((error) => {
        if (!cancelled) toast.error(apiErrorMessage(locale, error));
      });
    return () => {
      cancelled = true;
    };
  }, [libraryId, libraryIntent, locale]);

  useEffect(() => {
    if (rendering && progressivePreviews.length === 1)
      requestAnimationFrame(() => streamRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [rendering, progressivePreviews.length]);

  const requestPlan = (value: string, language: LanguageCode | null = null) => {
    if (timer.current) clearTimeout(timer.current);
    const ticket = ++planTicket.current;
    const clean = value.trim();
    if (!clean) {
      setPlan(null);
      setPlanning(false);
      return;
    }
    setPlanning(true);
    timer.current = setTimeout(() => {
      planCreation({ prompt: clean, ...(language ? { language } : {}) })
        .then((next) => {
          if (ticket !== planTicket.current) return;
          setPlan(next);
          setEditing(null);
        })
        .catch((error) => {
          if (ticket !== planTicket.current) return;
          toast.error(apiErrorMessage(locale, error));
        })
        .finally(() => {
          if (ticket === planTicket.current) setPlanning(false);
        });
    }, 220);
  };

  const applyPlanToManual = (source: CreationPlan) => {
    setManualLanguage(source.language);
    setManualMode(source.mode);
    setManualCharacters(source.characters);
    setManualType(source.characterType);
    setManualStyle(source.artStyle);
    setManualTopic(source.topic);
    setManualTone(source.tone);
    setManualObjective(source.objective);
    setManualDuration(source.duration);
    setManualScenarioMode(source.scenarioRequest.mode);
    setManualScenarioPrompt(source.scenarioRequest.mode === "prompt" ? source.scenarioRequest.prompt : "");
  };

  const manualPlan = useMemo<CreationPlan>(() => {
    const scenarioRequest: ScenarioRequest =
      manualScenarioMode === "prompt"
        ? { mode: "prompt", prompt: manualScenarioPrompt, characterNames: manualCharacters.map((character) => character.name) }
        : { mode: "auto", characterNames: manualCharacters.map((character) => character.name) };
    return {
      prompt,
      language: manualLanguage,
      mode: manualMode,
      characters: manualCharacters,
      topic: manualTopic,
      tone: manualTone,
      objective: manualObjective,
      artStyle: manualStyle,
      characterType: manualType,
      scenarioRequest,
      scenarioLabel: manualScenarioMode === "prompt" ? manualScenarioPrompt || t("scenarioFromPrompt") : t("scenarioAutomaticEra"),
      personaSheets: manualCharacters.map((character) => fixturePersona(character.name)).filter((sheet) => sheet.found),
      duration: manualDuration,
      source: "local",
    };
  }, [
    prompt,
    manualMode,
    manualCharacters,
    manualTopic,
    manualTone,
    manualObjective,
    manualStyle,
    manualType,
    manualScenarioMode,
    manualScenarioPrompt,
    manualDuration,
    manualLanguage,
    t,
  ]);

  const activePlan = automatic ? plan : manualPlan;
  const valid =
    !!activePlan &&
    activePlan.topic.trim().length > 0 &&
    activePlan.characters.length > 0 &&
    activePlan.characters.every((character) => character.name.trim() && character.prompt.trim());

  const updatePlan = (patch: Partial<CreationPlan>) => setPlan((current) => current ? { ...current, ...patch } : current);

  async function generate() {
    if (!activePlan || !valid) return;
    const context = audio ?? new AudioContext();
    if (!audio) setAudio(context);
    setRendering(true);
    setResult(null);
    setScenarioResolution(null);
    setStreamScenario(null);
    setProgress(0);
    const drafts = activePlan.mode === "monologue" ? activePlan.characters.slice(0, 1) : activePlan.characters;
    setProgressivePreviews([stickPreview(drafts[0], 0, "loading")]);
    try {
      const previewFlow = (async () => {
        for (let index = 0; index < drafts.length; index++) {
          if (index > 0) {
            await wait(850);
            setProgressivePreviews((current) => showPreview(current, stickPreview(drafts[index], index, "loading")));
          }
          const preview = await createPreview({
            character: drafts[index],
            characterType: activePlan.characterType,
            artStyle: activePlan.artStyle,
            language: activePlan.language,
            index,
          }).catch(() => null);
          // Only the explicit mock fallback may draw a local SVG. The core has no SVG preview.
          if (preview?.source === "local") setProgressivePreviews((current) => showPreview(current, preview));
        }
      })();
      const availableVoices = await getVoices(activePlan.language).catch(() => fallbackVoiceCatalog(activePlan.language));
      setVoiceCatalog(availableVoices);
      const cast: Character[] = [];
      for (let index = 0; index < drafts.length; index++) {
        setStatus(fill(t("statusCreating"), { name: drafts[index].name, n: index + 1, total: drafts.length }));
        if (index === 0 && libraryRigRef.current) {
          const character = { ...libraryRigRef.current, name: drafts[index].name.trim() || libraryRigRef.current.name };
          cast.push(character);
          const cutout = previewFromCharacter(character, index);
          if (cutout) setProgressivePreviews((current) => showPreview(current, cutout));
          continue;
        }
        const character = await createCharacter({
          name: drafts[index].name.trim(),
          source: { kind: "prompt", prompt: drafts[index].prompt.trim() },
          characterType: activePlan.characterType,
          artStyle: activePlan.artStyle,
          ...(drafts[index].gender ? { gender: drafts[index].gender } : {}),
          ...(drafts[index].voiceId ? { voiceId: drafts[index].voiceId } : {}),
        });
        cast.push(character);
        const cutout = previewFromCharacter(character, index);
        if (cutout) setProgressivePreviews((current) => showPreview(current, cutout));
        if (character.generator === "mock" && character.generatorNote) window.dispatchEvent(new Event(HEALTH_EVENT));
      }
      await previewFlow;
      setStatus(t("statusScene"));
      const scenario = await resolveScenario(activePlan.scenarioRequest);
      setStatus(t("statusWriting"));
      const template = activePlan.mode === "monologue" ? (activePlan.objective === "ensinar" ? "lesson" : "solo") : "debate";
      const voiceIndex = { male: 0, female: 0 };
      const voices = drafts.map((character) => {
        const gender = character.gender ?? "male";
        const matching = availableVoices.voices.filter((voice) => voice.gender === gender);
        const explicit = matching.find((voice) => voice.id === character.voiceId);
        const picked = explicit ?? matching[voiceIndex[gender]++ % Math.max(1, matching.length)] ?? availableVoices.voices[0];
        return { voice: picked.id, label: picked.label, auto: !explicit };
      });
      const job = await startRender({
        characters: cast,
        template,
        scenario: scenario.scenario,
        scenarioRequest: activePlan.scenarioRequest,
        topic: activePlan.topic,
        scriptPrompt: activePlan.prompt,
        tone: activePlan.tone,
        objective: activePlan.objective,
        narrative: activePlan.mode === "debate" ? "debate" : activePlan.mode === "dialogue" ? "historia" : activePlan.objective === "ensinar" ? "aula" : "direto",
        targetDurationSec: activePlan.duration,
        configurationSource: automatic ? "automatic" : "manual",
        language: activePlan.language,
        voices,
        format,
        personaMode: "quick",
        style: activePlan.artStyle,
      });
      setScenarioResolution(scenario);
      setStreamScenario(scenarioDisplay(locale, scenario.scenario === "agora" ? "Ágora" : activePlan.scenarioLabel));
      const done = await waitJob(job.id, (state) => {
        setProgress(state.progress);
        setStatus(fill(t("statusRendering"), { percent: Math.round(state.progress * 100) }));
      });
      setResult(done.result!);
      setStatus("");
      const items = captureGeneration({ jobId: done.id, libraryCharacterId: libraryCharacter?.id, result: done.result! });
      if (items.length) {
        void fetch("/api/library/catalog", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items }),
        }).catch(() => undefined);
      }
      window.dispatchEvent(new Event(HEALTH_EVENT));
    } catch (error) {
      const message = apiErrorMessage(locale, error);
      toast.error(message);
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
      setBlockCode(code || "request");
      setStatus("");
      setProgressivePreviews((current) =>
        current.map((item) => (item.source === "loading" ? stickPreview({ name: item.name }, item.index, "local") : item)),
      );
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-5 pt-8 pb-16 landscape:pt-4 sm:px-8 sm:pt-[16vh]">
      <section className="mx-auto max-w-3xl">
        <p data-testid="home-lead" className="mb-4 max-w-xl text-sm leading-relaxed text-muted-foreground">{t("homeLead")}</p>
        {libraryCharacter ? (
          <p data-testid="library-character" className="mb-4 text-sm text-muted-foreground">
            {t("using")} <span className="text-foreground">{libraryCharacter.name}</span> {t("fromYourLibrary")}
            {libraryIntent === "debate" ? ` ${t("inThisDebate")}` : ` ${t("inThisVideo")}`}
            {libraryCharacter.views.front && libraryCharacter.views.three_quarter_left && libraryCharacter.views.three_quarter_right
              ? ` ${t("cameraViews")}`
              : ""}
          </p>
        ) : null}
        <div className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-3 shadow-2xl shadow-black/20 sm:p-4">
          <textarea
            autoFocus
            data-testid="creation-prompt"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              saveDraft(event.target.value, format);
              if (automatic) requestPlan(event.target.value);
            }}
            rows={6}
            maxLength={1200}
            placeholder={t("promptPlaceholder")}
            className="min-h-52 w-full resize-none bg-transparent p-4 text-xl leading-relaxed tracking-tight outline-none placeholder:text-muted-foreground/40 sm:p-6 sm:text-2xl"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 px-3 pt-3 pb-1 sm:px-6">
            <div className="flex min-h-11 items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={automatic}
                data-testid="automatic-toggle"
                onClick={() => {
                  const next = !automatic;
                  setAutomatic(next);
                  setEditing(null);
                  if (!next) {
                    if (plan) applyPlanToManual(plan);
                    setDetailsOpen(true);
                  } else {
                    setDetailsOpen(false);
                    requestPlan(prompt);
                  }
                }}
                className={cn("relative h-11 w-16 rounded-full transition-colors", automatic ? "bg-[var(--accent-brand)]" : "bg-white/10")}
              >
                <span className={cn("absolute top-2 left-2 size-7 rounded-full bg-white shadow transition-transform", automatic ? "translate-x-5" : "translate-x-0")} />
                <span className="sr-only">{automatic ? t("automaticOff") : t("automaticOn")}</span>
              </button>
              <span className="text-sm font-medium">{t("automatic")}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                data-testid="details-toggle"
                aria-label={t("moreSettings")}
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen((current) => !current)}
                className={cn("grid size-11 place-items-center rounded-full text-muted-foreground transition hover:bg-white/8 hover:text-white", detailsOpen && "bg-white/8 text-white")}
              >
                <Ellipsis className="size-5" />
              </button>
              <button
                type="button"
                data-testid="generate"
                disabled={!valid || rendering}
                onClick={() => {
                  saveDraft(prompt, format);
                  if (!viewer) {
                    track("create_attempt", { result: "login_required" });
                    setAwaitingSignIn(true);
                    setLoginReason("create");
                    setLoginOpen(true);
                    return;
                  }
                  if (!viewer.generationEnabled) {
                    track("create_attempt", { result: "unapproved" });
                    track("access_denied", { reason: "unapproved" });
                    setBlockCode("unapproved");
                    toast.error(t("generationUnapproved"));
                    return;
                  }
                  track("create_attempt", { result: "started" });
                  void generate();
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-25"
              >
                {rendering ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {rendering ? t("creating") : t("create")}
              </button>
            </div>
          </div>
        </div>
        <AvatarRequest
          prompt={prompt}
          pinnedName={libraryCharacter?.name ?? null}
          viewer={viewer}
          awaitingSignIn={awaitingSignIn}
          onNeedLogin={() => {
            saveDraft(prompt, format);
            setAwaitingSignIn(true);
            setLoginReason("avatar");
            setLoginOpen(true);
          }}
          onBlocked={(code) => {
            setBlockCode(code);
            toast.error(apiErrorMessage(locale, { code }));
          }}
        />
        {viewer && !viewer.generationEnabled ? (
          <p data-testid="generation-off" role="status" className="mt-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            <span className="font-medium">{t("generationOffTitle")}. </span>
            {t("generationOffBody")}
          </p>
        ) : null}
        {blockCode ? (
          <p data-testid="generation-block" role="alert" className="mt-3 rounded-2xl border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {apiErrorMessage(locale, { code: blockCode })}
          </p>
        ) : null}
        {plan?.source === "local" ? (
          <p data-testid="planner-source" className="mt-3 text-xs text-muted-foreground">
            {t("localPlan")} {t("planPrice")}
          </p>
        ) : plan?.source === "core" ? (
          <p data-testid="planner-source" className="mt-3 text-xs text-muted-foreground">
            {t("corePlan")} {t("planPrice")}
          </p>
        ) : null}
        {shownSheets.length ? (
          <div data-testid="persona-sheets" className="mt-4 space-y-3">
            {shownSheets.map((sheet) => {
              const copy = sheet.source === "core"
                ? { title: "coreVerifiedSheet" as const, body: "coreVerifiedSheetBody" as const }
                : sheet.source === "core-fixture"
                  ? { title: "coreFixtureSheet" as const, body: "coreFixtureSheetBody" as const }
                  : { title: "fixtureSheet" as const, body: "fixtureSheetBody" as const };
              return (
                <article key={`${sheet.source}-${sheet.name}`} data-testid="persona-sheet" data-source={sheet.source} className="rounded-2xl border border-white/10 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium">{sheet.name}</h3>
                    <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[11px] text-amber-200">{t(copy.title)}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{t(copy.body)}</p>
                  <ul className="mt-3 space-y-3">
                    {sheet.quotes.map((quote) => (
                      <li key={quote.id} data-testid="persona-quote">
                        <p className="text-sm">{quote.text}</p>
                        <p data-testid="persona-quote-source" className="text-xs text-muted-foreground">{quote.source}</p>
                        <a data-testid="persona-quote-url" href={quote.url} className="break-all text-xs text-muted-foreground underline" target="_blank" rel="noreferrer">{quote.url}</a>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        ) : null}
        {loginOpen ? (
          <div role="dialog" aria-modal="true" data-testid="login-gate" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-neutral-950 p-6">
              <h2 className="text-lg font-medium">{t(loginReason === "avatar" ? "loginAvatarTitle" : "loginTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t(loginReason === "avatar" ? "loginAvatarBody" : "loginBody")}</p>
              <a data-testid="login-gate-google" href="/api/auth/google?next=/" className="mt-5 flex min-h-11 items-center justify-center rounded-full bg-white text-sm font-medium text-black" onClick={() => {
                saveDraft(prompt, format);
                window.sessionStorage.setItem("animindly-login", "google");
              }}>
                {t("signInGoogle")}
              </a>
              <a href="/login?next=/" className="mt-3 flex min-h-11 items-center justify-center rounded-full border border-white/15 text-sm" onClick={() => saveDraft(prompt, format)}>
                {t("signInPassword")}
              </a>
              <button type="button" className="mt-3 flex min-h-11 w-full items-center justify-center text-sm text-muted-foreground" onClick={() => { setLoginOpen(false); setLoginReason("create"); setAwaitingSignIn(false); }}>{t("notNow")}</button>
            </div>
          </div>
        ) : null}

        <AnimatePresence>
          {detailsOpen ? (
            <motion.div
              key="details"
              data-testid="details-panel"
              initial={{ opacity: 0, height: 0, y: -6 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -6 }}
              className="mt-4 overflow-hidden rounded-[1.5rem] border border-white/8 bg-white/[0.018] p-5"
            >
              <div className="mb-5 flex items-center justify-between">
                <p className="text-sm font-medium">{automatic ? t("willCreate") : t("manualDirection")}</p>
                <div className="flex gap-1">
                  {(["16:9", "9:16"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      data-testid={`format-${item.replace(":", "x")}`}
                      onClick={() => setFormat(item)}
                      className={cn("rounded-full px-3 py-1.5 text-xs transition", format === item ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white")}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              {automatic ? (
                plan ? (
                  <>
                    <PlanChips plan={plan} tones={tones} voices={voiceCatalog} onEdit={setEditing} />
                    <AnimatePresence>
                      {editing ? (
                        <motion.div
                          key={editing}
                          data-testid="chip-editor"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] p-4"
                        >
                          <div className="mb-4 flex items-center justify-between">
                            <p className="text-sm font-medium">{t("edit")}</p>
                            <button type="button" aria-label={t("closeEditor")} onClick={() => setEditing(null)} className="grid size-8 place-items-center rounded-full hover:bg-white/10"><X className="size-4" /></button>
                          </div>
                          <PlanEditor field={editing} plan={plan} tones={tones} voices={voiceCatalog} onChange={updatePlan} />
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </>
                ) : <p className="text-sm text-muted-foreground">{planning ? t("understanding") : t("writeIdea")}</p>
              ) : (
                <div data-testid="manual-controls" className="space-y-9">
                  <ManualControls
                    mode={manualMode}
                    onMode={setManualMode}
                    language={manualLanguage}
                    onLanguage={setManualLanguage}
                    characters={manualCharacters}
                    onCharacters={setManualCharacters}
                    voices={voiceCatalog}
                    characterType={manualType}
                    onCharacterType={setManualType}
                    artStyle={manualStyle}
                    onArtStyle={setManualStyle}
                    topic={manualTopic}
                    onTopic={setManualTopic}
                    tone={manualTone}
                    onTone={setManualTone}
                    tones={tones}
                    objective={manualObjective}
                    onObjective={setManualObjective}
                    scenarioMode={manualScenarioMode}
                    onScenarioMode={setManualScenarioMode}
                    scenarioPrompt={manualScenarioPrompt}
                    onScenarioPrompt={setManualScenarioPrompt}
                    duration={manualDuration}
                    onDuration={setManualDuration}
                  />
                </div>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {rendering && progressivePreviews.length ? (
          <div ref={streamRef}>
            <ProgressivePreview previews={progressivePreviews} scenario={streamScenario} status={status || fill(t("statusRendering"), { percent: Math.round(progress * 100) })} />
          </div>
        ) : null}
        {scenarioResolution?.note ? <p data-testid="scenario-fallback" className="mt-3 text-sm text-amber-500">{scenarioResolution.note}</p> : null}
      </section>

      {result && audio ? (
        <motion.section data-testid="render-result" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-10 max-w-4xl">
          <Player result={result} audioCtx={audio} fileName={`animindly-${result.characters[0]?.name.toLowerCase().replace(/\W+/g, "-") ?? "criacao"}`} />
          <Transcript result={result} />
        </motion.section>
      ) : null}
    </div>
  );
}

function PlanEditor({
  field,
  plan,
  tones,
  voices,
  onChange,
}: {
  field: PlanField;
  plan: CreationPlan;
  tones: ToneOption[];
  voices: VoiceCatalog;
  onChange: (patch: Partial<CreationPlan>) => void;
}) {
  const { locale, t } = useI18n();
  if (field === "language")
    return (
      <LanguageCombobox
        testId="plan-language"
        value={plan.language}
        languages={voices.languages}
        onChange={(language) => onChange({
          language,
          characters: plan.characters.map((character) => ({ ...character, voiceId: undefined })),
        })}
      />
    );
  if (field.startsWith("voice-")) {
    const index = Number(field.split("-")[1]);
    return (
      <CharacterVoicesEditor
        characters={plan.characters}
        onChange={(characters) => onChange({ characters })}
        catalog={voices}
        language={plan.language}
        onlyIndex={index}
        testIdPrefix="plan-voice"
      />
    );
  }
  if (field === "characters") return <CharacterListEditor value={plan.characters} onChange={(characters) => onChange({ characters })} testIdPrefix="plan-character" />;
  if (field === "mode")
    return (
      <select data-testid="plan-mode" value={plan.mode} onChange={(event) => onChange({ mode: event.target.value as CreationMode })} className="h-11 w-full rounded-xl border bg-background px-3">
        {MODE_IDS.map((id) => <option key={id} value={id}>{t(MODE_COPY[id].label)}</option>)}
      </select>
    );
  if (field === "topic")
    return <input data-testid="plan-topic" value={plan.topic} onChange={(event) => onChange({ topic: event.target.value })} className="h-11 w-full rounded-xl border bg-transparent px-3" />;
  if (field === "tone")
    return (
      <select data-testid="plan-tone" value={plan.tone} onChange={(event) => onChange({ tone: event.target.value as Tone })} className="h-11 w-full rounded-xl border bg-background px-3">
        {tones.map((item) => <option key={item.id} value={item.id}>{toneLabel(locale, item)}{item.fallback ? " · fallback" : ""}</option>)}
      </select>
    );
  if (field === "objective")
    return (
      <select data-testid="plan-objective" value={plan.objective} onChange={(event) => onChange({ objective: event.target.value as Objective })} className="h-11 w-full rounded-xl border bg-background px-3">
        {OBJECTIVE_IDS.map((id) => <option key={id} value={id}>{t(OBJECTIVE_COPY[id])}</option>)}
      </select>
    );
  if (field === "style")
    return (
      <select data-testid="plan-style" value={plan.artStyle} onChange={(event) => onChange({ artStyle: event.target.value as ArtStyle })} className="h-11 w-full rounded-xl border bg-background px-3">
        {ART_STYLES.map((item) => <option key={item.id} value={item.id}>{artStyleLabel(locale, item.id)}</option>)}
      </select>
    );
  if (field === "scenario")
    return (
      <select
        data-testid="plan-scenario"
        value={scenarioPresetId(plan.scenarioLabel)}
        onChange={(event) => {
          const key = event.target.value as keyof typeof SCENARIO_PROMPTS;
          const item = SCENARIO_PROMPTS[key];
          onChange({
            scenarioLabel: scenarioDisplay(locale, item.label),
            scenarioRequest: { mode: "prompt", prompt: item.prompt, characterNames: plan.characters.map((character) => character.name) },
          });
        }}
        className="h-11 w-full rounded-xl border bg-background px-3"
      >
        {Object.entries(SCENARIO_PROMPTS).map(([id, item]) => <option key={id} value={id}>{scenarioDisplay(locale, item.label)}</option>)}
      </select>
    );
  return (
    <div className="flex gap-2">
      {([30, 60, 90] as const).map((seconds) => (
        <button key={seconds} type="button" data-testid={`plan-duration-${seconds}`} onClick={() => onChange({ duration: seconds })} className={cn("h-11 flex-1 rounded-xl border", plan.duration === seconds && "border-[var(--accent-brand)] bg-[var(--accent-brand)] text-white")}>{seconds}s</button>
      ))}
    </div>
  );
}

interface ManualControlsProps {
  mode: CreationMode;
  onMode: (value: CreationMode) => void;
  language: LanguageCode;
  onLanguage: (value: LanguageCode) => void;
  characters: CreationPlanCharacter[];
  onCharacters: (value: CreationPlanCharacter[]) => void;
  voices: VoiceCatalog;
  characterType: CharacterType;
  onCharacterType: (value: CharacterType) => void;
  artStyle: ArtStyle;
  onArtStyle: (value: ArtStyle) => void;
  topic: string;
  onTopic: (value: string) => void;
  tone: Tone;
  onTone: (value: Tone) => void;
  tones: ToneOption[];
  objective: Objective;
  onObjective: (value: Objective) => void;
  scenarioMode: "auto" | "prompt";
  onScenarioMode: (value: "auto" | "prompt") => void;
  scenarioPrompt: string;
  onScenarioPrompt: (value: string) => void;
  duration: 30 | 60 | 90;
  onDuration: (value: 30 | 60 | 90) => void;
}

function ManualControls(props: ManualControlsProps) {
  const { locale, t } = useI18n();
  return (
    <>
      <section className="max-w-xs">
        <Label>{t("contentLanguage")}</Label>
        <LanguageCombobox
          testId="manual-language"
          value={props.language}
          languages={props.voices.languages}
          onChange={(language) => {
            props.onLanguage(language);
            props.onCharacters(props.characters.map((character) => ({ ...character, voiceId: undefined })));
          }}
        />
      </section>
      <section>
        <Label>{t("mode")}</Label>
        <div className="grid gap-3 sm:grid-cols-3">
          {MODE_IDS.map((id) => <ChoiceCard key={id} data-testid={`manual-mode-${id}`} active={props.mode === id} onClick={() => props.onMode(id)} title={t(MODE_COPY[id].label)} description={t(MODE_COPY[id].body)} />)}
        </div>
      </section>
      <section>
        <Label>{t("cast")}</Label>
        <CharacterListEditor value={props.characters} onChange={props.onCharacters} testIdPrefix="manual-character" />
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <Label>{t("voices")}</Label>
          {props.voices.source === "fallback" ? <span className="text-xs text-amber-500">{t("provisionalCatalog")}</span> : null}
        </div>
        <CharacterVoicesEditor
          characters={props.characters}
          onChange={props.onCharacters}
          catalog={props.voices}
          language={props.language}
          testIdPrefix="manual-voice"
        />
      </section>
      <section className="grid gap-6 sm:grid-cols-2">
        <div>
          <Label>{t("type")}</Label>
          <div className="grid gap-2">
            <ChoiceCard data-testid="manual-type-stick" active={props.characterType === "stick"} onClick={() => props.onCharacterType("stick")} title={t("stick")} description={t("stickBody")} />
            <ChoiceCard data-testid="manual-type-illustrated" active={props.characterType === "illustrated"} onClick={() => props.onCharacterType("illustrated")} title={t("illustrated")} description={t("illustratedBody")} />
          </div>
        </div>
        <div>
          <Label>{t("style")}</Label>
          <div className="flex flex-wrap gap-2">
            {ART_STYLES.map((item) => <button key={item.id} type="button" data-testid={`manual-art-${item.id}`} onClick={() => props.onArtStyle(item.id)} className={cn("rounded-full border px-3 py-2 text-sm", props.artStyle === item.id ? "border-[var(--accent-brand)] bg-[var(--accent-brand)] text-white" : "text-muted-foreground")}>{artStyleLabel(locale, item.id)}</button>)}
          </div>
        </div>
      </section>
      <section className="grid gap-5 sm:grid-cols-3">
        <label className="sm:col-span-3">
          <Label>{t("topic")}</Label>
          <input data-testid="manual-topic" value={props.topic} onChange={(event) => props.onTopic(event.target.value)} placeholder={t("topicPlaceholder")} className="h-11 w-full rounded-xl border bg-transparent px-3" />
        </label>
        <label>
          <Label>{t("tone")}</Label>
          <select data-testid="manual-tone" value={props.tone} onChange={(event) => props.onTone(event.target.value as Tone)} className="h-11 w-full rounded-xl border bg-background px-3">
            {props.tones.map((item) => <option key={item.id} value={item.id}>{toneLabel(locale, item)}{item.fallback ? " · fallback" : ""}</option>)}
          </select>
          {props.tones.find((item) => item.id === props.tone)?.fallback ? <span className="mt-1 block text-xs text-amber-500">{t("coreFallback")}: {props.tones.find((item) => item.id === props.tone)?.coreId}</span> : null}
        </label>
        <label>
          <Label>{t("objective")}</Label>
          <select data-testid="manual-objective" value={props.objective} onChange={(event) => props.onObjective(event.target.value as Objective)} className="h-11 w-full rounded-xl border bg-background px-3">
            {OBJECTIVE_IDS.map((id) => <option key={id} value={id}>{t(OBJECTIVE_COPY[id])}</option>)}
          </select>
        </label>
        <div>
          <Label>{t("duration")}</Label>
          <div className="flex gap-1">
            {([30, 60, 90] as const).map((seconds) => <button key={seconds} type="button" data-testid={`manual-duration-${seconds}`} onClick={() => props.onDuration(seconds)} className={cn("h-11 flex-1 rounded-xl border text-sm", props.duration === seconds && "border-[var(--accent-brand)] bg-[var(--accent-brand)] text-white")}>{seconds}s</button>)}
          </div>
        </div>
      </section>
      <section>
        <Label>{t("scene")}</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard data-testid="manual-scenario-auto" active={props.scenarioMode === "auto"} onClick={() => props.onScenarioMode("auto")} title={t("sceneAuto")} description={t("sceneAutoBody")} />
          <ChoiceCard data-testid="manual-scenario-prompt" active={props.scenarioMode === "prompt"} onClick={() => props.onScenarioMode("prompt")} title={t("scenePrompt")} description={t("scenePromptBody")} />
        </div>
        {props.scenarioMode === "prompt" ? <textarea data-testid="manual-scenario-description" value={props.scenarioPrompt} onChange={(event) => props.onScenarioPrompt(event.target.value)} rows={3} placeholder={t("scenePlaceholder")} className="mt-3 w-full resize-none rounded-xl border bg-transparent p-3" /> : null}
      </section>
    </>
  );
}
