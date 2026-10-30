"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

export function SiteHeader() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mode, setMode] = useState<{ label: string; tone: string } | null>(null);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { mode: string; core?: { ok?: boolean; generator?: string } }) =>
        setMode(
          h.mode === "core"
            ? h.core?.ok
              ? { label: h.core.generator === "gemini" ? "núcleo real" : "núcleo (arte mock)", tone: "text-emerald-600 dark:text-emerald-400" }
              : { label: "núcleo fora do ar", tone: "text-red-600 dark:text-red-400" }
            : h.mode === "mock"
              ? { label: "mock de dev", tone: "text-amber-600 dark:text-amber-400" }
              : { label: "núcleo não configurado", tone: "text-red-600 dark:text-red-400" },
        ),
      )
      .catch(() => {});
  }, []);
  return (
    <header className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
      <Link href="/" className="flex items-center gap-2 text-sm font-medium tracking-tight">
        <span className="size-2 rounded-full bg-[var(--accent-brand)]" />
        animind
      </Link>
      {mode && (
        <span data-testid="core-mode" className={`ml-auto mr-3 text-xs ${mode.tone}`}>
          {mode.label}
        </span>
      )}
      <button
        aria-label="Alternar tema"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
      >
        <Sun className="hidden size-4 dark:block" />
        <Moon className="size-4 dark:hidden" />
      </button>
    </header>
  );
}
