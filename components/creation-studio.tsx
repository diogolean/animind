"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { HEALTH_EVENT, createCharacter, createPreview, getTones, getVoices, planCreation, resolveScenario, startRender, waitJob } from "@/lib/api";
import { normalizeToneCatalog } from "@/lib/tones";
import { fallbackVoiceCatalog } from "@/lib/voices";
import { CharacterListEditor } from "@/components/flow/character-list-editor";
import { CharacterVoicesEditor } from "@/components/flow/character-voices-editor";
import { ChoiceCard } from "@/components/flow/choice-card";
import { LanguageCombobox } from "@/components/flow/language-combobox";
import { PlanChips, type PlanField } from "@/components/flow/plan-chips";
import { ProgressivePreview } from "@/components/flow/progressive-preview";
import { Player } from "@/components/player";
import { Transcript } from "@/components/transcript";

const MODE_OPTIONS: { id: CreationMode; label: string; description: string }[] = [
  { id: "monologue", label: "Monólogo", description: "Uma pessoa fala para a câmera." },
  { id: "dialogue", label: "Diálogo", description: "Personagens constroem uma conversa." },
  { id: "debate", label: "Debate", description: "Ideias em confronto, com réplicas." },
];
const OBJECTIVES: { id: Objective; label: string }[] = [
  { id: "ensinar", label: "Ensinar" },
  { id: "debater", label: "Debater" },
  { id: "entreter", label: "Entreter" },
  { id: "convencer", label: "Convencer" },
];
const SCENARIO_PROMPTS = {
  studio: { label: "Estúdio", prompt: "estúdio minimalista" },
  classroom: { label: "Sala de aula", prompt: "sala de aula com lousa" },
  arena: { label: "Arena", prompt: "arena com plateia" },
  space: { label: "Espaço", prompt: "nave no espaço entre planetas" },
  agora: { label: "Ágora", prompt: "ágora clássica com colunas gregas" },
} as const;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PREVIEW_ACCENTS = ["hsl(218 75% 64%)", "hsl(275 67% 68%)", "hsl(163 61% 55%)", "hsl(30 80% 62%)"];
const optimisticPreview = (character: CreationPlanCharacter, index: number): CharacterPreview => ({
  id: `local-${index}-${character.name}`,
  index,
  name: character.name || `Personagem ${index + 1}`,
  kind: "stick",
  source: "local",
  accent: PREVIEW_ACCENTS[index % PREVIEW_ACCENTS.length],
});
function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{children}</span>;
}

