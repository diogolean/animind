import Link from "next/link";
import { Clapperboard, Layers, MousePointerClick, ShieldCheck, Smartphone, Swords } from "lucide-react";
import { PromptBar } from "@/components/prompt-bar";
import { HeroPuppet } from "@/components/hero-puppet";

const STEPS = [
  { icon: MousePointerClick, title: "1 · Descreva", text: "Um nome, uma ideia ou um retrato. A factory recorta o personagem em camadas." },
  { icon: Swords, title: "2 · Escolha a cena", text: "Debate, aula ou fala solo, com cenário pronto. Roteiro e voz automáticos." },
  { icon: Clapperboard, title: "3 · Baixe", text: "Prévia renderizada no seu navegador, com a boca no ritmo do áudio." },
];

const FEATURES = [
  { icon: Layers, title: "Camadas de verdade", text: "Cabeça, olhos, sobrancelhas, visemas da boca e corpo, prontos para animar." },
  { icon: ShieldCheck, title: "Paródia responsável", text: "Catálogo só com domínio público, fonte e licença visíveis, aviso de IA em todo vídeo." },
  { icon: Smartphone, title: "Vira app", text: "PWA instalável no celular e no desktop, pronto para as lojas depois." },
];

export default function Home() {
  return (
    <div className="relative overflow-hidden">
      <div className="aurora pointer-events-none absolute inset-0 -z-10" />
      <div className="grid-fade pointer-events-none absolute inset-0 -z-10" />
      <section className="mx-auto flex max-w-6xl flex-col items-center px-4 pt-16 pb-12 text-center sm:pt-24">
        <Link href="/photo" className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs text-muted-foreground backdrop-blur transition hover:text-foreground">
          <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" />
          Novo: modo foto com retratos em domínio público →
        </Link>
        <h1 className="text-gradient max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          Personagens que falam, em três cliques.
        </h1>
        <p className="mt-5 max-w-xl text-balance text-muted-foreground sm:text-lg">
          Digite quem você quer ver falando. O Animind cria o boneco em camadas, escreve a cena e anima a boca no ritmo da voz.
        </p>
        <div className="mt-10 flex w-full justify-center">
          <PromptBar />
        </div>
        <HeroPuppet />
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-10 sm:grid-cols-3">
        {STEPS.map(({ icon: I, title, text }) => (
          <div key={title} className="rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur">
            <I className="size-5 text-violet-400" />
            <h3 className="mt-3 font-medium">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-24 sm:grid-cols-3">
        {FEATURES.map(({ icon: I, title, text }) => (
          <div key={title} className="flex gap-3 rounded-2xl p-5">
            <I className="mt-0.5 size-5 shrink-0 text-cyan-400" />
            <div>
              <h3 className="font-medium">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
