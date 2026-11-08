"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HEALTH_EVENT } from "@/lib/api";
import type { PublicUser } from "@/lib/accounts/types";
import { LanguageToggle, useI18n } from "@/components/locale";
import { translate } from "@/lib/i18n";

export function SiteHeader() {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setMode] = useState<{ label: string; tone: string; note?: string } | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  useEffect(() => {
    let current = true;
    const load = () =>
      fetch("/api/health", { cache: "no-store" })
        .then((r) => r.json())
        .then((h: { mode: string; core?: { ok?: boolean; generator?: string; generatorNote?: string } }) => {
          if (!current) return;
          setMode(
            h.mode === "core"
              ? h.core?.ok
                ? {
                    label: h.core.generator === "gemini" ? translate(locale, "coreLive") : translate(locale, "coreMockArt"),
                    tone: "text-emerald-600 dark:text-emerald-400",
                    note: h.core.generatorNote,
                  }
                : { label: translate(locale, "coreDown"), tone: "text-red-600 dark:text-red-400" }
              : h.mode === "mock"
                ? { label: translate(locale, "coreDevMock"), tone: "text-amber-600 dark:text-amber-400" }
                : { label: translate(locale, "coreUnconfigured"), tone: "text-red-600 dark:text-red-400" },
          );
        })
        .catch(() => {});
    load();
    window.addEventListener(HEALTH_EVENT, load);
    return () => {
      current = false;
      window.removeEventListener(HEALTH_EVENT, load);
    };
  }, [locale]);
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
      {user ? (
        <>
          <Link href="/characters" data-testid="my-characters-link" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
            {t("characters")}
          </Link>
          {user.role === "super_admin" ? (
            <Link href="/admin/gastos" data-testid="spend-link" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
              {t("spend")}
            </Link>
          ) : null}
          <Link href="/biblioteca" data-testid="biblioteca-link" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
            {t("library")}
          </Link>
          <span className="hidden text-sm text-muted-foreground sm:inline">{user.name}</span>
          <span data-testid="account-role" data-role={user.role} className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {user.role === "super_admin" ? t("roleSuper") : user.role === "admin" ? t("roleAdmin") : t("roleUser")}
          </span>
          <button type="button" data-testid="logout" onClick={logout} className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
            {t("signOut")}
          </button>
          <LanguageToggle />
        </>
      ) : (
        <>
        <Link href="/login" data-testid="login-link" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
          {t("signIn")}
        </Link>
        <LanguageToggle />
        </>
      )}
      </nav>
      {mode && (
        <span data-testid="core-mode" title={mode.note} className={`basis-full text-xs ${mode.tone}`}>
          {mode.label}
        </span>
      )}
    </header>
  );
}