export function CreationStudio() {
  const [prompt, setPrompt] = useState("");
  const [automatic, setAutomatic] = useState(true);
  const [plan, setPlan] = useState<CreationPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [editing, setEditing] = useState<PlanField | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const [rendering, setRendering] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [audio, setAudio] = useState<AudioContext | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [scenarioResolution, setScenarioResolution] = useState<ScenarioResolution | null>(null);
  const [progressivePreviews, setProgressivePreviews] = useState<CharacterPreview[]>([]);
  const [streamScenario, setStreamScenario] = useState<string | null>(null);
  const currentLanguage = automatic ? plan?.language ?? "en-US" : manualLanguage;
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalog>(fallbackVoiceCatalog("en-US"));

  useEffect(() => {
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

  const requestPlan = (value: string, language: LanguageCode | null = null) => {
    if (timer.current) clearTimeout(timer.current);
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
          setPlan(next);
          setEditing(null);
        })
        .catch((error) => toast.error((error as Error).message))
        .finally(() => setPlanning(false));
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
      scenarioLabel: manualScenarioMode === "prompt" ? manualScenarioPrompt || "Cenário por prompt" : "Automático por época",
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
    setProgressivePreviews([optimisticPreview(drafts[0], 0)]);
    try {
      const previewFlow = (async () => {
        for (let index = 0; index < drafts.length; index++) {
          if (index > 0) {
            await wait(850);
            setProgressivePreviews((current) => [...current, optimisticPreview(drafts[index], index)]);
          }
          const preview = await createPreview({
            character: drafts[index],
            characterType: activePlan.characterType,
            artStyle: activePlan.artStyle,
            language: activePlan.language,
            index,
          }).catch(() => null);
          if (preview) {
            setProgressivePreviews((current) =>
              [...current.filter((item) => item.index !== index), preview].sort((a, b) => a.index - b.index),
            );
          }
        }
      })();
      const availableVoices = await getVoices(activePlan.language).catch(() => fallbackVoiceCatalog(activePlan.language));
      setVoiceCatalog(availableVoices);
      const cast: Character[] = [];
      for (let index = 0; index < drafts.length; index++) {
        setStatus(`Criando ${drafts[index].name} · ${index + 1}/${drafts.length}`);
        const character = await createCharacter({
          name: drafts[index].name.trim(),
          source: { kind: "prompt", prompt: drafts[index].prompt.trim() },
          characterType: activePlan.characterType,
          artStyle: activePlan.artStyle,
        });
        cast.push(character);
        if (character.generator === "mock" && character.generatorNote) window.dispatchEvent(new Event(HEALTH_EVENT));
      }
      await previewFlow;
      setStatus("Preparando cenário");
      const scenario = await resolveScenario(activePlan.scenarioRequest);
      setStatus("Escrevendo e animando");
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
      setStreamScenario(scenario.scenario === "agora" ? "Ágora" : activePlan.scenarioLabel);
      const done = await waitJob(job.id, (state) => {
        setProgress(state.progress);
        setStatus(`Renderizando · ${Math.round(state.progress * 100)}%`);
      });
      setResult(done.result!);
      setStatus("");
      window.dispatchEvent(new Event(HEALTH_EVENT));
    } catch (error) {
      toast.error((error as Error).message);
      setStatus("");
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-5 pt-[12vh] pb-16 sm:px-8 sm:pt-[16vh]">
      <section className="mx-auto max-w-3xl">
        <div className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-3 shadow-2xl shadow-black/20 sm:p-4">
          <textarea
            autoFocus
            data-testid="creation-prompt"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              if (automatic) requestPlan(event.target.value);
            }}
            rows={6}
            maxLength={1200}
            placeholder="Descreva sua criação&#10;Uma conversa entre Jesus e o diabo debatendo temas bíblicos"
            className="min-h-52 w-full resize-none bg-transparent p-4 text-xl leading-relaxed tracking-tight outline-none placeholder:text-muted-foreground/40 sm:p-6 sm:text-2xl"
          />
          <div className="flex items-center justify-between gap-4 border-t border-white/8 px-4 pt-3 pb-1 sm:px-6">
            <div className="flex items-center gap-3">
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
                className={cn("relative h-7 w-12 rounded-full transition-colors", automatic ? "bg-[var(--accent-brand)]" : "bg-white/10")}
              >
                <span className={cn("absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform", automatic ? "translate-x-5" : "translate-x-0")} />
                <span className="sr-only">{automatic ? "Desligar automático" : "Ligar automático"}</span>
              </button>
              <span className="text-sm font-medium">Automático</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="details-toggle"
                aria-label="Mais ajustes"
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen((current) => !current)}
                className={cn("grid size-10 place-items-center rounded-full text-muted-foreground transition hover:bg-white/8 hover:text-white", detailsOpen && "bg-white/8 text-white")}
              >
                <Ellipsis className="size-5" />
              </button>
              <button
                type="button"
                data-testid="generate"
                disabled={!valid || rendering || planning}
                onClick={generate}
                className="flex h-10 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-25"
              >
                {rendering || planning ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {planning ? "Entendendo" : rendering ? "Criando" : result ? "Criar novamente" : "Criar"}
              </button>
            </div>
          </div>
        </div>

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
                <p className="text-sm font-medium">{automatic ? "O que será criado" : "Direção manual"}</p>
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
                            <p className="text-sm font-medium">Editar {editing === "characters" ? "elenco" : editing}</p>
                            <button type="button" aria-label="Fechar editor" onClick={() => setEditing(null)} className="grid size-8 place-items-center rounded-full hover:bg-white/10"><X className="size-4" /></button>
                          </div>
                          <PlanEditor field={editing} plan={plan} tones={tones} voices={voiceCatalog} onChange={updatePlan} />
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </>
                ) : <p className="text-sm text-muted-foreground">{planning ? "Entendendo sua criação…" : "Escreva uma ideia para ver os detalhes."}</p>
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

        {rendering && progressivePreviews.length ? <ProgressivePreview previews={progressivePreviews} scenario={streamScenario} status={status || `Renderizando · ${Math.round(progress * 100)}%`} /> : null}
        {scenarioResolution?.note ? <p data-testid="scenario-fallback" className="mt-3 text-sm text-amber-500">{scenarioResolution.note}</p> : null}
      </section>

      {result && audio ? (
        <motion.section data-testid="render-result" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-10 max-w-4xl">
          <Player result={result} audioCtx={audio} fileName={`animind-${result.characters[0]?.name.toLowerCase().replace(/\W+/g, "-") ?? "criacao"}`} />
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
        {MODE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    );
  if (field === "topic")
    return <input data-testid="plan-topic" value={plan.topic} onChange={(event) => onChange({ topic: event.target.value })} className="h-11 w-full rounded-xl border bg-transparent px-3" />;
  if (field === "tone")
    return (
      <select data-testid="plan-tone" value={plan.tone} onChange={(event) => onChange({ tone: event.target.value as Tone })} className="h-11 w-full rounded-xl border bg-background px-3">
        {tones.map((item) => <option key={item.id} value={item.id}>{item.label}{item.fallback ? " · fallback" : ""}</option>)}
      </select>
    );
  if (field === "objective")
    return (
      <select data-testid="plan-objective" value={plan.objective} onChange={(event) => onChange({ objective: event.target.value as Objective })} className="h-11 w-full rounded-xl border bg-background px-3">
        {OBJECTIVES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    );
  if (field === "style")
    return (
      <select data-testid="plan-style" value={plan.artStyle} onChange={(event) => onChange({ artStyle: event.target.value as ArtStyle })} className="h-11 w-full rounded-xl border bg-background px-3">
        {ART_STYLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    );
  if (field === "scenario")
    return (
      <select
        data-testid="plan-scenario"
        value={Object.entries(SCENARIO_PROMPTS).find(([, item]) => plan.scenarioLabel.startsWith(item.label))?.[0] ?? "studio"}
        onChange={(event) => {
          const key = event.target.value as keyof typeof SCENARIO_PROMPTS;
          const item = SCENARIO_PROMPTS[key];
          onChange({
            scenarioLabel: item.label,
            scenarioRequest: { mode: "prompt", prompt: item.prompt, characterNames: plan.characters.map((character) => character.name) },
          });
        }}
        className="h-11 w-full rounded-xl border bg-background px-3"
      >
        {Object.entries(SCENARIO_PROMPTS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
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
  return (
    <>
      <section className="max-w-xs">
        <Label>Idioma</Label>
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
        <Label>Modo</Label>
        <div className="grid gap-3 sm:grid-cols-3">
          {MODE_OPTIONS.map((item) => <ChoiceCard key={item.id} data-testid={`manual-mode-${item.id}`} active={props.mode === item.id} onClick={() => props.onMode(item.id)} title={item.label} description={item.description} />)}
        </div>
      </section>
      <section>
        <Label>Personagens</Label>
        <CharacterListEditor value={props.characters} onChange={props.onCharacters} testIdPrefix="manual-character" />
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <Label>Vozes</Label>
          {props.voices.source === "fallback" ? <span className="text-xs text-amber-500">Catálogo provisório</span> : null}
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
          <Label>Tipo</Label>
          <div className="grid gap-2">
            <ChoiceCard data-testid="manual-type-stick" active={props.characterType === "stick"} onClick={() => props.onCharacterType("stick")} title="Stick figure" description="Leve e expressivo." />
            <ChoiceCard data-testid="manual-type-illustrated" active={props.characterType === "illustrated"} onClick={() => props.onCharacterType("illustrated")} title="Ilustrado Aiwake" description="Personagem complexo." />
          </div>
        </div>
        <div>
          <Label>Estilo</Label>
          <div className="flex flex-wrap gap-2">
            {ART_STYLES.map((item) => <button key={item.id} type="button" data-testid={`manual-art-${item.id}`} onClick={() => props.onArtStyle(item.id)} className={cn("rounded-full border px-3 py-2 text-sm", props.artStyle === item.id ? "border-[var(--accent-brand)] bg-[var(--accent-brand)] text-white" : "text-muted-foreground")}>{item.label}</button>)}
          </div>
        </div>
      </section>
      <section className="grid gap-5 sm:grid-cols-3">
        <label className="sm:col-span-3">
          <Label>Tema</Label>
          <input data-testid="manual-topic" value={props.topic} onChange={(event) => props.onTopic(event.target.value)} placeholder="Sobre o que a animação fala?" className="h-11 w-full rounded-xl border bg-transparent px-3" />
        </label>
        <label>
          <Label>Tom</Label>
          <select data-testid="manual-tone" value={props.tone} onChange={(event) => props.onTone(event.target.value as Tone)} className="h-11 w-full rounded-xl border bg-background px-3">
            {props.tones.map((item) => <option key={item.id} value={item.id}>{item.label}{item.fallback ? " · fallback" : ""}</option>)}
          </select>
          {props.tones.find((item) => item.id === props.tone)?.fallback ? <span className="mt-1 block text-xs text-amber-500">Fallback do núcleo: {props.tones.find((item) => item.id === props.tone)?.coreId}</span> : null}
        </label>
        <label>
          <Label>Objetivo</Label>
          <select data-testid="manual-objective" value={props.objective} onChange={(event) => props.onObjective(event.target.value as Objective)} className="h-11 w-full rounded-xl border bg-background px-3">
            {OBJECTIVES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <div>
          <Label>Duração</Label>
          <div className="flex gap-1">
            {([30, 60, 90] as const).map((seconds) => <button key={seconds} type="button" data-testid={`manual-duration-${seconds}`} onClick={() => props.onDuration(seconds)} className={cn("h-11 flex-1 rounded-xl border text-sm", props.duration === seconds && "border-[var(--accent-brand)] bg-[var(--accent-brand)] text-white")}>{seconds}s</button>)}
          </div>
        </div>
      </section>
      <section>
        <Label>Cenário</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard data-testid="manual-scenario-auto" active={props.scenarioMode === "auto"} onClick={() => props.onScenarioMode("auto")} title="Automático por época" description="Usa personagens e tema." />
          <ChoiceCard data-testid="manual-scenario-prompt" active={props.scenarioMode === "prompt"} onClick={() => props.onScenarioMode("prompt")} title="Descrever cenário" description="Controle local, luz e atmosfera." />
        </div>
        {props.scenarioMode === "prompt" ? <textarea data-testid="manual-scenario-description" value={props.scenarioPrompt} onChange={(event) => props.onScenarioPrompt(event.target.value)} rows={3} placeholder="Ex.: nave retrofuturista com Saturno na janela" className="mt-3 w-full resize-none rounded-xl border bg-transparent p-3" /> : null}
      </section>
    </>
  );
}
