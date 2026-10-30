"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ImagePlus, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const EXAMPLES = ["Pirata filósofo", "Robô professor de física", "Vovó hacker", "Dinossauro advogado"];

export function PromptBar() {
  const [q, setQ] = useState("");
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const go = (v = q) => v.trim() && router.push(`/create?q=${encodeURIComponent(v.trim())}`);
  return (
    <div className="w-full max-w-2xl">
      <motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        onSubmit={(e) => { e.preventDefault(); go(); }}
        className="group relative flex items-center gap-2 rounded-2xl border border-white/10 bg-card/80 p-2 shadow-2xl shadow-violet-500/10 ring-1 ring-black/5 backdrop-blur-xl transition focus-within:border-violet-400/50 focus-within:shadow-violet-500/25"
      >
        <Wand2 className="ml-3 size-5 shrink-0 text-violet-400" />
        <input
          data-testid="prompt"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Digite um personagem ou suba uma foto…"
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 sm:text-lg"
        />
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => {
              sessionStorage.setItem("animind:upload", JSON.stringify({ name: f.name.replace(/\.\w+$/, ""), data: r.result }));
              router.push("/photo?upload=1");
            };
            r.readAsDataURL(f);
          }}
        />
        <Button type="button" variant="ghost" size="icon-lg" aria-label="Subir uma foto" onClick={() => file.current?.click()}>
          <ImagePlus className="size-5" />
        </Button>
        <Button data-testid="create" type="submit" size="lg" className="h-11 rounded-xl px-5 text-sm font-semibold" disabled={!q.trim()}>
          Criar <ArrowRight className="size-4" />
        </Button>
      </motion.form>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            onClick={() => go(e)}
            className="rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs text-muted-foreground transition hover:border-violet-400/50 hover:text-foreground"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
