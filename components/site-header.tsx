"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { HEALTH_EVENT } from "@/lib/api";

export function SiteHeader() {
  const [mode, setMode] = useState<{ label: string; tone: string; note?: string } | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/health", { cache: "no-store" })
        .then((r) => r.json())
        .then((h: { mode: string; core?: { ok?: boolean; generator?: string; generatorNote?: string } }) =>
          setMode(
            h.mode === "core"
              ? h.core?.ok
                ? {
                    label: h.core.generator === "gemini" ? "núcleo real" : "núcleo (arte mock)",
                    tone: "text-emerald-600 dark:text-emerald-400",
                    note: h.core.generatorNote,
                  }
                : { label: "núcleo fora do ar", tone: "text-red-600 dark:text-red-400" }
              : h.mode === "mock"
                ? { label: "mock de dev", tone: "text-amber-600 dark:text-amber-400" }
                : { label: "núcleo não configurado", tone: "text-red-600 dark:text-red-400" },
          ),
        )
        .catch(() => {});
    load();
    // A character whose art fell back to mock (Gemini 402 mid-session) changes what the core can do: re-read it.
    window.addEventListener(HEALTH_EVENT, load);
    return () => window.removeEventListener(HEALTH_EVENT, load);
  }, []);
  return (
    <header className="mx-auto flex h-14 w-full max-w-5xl items-center px-6">
      <Link href="/" className="flex items-center gap-2 text-sm font-medium tracking-tight">
        <span className="size-2 rounded-full bg-[var(--accent-brand)]" />
        animind
      </Link>
      {mode && (
        <span data-testid="core-mode" title={mode.note} className="sr-only">
          {mode.label}
        </span>
      )}
    </header>
  );
}
