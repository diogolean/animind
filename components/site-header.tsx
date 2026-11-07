"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HEALTH_EVENT } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/accounts/labels";
import type { PublicUser } from "@/lib/accounts/types";

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setMode] = useState<{ label: string; tone: string; note?: string } | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
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
    window.addEventListener(HEALTH_EVENT, load);
    return () => window.removeEventListener(HEALTH_EVENT, load);
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = (await response.json()) as { user?: PublicUser | null };
        return data.user ?? null;
      })
      .then((next) => {
        if (!cancelled) setUser(next);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-6">
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium tracking-tight">
        <span className="size-2 rounded-full bg-[var(--accent-brand)]" />
        animindly
      </Link>
      <nav className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-1">
      <Link href="/characters" data-testid="my-characters-link" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
        Meus personagens
      </Link>
      {user ? (
        <>
          <Link href="/biblioteca" data-testid="biblioteca-link" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
            Biblioteca
          </Link>
          <span className="hidden text-sm text-muted-foreground sm:inline">{user.name}</span>
          <span data-testid="account-role" data-role={user.role} className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {ROLE_LABEL[user.role]}
          </span>
          <button type="button" data-testid="logout" onClick={logout} className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
            Sair
          </button>
        </>
      ) : (
        <Link href="/login" data-testid="login-link" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
          Entrar
        </Link>
      )}
      </nav>
      {mode && (
        <span data-testid="core-mode" title={mode.note} className="sr-only">
          {mode.label}
        </span>
      )}
    </header>
  );
}
