"use client";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { cartoonLayers } from "@/lib/cartoon";
import type { Character } from "@/lib/contract";
import { Puppet } from "./puppet";

const NAMES = ["Vovó Hacker", "Pirata Filósofo", "Robô Professor"];

export function HeroPuppet() {
  const chars = useMemo<Character[]>(
    () =>
      NAMES.map((n) => ({ id: n, name: n, style: "cartoon", canvas: { w: 512, h: 640 }, layers: cartoonLayers(n).layers, createdAt: "" })),
    [],
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className="relative mt-16 w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-violet-500/10 to-transparent p-6 shadow-[0_40px_120px_-40px] shadow-violet-500/40"
    >
      <div className="absolute left-4 top-4 rounded-full bg-yellow-400 px-3 py-1 text-[11px] font-bold text-yellow-950">⚠ Paródia • Gerado por IA</div>
      <div className="flex items-end justify-center gap-2 sm:gap-10">
        {chars.map((c, i) => (
          <div key={c.id} className="flex w-28 flex-col items-center sm:w-44">
            <Puppet character={c} talking={i === 1} seed={i * 7} className="w-full" />
            <span className="mt-2 text-xs text-muted-foreground">{c.name}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
