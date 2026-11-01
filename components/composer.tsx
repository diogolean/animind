"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { ART_STYLES } from "@/lib/contract";
import type {
  ArtStyle,
  Character,
  CharacterType,
  Narrative,
  Objective,
  RenderResult,
  ScenarioRequest,
  ScenarioResolution,
  Tone,
  ToneOption,
  VideoFormat,
} from "@/lib/contract";
import { HEALTH_EVENT, createCharacter, getTones, resolveScenario, startRender, waitJob } from "@/lib/api";
import { inferAutoConfig, type AutoConfig } from "@/lib/auto-config";
import { normalizeToneCatalog } from "@/lib/tones";
import { Player } from "@/components/player";
import { Transcript } from "@/components/transcript";
import { CharacterForm, type CharacterDraft } from "@/components/flow/character-form";
import { ChoiceCard } from "@/components/flow/choice-card";
import { Stepper } from "@/components/flow/stepper";

type CreationMode = "monologue" | "dialogue";
type ScenarioMode = "auto" | "prompt";

const DEFAULT_DRAFT: CharacterDraft = { name: "", prompt: "" };
const FALLBACK_TONES = normalizeToneCatalog().tones;
const OBJECTIVES: { id: Objective; label: string }[] = [
  { id: "ensinar", label: "Ensinar" },
  { id: "debater", label: "Debater" },
  { id: "entreter", label: "Entreter" },
  { id: "convencer", label: "Convencer" },
];
const NARRATIVES: { id: Narrative; label: string }[] = [
  { id: "direto", label: "Direto para a câmera" },
  { id: "historia", label: "História com começo, virada e fim" },
  { id: "aula", label: "Aula explicativa" },
  { id: "debate", label: "Debate com réplicas" },
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</span>;
}

