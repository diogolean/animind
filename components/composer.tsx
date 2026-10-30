"use client";
/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { Character, CharacterSource, RenderResult, Scenario, SceneTemplate } from "@/lib/contract";
import { createCharacter, startRender, waitJob } from "@/lib/api";
import { PORTRAITS, portraitImageUrl } from "@/lib/catalog";
import { Avatar } from "@/components/avatar";
import { Player } from "@/components/player";
import { Transcript } from "@/components/transcript";
import { Checkbox } from "@/components/ui/checkbox";

const SCENES: { id: SceneTemplate; label: string }[] = [
  { id: "debate", label: "Debate" },
  { id: "lesson", label: "Aula" },
  { id: "solo", label: "Solo" },
];
const PLACES: { id: Scenario; label: string }[] = [
  { id: "studio", label: "Estúdio" },
  { id: "classroom", label: "Sala" },
  { id: "arena", label: "Arena" },
  { id: "space", label: "Espaço" },
];
const ease = [0.22, 1, 0.36, 1] as const;

function Chip({ active, children, ...p }: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      {...p}
      className={cn(
        "h-8 rounded-full border px-3.5 text-sm transition-colors disabled:opacity-40",
        active ? "border-[var(--accent-brand)] bg-[var(--accent-brand)] text-white" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function Composer() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [char, setChar] = useState<Character | null>(null);
  const [scene, setScene] = useState<SceneTemplate | null>(null);
  const [place, setPlace] = useState<Scenario>("studio");
  const [result, setResult] = useState<RenderResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [audio, setAudio] = useState<AudioContext | null>(null);
  const [portraits, setPortraits] = useState(false);
  const [upload, setUpload] = useState<string | null>(null);
  const [rights, setRights] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [topic, setTopic] = useState("");
  const [rival, setRival] = useState("O cético");
  // One rival character per name, so a second debate does not pay for a new one.
  const rivals = useRef(new Map<string, Character>());

  const ensureAudio = () => {
    if (audio) return audio;
    const a = new AudioContext();
    setAudio(a);
    return a;
  };

  async function pick(source: CharacterSource) {
    setBusy(true);
    setResult(null);
    setScene(null);
    setPortraits(false);
    try {
      setChar(await createCharacter({ source }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function render(tpl: SceneTemplate, where = place) {
    if (!char) return;
    ensureAudio();
    setScene(tpl);
    setResult(null);
    setProgress(0);
    try {
      const chars = [char];
      if (tpl === "debate") {
        const name = rival.trim() || "O cético";
        let other = rivals.current.get(name);
        if (!other) {
          other = await createCharacter({ source: { kind: "prompt", prompt: name } });
          rivals.current.set(name, other);
        }
        chars.push(other);
      }
      const job = await startRender({ characters: chars, template: tpl, scenario: where, topic: topic.trim() || undefined, lang: "pt-BR" });
      const done = await waitJob(job.id, (j) => setProgress(j.progress));
      const r = done.result!;
      // The core may echo characters without heavy fields (photo data URLs); keep our local copies.
      setResult({ ...r, characters: r.characters.map((c, i) => (c.photo && !c.photo.url ? chars[i] : c)) });
    } catch (e) {
      toast.error((e as Error).message);
      setScene(null);
    }
  }

  const reset = () => {
    setChar(null);
    setResult(null);
    setScene(null);
    setQ("");
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6">
      <motion.div layout transition={{ duration: 0.5, ease }} className={cn("flex flex-col", char ? "pt-8" : "flex-1 justify-center pb-24")}>
        {!char && (
          <motion.h1 layout="position" className="mb-8 text-center text-4xl font-semibold tracking-tight sm:text-5xl">
            Quem vai falar?
          </motion.h1>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) pick({ kind: "prompt", prompt: q.trim() });
          }}
          className="group relative"
        >
          <input
            data-testid="prompt"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Um pirata filósofo, Darwin, sua avó…"
            autoFocus
            className="h-14 w-full rounded-full border border-border bg-transparent pr-14 pl-6 text-base outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/25"
          />
          <button
            data-testid="create"
            disabled={!q.trim() || busy}
            aria-label="Criar"
            className="absolute top-2 right-2 grid size-10 place-items-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-20"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </form>
        {!char && (
          <button onClick={() => setPortraits((v) => !v)} className="mx-auto mt-5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            {portraits ? "Fechar" : "ou use um retrato"}
          </button>
        )}
        <AnimatePresence>
          {portraits && !char && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease }} className="mt-8">
              <div className="flex gap-3 overflow-x-auto pb-2">
                {PORTRAITS.map((p) => (
                  <button key={p.id} data-testid={`portrait-${p.id}`} onClick={() => pick({ kind: "catalog", portraitId: p.id })} className="group w-24 shrink-0 text-left">
                    <img src={portraitImageUrl(p.id)} alt={p.name} className="aspect-[4/5] w-full rounded-xl object-cover grayscale transition group-hover:grayscale-0" />
                    <div className="mt-1.5 truncate text-xs">{p.name}</div>
                    <a href={p.attribution.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block truncate text-[10px] text-muted-foreground hover:underline">
                      {p.attribution.license} · Wikimedia
                    </a>
                  </button>
                ))}
                <button onClick={() => file.current?.click()} className="grid aspect-[4/5] w-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-border text-muted-foreground hover:text-foreground">
                  {upload ? <img src={upload} alt="Sua foto" className="size-full object-cover" /> : <Plus className="size-5" />}
                </button>
                <input
                  ref={file}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = () => setUpload(String(r.result));
                    r.readAsDataURL(f);
                  }}
                />
              </div>
              {upload && (
                <div className="mt-4 flex items-start justify-between gap-4">
                  <label className="flex items-start gap-2.5 text-xs text-muted-foreground">
                    <Checkbox data-testid="rights" checked={rights} onCheckedChange={(v) => setRights(!!v)} className="mt-0.5" />
                    Tenho os direitos sobre esta imagem e ela não retrata uma pessoa famosa viva.
                  </label>
                  <button
                    data-testid="use-upload"
                    disabled={!rights}
                    onClick={() => pick({ kind: "upload", imageDataUrl: upload, name: "Sua foto", rightsConfirmed: true })}
                    className="h-8 shrink-0 rounded-full bg-foreground px-4 text-sm text-background disabled:opacity-20"
                  >
                    Usar
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {char && (
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease, delay: 0.1 }} className="py-10">
            {!result && (
              <div className="mx-auto mb-10 w-40">
                <Avatar character={char} loading={!!scene} />
                <div className="mt-3 flex items-center justify-center gap-1.5 text-sm">
                  {char.name}
                  <button onClick={reset} aria-label="Trocar" className="text-muted-foreground hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </div>
                {char.photo?.attribution && (
                  <a href={char.photo.attribution.sourceUrl} target="_blank" rel="noreferrer" className="block text-center text-[11px] text-muted-foreground hover:underline">
                    {char.photo.attribution.author} · {char.photo.attribution.license}
                  </a>
                )}
              </div>
            )}
            {result && audio && (
              <div className="mb-8">
                <Player result={result} audioCtx={audio} fileName={`animind-${char.name.toLowerCase().replace(/\W+/g, "-")}`} />
                <Transcript result={result} />
              </div>
            )}
            <div className="flex flex-col items-center gap-3">
              <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
                <input
                  data-testid="topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  maxLength={120}
                  placeholder="Tema (ex.: a verdade)"
                  className="h-9 flex-1 rounded-full border bg-transparent px-4 text-sm outline-none focus:border-foreground/40"
                />
                <input
                  data-testid="rival"
                  value={rival}
                  onChange={(e) => setRival(e.target.value)}
                  maxLength={60}
                  placeholder="Rival no debate"
                  title="Rival no debate"
                  className="h-9 rounded-full border bg-transparent px-4 text-sm outline-none focus:border-foreground/40 sm:w-44"
                />
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SCENES.map((s) => (
                  <Chip key={s.id} data-testid={`tpl-${s.id}`} active={scene === s.id} disabled={!!scene && !result} onClick={() => render(s.id)}>
                    {scene === s.id && !result ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : null}
                    {s.label}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap justify-center gap-1">
                {PLACES.map((p) => (
                  <button
                    key={p.id}
                    data-testid={`place-${p.id}`}
                    onClick={() => {
                      setPlace(p.id);
                      if (scene && result) render(scene, p.id);
                    }}
                    className={cn("h-7 rounded-full px-3 text-xs transition-colors", place === p.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {scene && !result && <div className="mt-2 text-xs text-muted-foreground tabular-nums">{Math.round(progress * 100)}%</div>}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
