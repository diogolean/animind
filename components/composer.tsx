"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { ART_STYLES } from "@/lib/contract";
import type {
  ArtStyle,
  Character,
  CharacterType,
  Narrative,
  RenderResult,
  ScenarioRequest,
  ScenarioResolution,
  Tone,
  VideoFormat,
} from "@/lib/contract";
import { HEALTH_EVENT, createCharacter, getTones, resolveScenario, startRender, waitJob } from "@/lib/api";
import { Player } from "@/components/player";
import { Transcript } from "@/components/transcript";
import { CharacterForm, type CharacterDraft } from "@/components/flow/character-form";
import { ChoiceCard } from "@/components/flow/choice-card";
import { Stepper } from "@/components/flow/stepper";

type CreationMode = "monologue" | "dialogue";
type ScenarioMode = "auto" | "prompt";

const DEFAULT_DRAFT: CharacterDraft = { name: "", prompt: "" };
const FALLBACK_TONES = [
  { id: "comedia" as const, label: "Comédia" },
  { id: "ficcao" as const, label: "Ficção" },
  { id: "horror" as const, label: "Horror" },
  { id: "serio" as const, label: "Sério" },
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

export function Composer() {
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [mode, setMode] = useState<CreationMode>("monologue");
  const [draft, setDraft] = useState<CharacterDraft>(DEFAULT_DRAFT);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [characterType, setCharacterType] = useState<CharacterType>("stick");
  const [artStyle, setArtStyle] = useState<ArtStyle>("ghibli");
  const [busyCharacter, setBusyCharacter] = useState(false);
  const [topic, setTopic] = useState("");
  const [scriptPrompt, setScriptPrompt] = useState("");
  const [tone, setTone] = useState<Tone>("comedia");
  const [tones, setTones] = useState(FALLBACK_TONES);
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

  useEffect(() => {
    getTones()
      .then((catalog) => {
        setTones(catalog.tones);
        setTone(catalog.default);
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
        artStyle,
      });
      setCharacters((current) => [...current, character]);
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
    const request: ScenarioRequest =
      scenarioMode === "prompt"
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
        tone,
        narrative,
        targetDurationSec: duration,
        lang: "pt-BR",
        format,
        personaMode: "quick",
        style: artStyle,
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
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-8 sm:px-8 sm:py-12">
      <Stepper current={step} maxStep={maxStep} onSelect={setStep} />
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
                        {characterType === "stick" ? "Stick figure" : "Ilustrado Aiwake"} · {ART_STYLES.find((style) => style.id === artStyle)?.label}
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
                <label>
                  <FieldLabel>Tom</FieldLabel>
                  <select
                    data-testid="tone"
                    value={tone}
                    onChange={(event) => setTone(event.target.value as Tone)}
                    className="h-11 w-full rounded-xl border bg-background px-3 outline-none"
                  >
                    {tones.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
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
              <p className="mt-3 text-xs text-muted-foreground">Duração e direção são metas; o núcleo pode ajustar ao tempo real da voz.</p>
              <ContinueButton onClick={() => go(3)} disabled={!topic.trim()}>
                Escolher cenário
              </ContinueButton>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <p className="text-sm font-medium text-[var(--accent-brand)]">Passo 4 de 5</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Cenário</h1>
              <p className="mt-2 text-muted-foreground">Use a época dos personagens ou dirija a ambientação com suas palavras.</p>
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
              {scenarioMode === "prompt" ? (
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
              <ContinueButton onClick={() => go(4)} disabled={scenarioMode === "prompt" && !scenarioPrompt.trim()}>
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
                <div><span className="text-muted-foreground">Elenco</span><p className="mt-1 font-medium">{characters.map((character) => character.name).join(", ")}</p></div>
                <div><span className="text-muted-foreground">Tema</span><p className="mt-1 font-medium">{topic}</p></div>
                <div><span className="text-muted-foreground">Tom e duração</span><p className="mt-1 font-medium">{tones.find((item) => item.id === tone)?.label} · {duration}s</p></div>
                <div><span className="text-muted-foreground">Visual</span><p className="mt-1 font-medium">{characterType === "stick" ? "Stick figure" : "Ilustrado Aiwake"} · {ART_STYLES.find((item) => item.id === artStyle)?.label}</p></div>
                <div><span className="text-muted-foreground">Cenário</span><p className="mt-1 font-medium">{scenarioMode === "auto" ? "Automático por época" : scenarioPrompt}</p></div>
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
    </main>
  );
}
