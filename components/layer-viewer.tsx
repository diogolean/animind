"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Layers3, Combine } from "lucide-react";
import type { Character, Layer } from "@/lib/contract";
import { Button } from "@/components/ui/button";
import { Puppet } from "./puppet";

const LABEL: Record<string, string> = {
  head: "Cabeça",
  eyes: "Olhos",
  eyes_closed: "Olhos (piscada)",
  brows: "Sobrancelhas",
  body: "Corpo",
  mouth_rest: "Boca · repouso",
  mouth_A: "Visema A",
  mouth_E: "Visema E/I",
  mouth_O: "Visema O/U",
  mouth_M: "Visema M/B/P",
};
const ORDER = ["head", "eyes", "eyes_closed", "brows", "body", "mouth_rest", "mouth_A", "mouth_E", "mouth_O", "mouth_M"];

function LayerTile({ l, i }: { l: Layer; i: number }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: 0.05 * i, type: "spring", stiffness: 260, damping: 22 }}
      className="group flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-[repeating-conic-gradient(#ffffff08_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-2"
    >
      <div className="grid h-16 w-full place-items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={l.url} alt={LABEL[l.name]} className="max-h-16 max-w-full drop-shadow-[0_4px_12px_rgba(124,92,255,.35)] transition group-hover:scale-110" />
      </div>
      <span className="text-[11px] text-muted-foreground">{LABEL[l.name]}</span>
    </motion.div>
  );
}

export function LayerViewer({ character }: { character: Character }) {
  const [exploded, setExploded] = useState(true);
  const layers = [...character.layers].sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
  const photo = character.photo;
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="relative flex items-end justify-center overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-b from-violet-500/15 via-transparent to-cyan-500/10 p-6">
        <div className="absolute left-3 top-3 rounded-full bg-yellow-400 px-2.5 py-0.5 text-[10px] font-bold text-yellow-950">⚠ Paródia • Gerado por IA</div>
        <Puppet character={character} className="w-full max-w-[260px]" />
      </div>
      <div className="flex flex-col">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-medium">Camadas recortadas</h3>
            <p className="text-xs text-muted-foreground">
              {photo ? "Recorte estilo colagem: cabeça + mandíbula sincronizada com o áudio." : `${layers.length} camadas prontas para o motor Rigly.`}
            </p>
          </div>
          {!photo && (
            <Button variant="outline" size="sm" onClick={() => setExploded((e) => !e)}>
              {exploded ? <Combine /> : <Layers3 />} {exploded ? "Pilha 3D" : "Grade"}
            </Button>
          )}
        </div>
        {photo ? (
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Cabeça (estática)", clip: `inset(0 0 ${(1 - photo.jaw.y) * 100}% 0)` },
              { label: "Mandíbula (móvel)", clip: `inset(${photo.jaw.y * 100}% ${(1 - photo.jaw.x - photo.jaw.w) * 100}% ${(1 - photo.jaw.y - photo.jaw.h) * 100}% ${photo.jaw.x * 100}%)` },
            ].map((p, i) => (
              <motion.div key={p.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="rounded-xl border border-border/60 bg-[repeating-conic-gradient(#ffffff08_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={p.label} className="w-full" style={{ clipPath: p.clip }} />
                <span className="mt-1 block text-center text-[11px] text-muted-foreground">{p.label}</span>
              </motion.div>
            ))}
            {photo.attribution && (
              <p className="col-span-2 text-[11px] text-muted-foreground">
                Fonte: <a className="underline" href={photo.attribution.sourceUrl} target="_blank" rel="noreferrer">{photo.attribution.title}</a> · {photo.attribution.author} · {photo.attribution.license}
              </p>
            )}
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {exploded ? (
              <motion.div key="grid" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {layers.map((l, i) => <LayerTile key={l.name} l={l} i={i} />)}
              </motion.div>
            ) : (
              <motion.div key="stack" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative mx-auto aspect-[512/640] w-48 [perspective:900px]">
                {layers.filter((l) => !l.name.startsWith("mouth_") || l.name === "mouth_rest").filter((l) => l.name !== "eyes_closed").map((l, i) => (
                  <motion.img
                    key={l.name}
                    src={l.url}
                    alt=""
                    className="absolute"
                    initial={{ rotateX: 50, rotateZ: -20, y: -i * 26, opacity: 0 }}
                    animate={{ rotateX: 50, rotateZ: -20, y: -i * 26 + 60, opacity: 1 }}
                    transition={{ delay: i * 0.06, type: "spring" }}
                    style={{ left: `${(l.x / 512) * 100}%`, top: `${(l.y / 640) * 100}%`, width: `${(l.w / 512) * 100}%` }}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