function ContinueButton({ onClick, disabled, children = "Continuar" }: { onClick: () => void; disabled?: boolean; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      data-testid="continue"
      disabled={disabled}
      onClick={onClick}
      className="mt-6 h-11 rounded-full bg-foreground px-6 text-sm font-medium text-background disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function AutoSummary({ config, tones }: { config: AutoConfig; tones: ToneOption[] }) {
  const tone = tones.find((option) => option.id === config.tone);
  const items = [
    ["Tom", tone?.label ?? config.tone, tone?.fallback],
    ["Objetivo", OBJECTIVES.find((item) => item.id === config.objective)?.label ?? config.objective],
    ["Estilo", ART_STYLES.find((item) => item.id === config.artStyle)?.label ?? config.artStyle],
    ["Cenário", config.scenarioLabel],
    ["Duração", `${config.duration}s`],
  ] as const;
  return (
    <div data-testid="auto-summary" className="rounded-2xl border border-[var(--accent-brand)]/35 bg-[color-mix(in_oklab,var(--accent-brand)_7%,transparent)] p-4">
      <p className="flex items-center gap-2 text-sm font-medium"><Sparkles className="size-4 text-[var(--accent-brand)]" />Escolhas automáticas</p>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-5">
        {items.map(([label, value, fallback]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 font-medium">
              {value}
              {fallback ? <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase text-amber-600 dark:text-amber-400">fallback</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Composer() {
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [mode, setMode] = useState<CreationMode>("monologue");
  const [draft, setDraft] = useState<CharacterDraft>(DEFAULT_DRAFT);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [characterPrompts, setCharacterPrompts] = useState<Record<string, string>>({});
  const [automatic, setAutomatic] = useState(true);
  const [characterType, setCharacterType] = useState<CharacterType>("stick");
  const [artStyle, setArtStyle] = useState<ArtStyle>("ghibli");
  const [busyCharacter, setBusyCharacter] = useState(false);
  const [topic, setTopic] = useState("");
  const [scriptPrompt, setScriptPrompt] = useState("");
  const [tone, setTone] = useState<Tone>("humor");
  const [tones, setTones] = useState<ToneOption[]>(FALLBACK_TONES);
  const [objective, setObjective] = useState<Objective>("entreter");
  const [narrative, setNarrative] = useState<Narrative>("direto");
  const [duration, setDuration] = useState<30 | 60 | 90>(60);
  const [scenarioMode, setScenarioMode] = useState<ScenarioMode>("auto");
  const [scenarioPrompt, setScenarioPrompt] = useState("");
  const [scenarioResolution, setScenarioResolution] = useState<ScenarioResolution | null>(null);
  const [format, setFormat] = useState<VideoFormat>("16:9");
  const [result, setResult] = useState<RenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audio, setAudio] = useState<AudioContext | null>(null);

  const autoConfig = useMemo(
    () =>
      inferAutoConfig({
        mode,
        characterNames: [...characters.map((character) => character.name), ...(draft.name ? [draft.name] : [])],
        characterPrompts: [...characters.map((character) => characterPrompts[character.id] ?? ""), ...(draft.prompt ? [draft.prompt] : [])],
        topic,
        scriptPrompt,
      }),
    [mode, characters, characterPrompts, draft, topic, scriptPrompt],
  );
  const selectedTone = automatic ? autoConfig.tone : tone;
  const selectedObjective = automatic ? autoConfig.objective : objective;
  const selectedStyle = automatic ? autoConfig.artStyle : artStyle;
  const selectedDuration = automatic ? autoConfig.duration : duration;

  useEffect(() => {
    getTones()
      .then((catalog) => {
        setTones(catalog.tones);
      })
      .catch(() => {});
  }, []);

  const go = (next: number) => {
    setStep(next);
    setMaxStep((current) => Math.max(current, next));
  };

  async function addCharacter(advance = false) {
    if (!draft.name.trim() || !draft.prompt.trim()) return;
    setBusyCharacter(true);
    try {
      const character = await createCharacter({
        name: draft.name.trim(),
        source: { kind: "prompt", prompt: draft.prompt.trim() },
        characterType,
        artStyle: automatic ? autoConfig.artStyle : artStyle,
      });
      setCharacters((current) => [...current, character]);
      setCharacterPrompts((current) => ({ ...current, [character.id]: draft.prompt.trim() }));
      setDraft(DEFAULT_DRAFT);
      if (character.generator === "mock" && character.generatorNote) window.dispatchEvent(new Event(HEALTH_EVENT));
      if (advance) go(1);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyCharacter(false);
    }
  }

  async function generate() {
    const request: ScenarioRequest = automatic
      ? autoConfig.scenarioRequest
      : scenarioMode === "prompt"
        ? { mode: "prompt", prompt: scenarioPrompt.trim(), characterNames: characters.map((character) => character.name) }
        : { mode: "auto", characterNames: characters.map((character) => character.name) };
    setRendering(true);
    setResult(null);
    setProgress(0);
    if (!audio) setAudio(new AudioContext());
    try {
      const resolved = await resolveScenario(request);
      setScenarioResolution(resolved);
      const template = mode === "dialogue" ? "debate" : narrative === "aula" ? "lesson" : "solo";
      const cast = mode === "monologue" ? characters.slice(0, 1) : characters;
      const job = await startRender({
        characters: cast,
        template,
        scenario: resolved.scenario,
        scenarioRequest: request,
        topic: topic.trim(),
        scriptPrompt: scriptPrompt.trim() || undefined,
        tone: selectedTone,
        objective: selectedObjective,
        narrative,
        targetDurationSec: selectedDuration,
        configurationSource: automatic ? "automatic" : "manual",
        lang: "pt-BR",
        format,
        personaMode: "quick",
        style: selectedStyle,
      });
      const done = await waitJob(job.id, (state) => setProgress(state.progress));
      setResult(done.result!);
      window.dispatchEvent(new Event(HEALTH_EVENT));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRendering(false);
    }
  }

  const enoughCharacters = mode === "monologue" ? characters.length >= 1 : characters.length >= 2;

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-5 py-8 sm:px-8 sm:py-12">
      <Stepper current={step} maxStep={maxStep} onSelect={setStep} />
      <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border p-3 pl-4">
        <div>
          <p className="text-sm font-medium">Configuração automática</p>
          <p className="text-xs text-muted-foreground">
            {automatic ? "Inferindo tom, objetivo, estilo, cenário e duração." : "Controles manuais liberados."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={automatic}
          data-testid="automatic-toggle"
          onClick={() => setAutomatic((value) => !value)}
          className={cn("relative h-7 w-12 rounded-full transition-colors", automatic ? "bg-[var(--accent-brand)]" : "bg-muted")}
        >
          <span className={cn("absolute top-1 left-1 size-5 rounded-full bg-white shadow-sm transition-transform", automatic ? "translate-x-5" : "translate-x-0")} />
          <span className="sr-only">{automatic ? "Desligar automático" : "Ligar automático"}</span>
        </button>
      </div>
      {automatic ? <div className="mb-7"><AutoSummary config={autoConfig} tones={tones} /></div> : null}
      <AnimatePresence mode="wait">
        <motion.section
          key={step}
          data-testid={`flow-step-${step}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
        >
          {step === 0 ? (
            <>
              <p className="text-sm font-medium text-[var(--accent-brand)]">Passo 1 de 5</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Quem vai falar?</h1>
              <p className="mt-3 max-w-2xl text-muted-foreground">Escolha o formato e descreva livremente o primeiro personagem.</p>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                <ChoiceCard
                  data-testid="mode-monologue"
                  active={mode === "monologue"}
                  onClick={() => {
                    setMode("monologue");
                    setNarrative("direto");
                  }}
                  title="Monólogo"
                  description="Um avatar fala diretamente para a câmera."
                  badge="1 personagem"
                />
                <ChoiceCard
                  data-testid="mode-dialogue"
                  active={mode === "dialogue"}
                  onClick={() => {
                    setMode("dialogue");
                    setNarrative("debate");
                  }}
                  title="Diálogo"
                  description="Dois ou mais personagens conversam em cena."
                  badge="2+ personagens"
                />
              </div>

              <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.25fr]">
                <div className="space-y-6">
                  <div>
                    <FieldLabel>Tipo de personagem</FieldLabel>
                    <div className="grid gap-2">
                      <ChoiceCard
                        data-testid="type-stick"
                        active={characterType === "stick"}
                        onClick={() => setCharacterType("stick")}
                        title="Stick figure"
                        description="Leve, expressivo e prioridade do MVP."
                        badge="padrão"
                      />
                      <ChoiceCard
                        data-testid="type-illustrated"
                        active={characterType === "illustrated"}
                        onClick={() => setCharacterType("illustrated")}
                        title="Ilustrado complexo"
                        description="Pipeline de personagem detalhado no padrão Aiwake."
                        badge="experimental"
                      />
                    </div>
                    {characterType === "stick" ? (
                      <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                        O contrato já envia “stick”; o núcleo atual pode usar o rig Aiwake até implementar esse tipo.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <FieldLabel>Estilo da ilustração</FieldLabel>
                    {automatic ? (
                      <p data-testid="auto-style" className="rounded-xl border border-dashed p-3 text-sm">
                        {ART_STYLES.find((style) => style.id === autoConfig.artStyle)?.label}
                        <span className="ml-2 text-xs text-muted-foreground">inferido do personagem</span>
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {ART_STYLES.map((style) => (
                          <button
                            key={style.id}
                            type="button"
                            data-testid={`art-${style.id}`}
                            onClick={() => setArtStyle(style.id)}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-sm transition-colors",
                              artStyle === style.id
                                ? "border-[var(--accent-brand)] bg-[var(--accent-brand)] text-white"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {style.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <CharacterForm
                  value={draft}
                  onChange={setDraft}
                  busy={busyCharacter}
                  onSubmit={() => addCharacter(true)}
                  submitLabel="Criar e continuar"
                />
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <p className="text-sm font-medium text-[var(--accent-brand)]">Passo 2 de 5</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Personagens</h1>
              <p className="mt-2 text-muted-foreground">
                {mode === "dialogue" ? "Defina pelo menos mais uma voz para a conversa." : "Revise quem vai conduzir o monólogo."}
              </p>
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {characters.map((character, index) => (
                  <article key={character.id} data-testid="character-card" className="flex items-center justify-between rounded-2xl border p-4">
                    <div>
                      <p className="font-medium">{character.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {characterType === "stick" ? "Stick figure" : "Ilustrado Aiwake"} · {ART_STYLES.find((style) => style.id === (character.artStyle ?? artStyle))?.label}
                      </p>
                    </div>
                    {(mode === "dialogue" || index > 0) && (
                      <button
                        type="button"
                        aria-label={`Remover ${character.name}`}
                        onClick={() => setCharacters((current) => current.filter((item) => item.id !== character.id))}
                        className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </article>
                ))}
              </div>
              {mode === "dialogue" && characters.length < 6 ? (
                <div className="mt-5">
                  <CharacterForm value={draft} onChange={setDraft} onSubmit={() => addCharacter()} busy={busyCharacter} />
                </div>
              ) : null}
              <ContinueButton onClick={() => go(2)} disabled={!enoughCharacters}>
                Ir para tema e roteiro
              </ContinueButton>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <p className="text-sm font-medium text-[var(--accent-brand)]">Passo 3 de 5</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Tema e roteiro</h1>
              <div className="mt-7 grid gap-5 sm:grid-cols-2">
                <label>
                  <FieldLabel>Tema</FieldLabel>
                  <input
                    data-testid="topic"
                    value={topic}
                    onChange={(event) => setTopic(event.target.value)}
                    maxLength={120}
                    placeholder="Ex.: por que temos medo do futuro?"
                    className="h-11 w-full rounded-xl border bg-transparent px-3 outline-none focus:border-foreground/30"
                  />
                </label>
                {!automatic ? (
                  <label>
                    <FieldLabel>Tom</FieldLabel>
                    <select
                      data-testid="tone"
                      value={tone}
                      onChange={(event) => setTone(event.target.value as Tone)}
                      className="h-11 w-full rounded-xl border bg-background px-3 outline-none"
                    >
                      {tones.map((item) => <option key={item.id} value={item.id}>{item.label}{item.fallback ? " · fallback" : ""}</option>)}
                    </select>
                    {tones.find((item) => item.id === tone)?.fallback ? (
                      <span data-testid="tone-fallback" className="mt-1 block text-xs text-amber-600 dark:text-amber-400">
                        O núcleo aproxima este tom por “{tones.find((item) => item.id === tone)?.coreId}”.
                      </span>
                    ) : null}
                  </label>
                ) : null}
                {!automatic ? (
                  <label>
                    <FieldLabel>Objetivo</FieldLabel>
                    <select
                      data-testid="objective"
                      value={objective}
                      onChange={(event) => setObjective(event.target.value as Objective)}
                      className="h-11 w-full rounded-xl border bg-background px-3 outline-none"
                    >
                      {OBJECTIVES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </label>
                ) : null}
                <label>
                  <FieldLabel>Narrativa</FieldLabel>
                  <select
                    data-testid="narrative"
                    value={narrative}
                    onChange={(event) => setNarrative(event.target.value as Narrative)}
                    className="h-11 w-full rounded-xl border bg-background px-3 outline-none"
                  >
                    {NARRATIVES.filter((item) => mode === "dialogue" ? item.id === "debate" || item.id === "historia" : item.id !== "debate").map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>
                {!automatic ? (
                  <div>
                    <FieldLabel>Duração desejada</FieldLabel>
                    <div className="flex gap-2">
                      {([30, 60, 90] as const).map((seconds) => (
                        <button
                          key={seconds}
                          type="button"
                          data-testid={`duration-${seconds}`}
                          onClick={() => setDuration(seconds)}
                          className={cn(
                            "h-11 flex-1 rounded-xl border text-sm",
                            duration === seconds ? "border-[var(--accent-brand)] bg-[var(--accent-brand)] text-white" : "text-muted-foreground",
                          )}
                        >
                          {seconds}s
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <label className="sm:col-span-2">
                  <FieldLabel>Direção do roteiro (opcional)</FieldLabel>
                  <textarea
                    data-testid="script-prompt"
                    value={scriptPrompt}
                    onChange={(event) => setScriptPrompt(event.target.value)}
                    maxLength={600}
                    rows={4}
                    placeholder="Falas, objetivo, estrutura ou mensagem que precisa aparecer…"
                    className="w-full resize-none rounded-xl border bg-transparent p-3 outline-none focus:border-foreground/30"
                  />
                </label>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Objetivo, duração e direção são enviados no pedido; o núcleo atual só aplica o tom e pode ajustar o tempo à voz.
              </p>
              <ContinueButton onClick={() => go(3)} disabled={!topic.trim()}>
                Escolher cenário
              </ContinueButton>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <p className="text-sm font-medium text-[var(--accent-brand)]">Passo 4 de 5</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Cenário</h1>
              <p className="mt-2 text-muted-foreground">
                {automatic ? "A época, o tema e os personagens definem a ambientação." : "Use a época dos personagens ou dirija a ambientação com suas palavras."}
              </p>
              {automatic ? (
                <div data-testid="auto-scenario" className="mt-7 rounded-2xl border border-[var(--accent-brand)] p-5">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Cenário inferido</p>
                  <p className="mt-1 text-lg font-medium">{autoConfig.scenarioLabel}</p>
                  <p className="mt-2 text-sm text-muted-foreground">Você pode desligar Automático para escolher ou descrever outro cenário.</p>
                </div>
              ) : (
                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  <ChoiceCard
                    data-testid="scenario-auto"
                    active={scenarioMode === "auto"}
                    onClick={() => setScenarioMode("auto")}
                    title="Automático por época"
                    description="A Ágora entra automaticamente para personas clássicas; outros casos usam o estúdio."
                    badge="recomendado"
                  />
                  <ChoiceCard
                    data-testid="scenario-prompt"
                    active={scenarioMode === "prompt"}
                    onClick={() => setScenarioMode("prompt")}
                    title="Descrever cenário"
                    description="Escreva a época, local, luz e atmosfera desejados."
                  />
                </div>
              )}
              {!automatic && scenarioMode === "prompt" ? (
                <label className="mt-5 block">
                  <FieldLabel>Prompt do cenário</FieldLabel>
                  <textarea
                    data-testid="scenario-description"
                    value={scenarioPrompt}
                    onChange={(event) => setScenarioPrompt(event.target.value)}
                    rows={4}
                    placeholder="Ex.: nave retrofuturista, janelas para Saturno, luz azul suave…"
                    className="w-full resize-none rounded-xl border bg-transparent p-3 outline-none focus:border-foreground/30"
                  />
                  <span className="mt-2 block text-xs text-amber-600 dark:text-amber-400">
                    O endpoint de geração por prompt ainda não existe no núcleo. A API tentará usá-lo e cairá para o cenário existente mais próximo.
                  </span>
                </label>
              ) : null}
              <ContinueButton onClick={() => go(4)} disabled={!automatic && scenarioMode === "prompt" && !scenarioPrompt.trim()}>
                Revisar e gerar
              </ContinueButton>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <p className="text-sm font-medium text-[var(--accent-brand)]">Passo 5 de 5</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Pronto para gerar</h1>
              <div className="mt-7 grid gap-3 rounded-2xl border p-5 text-sm sm:grid-cols-2">
                <div><span className="text-muted-foreground">Modo</span><p className="mt-1 font-medium">{mode === "monologue" ? "Monólogo" : `Diálogo · ${characters.length} personagens`}</p></div>
                <div><span className="text-muted-foreground">Configuração</span><p className="mt-1 font-medium">{automatic ? "Automática" : "Manual"}</p></div>
                <div><span className="text-muted-foreground">Elenco</span><p className="mt-1 font-medium">{characters.map((character) => character.name).join(", ")}</p></div>
                <div><span className="text-muted-foreground">Tema</span><p className="mt-1 font-medium">{topic}</p></div>
                <div><span className="text-muted-foreground">Tom e objetivo</span><p className="mt-1 font-medium">{tones.find((item) => item.id === selectedTone)?.label} · {OBJECTIVES.find((item) => item.id === selectedObjective)?.label}</p></div>
                <div><span className="text-muted-foreground">Duração</span><p className="mt-1 font-medium">{selectedDuration}s</p></div>
                <div><span className="text-muted-foreground">Visual</span><p className="mt-1 font-medium">{characterType === "stick" ? "Stick figure" : "Ilustrado Aiwake"} · {ART_STYLES.find((item) => item.id === selectedStyle)?.label}</p></div>
                <div><span className="text-muted-foreground">Cenário</span><p className="mt-1 font-medium">{automatic ? autoConfig.scenarioLabel : scenarioMode === "auto" ? "Automático por época" : scenarioPrompt}</p></div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <FieldLabel>Formato</FieldLabel>
                {(["16:9", "9:16"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    data-testid={`format-${item.replace(":", "x")}`}
                    onClick={() => setFormat(item)}
                    className={cn("rounded-full border px-3 py-1.5 text-sm", format === item && "border-[var(--accent-brand)] text-[var(--accent-brand)]")}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <button
                type="button"
                data-testid="generate"
                disabled={rendering}
                onClick={generate}
                className="mt-4 flex h-12 items-center gap-2 rounded-full bg-[var(--accent-brand)] px-6 font-medium text-white disabled:opacity-50"
              >
                {rendering ? <Loader2 className="size-4 animate-spin" /> : null}
                {rendering ? `Gerando… ${Math.round(progress * 100)}%` : result ? "Gerar novamente" : "Gerar animação"}
              </button>
              {scenarioResolution?.note ? (
                <p data-testid="scenario-fallback" className="mt-3 text-sm text-amber-600 dark:text-amber-400">{scenarioResolution.note}</p>
              ) : null}
              {result && audio ? (
                <div className="mt-8" data-testid="render-result">
                  <Player result={result} audioCtx={audio} fileName={`animind-${characters[0].name.toLowerCase().replace(/\W+/g, "-")}`} />
                  <Transcript result={result} />
                </div>
              ) : null}
            </>
          ) : null}
        </motion.section>
      </AnimatePresence>
    </div>
  );
}
