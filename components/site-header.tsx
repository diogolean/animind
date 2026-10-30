"use client";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Moon, Sun, Sparkles } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 shadow-[0_0_24px_-4px] shadow-violet-500/60">
        <Sparkles className="size-4 text-white" />
      </span>
      Animind
    </Link>
  );
}

export function SiteHeader() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <header className="sticky top-0 z-40 border-b border-border/50 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Logo />
        <nav className="flex items-center gap-1 text-sm">
          <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/create?q=Pirata%20fil%C3%B3sofo">Criar</Link>
          <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/photo">Modo foto</Link>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Alternar tema"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            <Sun className="hidden size-4 dark:block" />
            <Moon className="size-4 dark:hidden" />
          </Button>
        </nav>
      </div>
    </header>
  );
}
