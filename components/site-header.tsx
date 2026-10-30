"use client";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

export function SiteHeader() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <header className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
      <Link href="/" className="flex items-center gap-2 text-sm font-medium tracking-tight">
        <span className="size-2 rounded-full bg-[var(--accent-brand)]" />
        animind
      </Link>
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
