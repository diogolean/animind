"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { translate, type Locale, type MessageKey } from "@/lib/i18n";

const KEY = "animindly-locale";

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
}>({
  locale: "en",
  setLocale: () => undefined,
  t: (key) => translate("en", key),
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  useEffect(() => {
    const stored = window.localStorage.getItem(KEY);
    if (stored === "pt-BR" || stored === "en") setLocaleState(stored);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = (next: Locale) => {
    window.localStorage.setItem(KEY, next);
    setLocaleState(next);
  };
  return (
    <LocaleContext.Provider value={{ locale, setLocale, t: (key) => translate(locale, key) }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useI18n() {
  return useContext(LocaleContext);
}

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  const next = locale === "en" ? "pt-BR" : "en";
  return (
    <button
      type="button"
      data-testid="locale-toggle"
      aria-pressed={locale === "pt-BR"}
      aria-label={t("language")}
      onClick={() => setLocale(next)}
      className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-3 text-sm text-muted-foreground"
    >
      {locale === "en" ? "EN" : "PT"}
    </button>
  );
}

export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground/70">{t("footer")}</footer>
  );
}
