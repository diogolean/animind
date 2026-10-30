"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ExternalLink, ImagePlus, ShieldCheck } from "lucide-react";
import { PORTRAITS, portraitImageUrl } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function PhotoMode() {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ name: string; data: string } | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("animind:upload");
    if (raw) queueMicrotask(() => setUpload(JSON.parse(raw)));
  }, []);

  const onFile = (f?: File) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const u = { name: f.name.replace(/\.\w+$/, ""), data: String(r.result) };
      sessionStorage.setItem("animind:upload", JSON.stringify(u));
      setUpload(u);
      setOk(false);
    };
    r.readAsDataURL(f);
  };

  const confirm = () => {
    if (!upload || !ok) return;
    sessionStorage.setItem("animind:upload-confirmed", JSON.stringify(upload));
    router.push("/create?upload=1");
  };

  return (
    <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">Catálogo · domínio público</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {PORTRAITS.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="group overflow-hidden rounded-2xl border border-border/60 bg-card/60 backdrop-blur"
            >
              <button data-testid={`portrait-${p.id}`} onClick={() => router.push(`/create?portrait=${p.id}`)} className="block w-full text-left">
                <div className="relative aspect-[4/5] overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={portraitImageUrl(p.id)} alt={p.name} loading="lazy" className="size-full object-cover object-top transition duration-500 group-hover:scale-105" />
                  <span className="absolute right-2 top-2 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">{p.attribution.license}</span>
                </div>
                <div className="p-3">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.years}</div>
                </div>
              </button>
              <a href={p.attribution.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 border-t border-border/50 px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground">
                <ExternalLink className="size-3" /> {p.attribution.author} · Wikimedia Commons
              </a>
            </motion.div>
          ))}
        </div>
      </section>
      <section id="upload" className="h-fit rounded-3xl border border-border/60 bg-card/60 p-6 backdrop-blur lg:sticky lg:top-20">
        <h2 className="font-medium">Subir sua foto</h2>
        <p className="mt-1 text-sm text-muted-foreground">Retrato de frente, boca fechada, boa luz.</p>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <button
          onClick={() => file.current?.click()}
          className="mt-4 grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-2xl border border-dashed border-border bg-muted/20 transition hover:border-violet-400/60"
        >
          {upload ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={upload.data} alt="Sua foto" className="size-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <ImagePlus className="size-6" /> Escolher imagem
            </span>
          )}
        </button>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-sm">
          <Checkbox data-testid="rights" checked={ok} onCheckedChange={(v) => setOk(!!v)} className="mt-0.5" />
          <span>
            Confirmo que tenho direito de usar esta imagem, que ela não retrata uma pessoa famosa viva e que o vídeo será publicado como <b>paródia gerada por IA</b>.
          </span>
        </label>
        <Button className="mt-4 w-full" size="lg" disabled={!upload || !ok} onClick={confirm}>
          <ShieldCheck /> Animar esta foto
        </Button>
        <p className="mt-3 text-[11px] text-muted-foreground">Todo vídeo sai com o aviso visível “Paródia • Gerado por IA”.</p>
      </section>
    </div>
  );
}
