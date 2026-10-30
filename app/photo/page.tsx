import type { Metadata } from "next";
import { PhotoMode } from "@/components/photo-mode";

export const metadata: Metadata = { title: "Modo foto" };

export default function PhotoPage() {
  return (
    <div className="relative">
      <div className="aurora pointer-events-none absolute inset-0 -z-10 opacity-60" />
      <div className="mx-auto max-w-6xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Modo foto</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Recorte e colagem no estilo Monty Python: a mandíbula do retrato mexe no ritmo da voz. O catálogo tem só retratos em domínio público, com fonte e licença. Pessoas famosas vivas não entram.
        </p>
        <PhotoMode />
      </div>
    </div>
  );
}
