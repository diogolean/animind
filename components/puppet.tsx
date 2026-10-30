"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { Character, Viseme } from "@/lib/contract";

const CYCLE: Viseme[] = ["mouth_A", "mouth_E", "mouth_M", "mouth_O", "mouth_A", "mouth_rest", "mouth_E", "mouth_M"];

/** Lightweight DOM puppet (no audio): assembled layers, blinking and babbling. */
export function Puppet({ character, talking = true, className = "", seed = 0 }: { character: Character; talking?: boolean; className?: string; seed?: number }) {
  const [tick, setTick] = useState(seed);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 130);
    return () => clearInterval(id);
  }, []);
  const vis: Viseme = talking ? CYCLE[tick % CYCLE.length] : "mouth_rest";
  const blink = tick % 26 === 0;
  const { w, h } = character.canvas;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  if (character.photo) {
    const j = character.photo.jaw;
    const drop = talking && vis !== "mouth_M" && vis !== "mouth_rest" ? (vis === "mouth_A" ? 1 : 0.6) : 0;
    return (
      <div className={`relative overflow-hidden rounded-xl bg-white p-1.5 shadow-2xl ${className}`}>
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={character.photo.url} alt={character.name} className="block w-full" />
          <div className="absolute bg-[#1a0b0b]" style={{ left: `${j.x * 100}%`, top: `${j.y * 100}%`, width: `${j.w * 100}%`, height: `${j.h * 55 * drop}%` }} />
          <div
            className="absolute overflow-hidden border-2 border-white/90 transition-transform duration-100"
            style={{ left: `${j.x * 100}%`, top: `${j.y * 100}%`, width: `${j.w * 100}%`, height: `${j.h * 100}%`, transform: `translateY(${drop * 55}%)` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={character.photo.url} alt="" className="absolute max-w-none" style={{ width: `${100 / j.w}%`, left: `${(-j.x / j.w) * 100}%`, top: `${(-j.y / j.h) * 100}%` }} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <motion.div className={`relative ${className}`} style={{ aspectRatio: `${w}/${h}` }} animate={{ y: [0, -4, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: seed * 0.4 }}>
      {[...character.layers]
        .sort((a, b) => a.z - b.z)
        .filter((l) => (l.name.startsWith("mouth_") ? l.name === vis : l.name === "eyes" ? !blink : l.name === "eyes_closed" ? blink : true))
        .map((l) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={l.name}
            src={l.url}
            alt=""
            draggable={false}
            className="absolute select-none"
            style={{ left: pct(l.x, w), top: pct(l.y + (l.name === "brows" && talking && vis === "mouth_A" ? -6 : 0), h), width: pct(l.w, w), height: pct(l.h, h) }}
          />
        ))}
    </motion.div>
  );
}
