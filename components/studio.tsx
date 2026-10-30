"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { BookOpen, Check, Loader2, Mic, Swords } from "lucide-react";
import type { Character, CharacterSource, RenderResult, Scenario, SceneTemplate } from "@/lib/contract";
import { createCharacter, startRender, waitJob } from "@/lib/api";
import { LayerViewer } from "./layer-viewer";
import { Player } from "./player";

const TEMPLATES: { id: SceneTemplate; title: string; text: string; icon: typeof Swords; scenario: Scenario }[] = [
  { id: "debate", title: "Debate / Confronto", text: "Dois personagens, réplica e tréplica.", icon: Swords, scenario: "arena" },
  { id: "lesson", title: "Aula / Educação", text: "Lousa com tópicos e explicação.", icon: BookOpen, scenario: "classroom" },
  { id: "solo", title: "Fala solo", text: "Monólogo direto pra câmera.", icon: Mic, scenario: "studio" },
];
const SCENARIOS: { id: Scenario; label: string; swatch: string }[] = [
  { id: "studio", label: "Estúdio", swatch: "from-violet-600 to-zinc-900" },
  { id: "classroom", label: "Sala de aula", swatch: "from-emerald-700 to-emerald-950" },
  { id: "arena", label: "Arena", swatch: "from-rose-600 to-rose-950" },
  { id: "space", label: "Espaço", swatch: "from-indigo-900 to-black" },
];

function Step({ n, title, active, done, children }: { n: number; title: string; active: boolean; done: boolean; children: React.ReactNode }) {
  return (
    <section className={`rounded-3xl border p-5 transition sm:p-7 ${active ? "border-violet-400/30 bg-card/70 shadow-2xl shadow-violet-500/5" : "border-border/50 bg-card/30"}`}>
      <div className="mb-5 flex items-center gap-3">
        <span className={`grid size-7 place-items-center rounded-full text-xs font-semibold ${done ? "bg-emerald-500 text-white" : "bg-violet-500/20 text-violet-300"}`}>
          {done ? <Check className="size-4" /> : n}
        </span>
        <h2 className="text-lg font-medium tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function Studio({ source }: { source: CharacterSource | null }) {
  const [char, setChar] = useState<Character | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [topic, setTopic] = useState("");
  const [template, setTemplate] = useState<SceneTemplate | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<RenderResult | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!source || started.current) return;
    started.current = true;
    createCharacter({ source })
      .then(setChar)
      .catch((e: Error) => setErr(e.message));
  }, [source]);

  async function pick(t: (typeof TEMPLATES)[number]) {
    if (!char) return;
    audio.current ??= new AudioContext();
    void audio.current.resume();
    setTemplate(t.id);
    setResult(null);
    setProgress(0);
    const sc = scenario ?? t.scenario;
    try {
      const cast = [char];
      if (t.id === "debate") cast.push(await createCharacter({ source: { kind: "prompt", prompt: `Rival de ${char.name}`.slice(0, 40) } }));
      const job = await startRender({ characters: cast, template: t.id, scenario: sc, topic: topic || undefined, lang: "pt-BR" });
      const done = await waitJob(job.id, (j) => setProgress(j.progress));
      // Keep the full local rigs (the job may return lightweight copies).
      setResult({ ...done.result!, characters: cast });
    } catch (e) {
      toast.error((e as Error).message);
      setTemplate(null);
    }
  }

  if (!source)
    return <p className="text-muted-foreground">Nenhum personagem informado. Volte para a página inicial e digite um nome.</p>;

  return (
    <div className="space-y-5">
      <Step n={1} title={char ? `${char.name} pronto` : "Recortando personagem em camadas…"} active={!template} done={!!char}>
        <AnimatePresence mode="wait">
          {err ? (
            <p className="text-sm text-destructive">{err}</p>
          ) : char ? (
            <motion.div key="v" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <LayerViewer character={char} />
            </motion.div>
          ) : (
            <motion.div key="s" exit={{ opacity: 0 }} className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
              <div className="aspect-[4/5] animate-pulse rounded-2xl bg-muted/40" />
              <div className="grid grid-cols-5 gap-2">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/40" style={{ animationDelay: `${i * 80}ms` }} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Step>

      <Step n={2} title="Escolha a cena" active={!!char && !result} done={!!result}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => setScenario(s.id)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${scenario === s.id ? "border-violet-400 bg-violet-500/10 text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
            >
              <span className={`size-3 rounded-full bg-gradient-to-br ${s.swatch}`} /> {s.label}
            </button>
          ))}
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Tema (opcional)"
            className="ml-auto h-8 w-full rounded-full border border-border/60 bg-transparent px-3 text-xs outline-none focus:border-violet-400 sm:w-56"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {TEMPLATES.map((t) => {
            const on = template === t.id;
            return (
              <motion.button
                key={t.id}
                data-testid={`tpl-${t.id}`}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
                disabled={!char || (!!template && !result)}
                onClick={() => pick(t)}
                className={`relative overflow-hidden rounded-2xl border p-5 text-left transition disabled:opacity-50 ${on ? "border-violet-400 bg-violet-500/10" : "border-border/60 bg-muted/20 hover:border-violet-400/40"}`}
              >
                <t.icon className="size-5 text-violet-400" />
                <div className="mt-3 font-medium">{t.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t.text}</div>
                {on && !result && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-violet-300">
                    <Loader2 className="size-3 animate-spin" /> Roteiro e voz… {progress}%
                  </div>
                )}
              </motion.button>
            );
          })}
        </div>
      </Step>

      <Step n={3} title="Prévia e download" active={!!result} done={false}>
        {result && audio.current ? (
          <Player key={`${result.template}-${result.scenario}-${progress}`} result={result} audioCtx={audio.current} fileName={`animind-${char?.name.toLowerCase().replace(/\W+/g, "-")}-${result.template}`} />
        ) : (
          <div className="grid aspect-video place-items-center rounded-2xl border border-dashed border-border/60 text-sm text-muted-foreground">
            {template ? "Renderizando…" : "Escolha uma cena para ver a prévia"}
          </div>
        )}
      </Step>
    </div>
  );
}
