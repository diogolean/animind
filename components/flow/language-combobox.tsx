"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import type { LanguageCode, VoiceLanguage } from "@/lib/contract";

const SUGGESTED = ["en-US", "pt-BR", "es-ES"];
const RECENTS_KEY = "animind-recent-languages";

const fold = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();

const localizedName = (locale: string) => {
  try {
    return new Intl.DisplayNames(["pt-BR"], { type: "language" }).of(locale) ?? "";
  } catch {
    return "";
  }
};

function readRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function languageLabel(language: VoiceLanguage | undefined, fallback: LanguageCode) {
  return language ? `${language.flag ? `${language.flag} ` : ""}${language.nativeName}` : fallback;
}

interface LanguageComboboxProps {
  value: LanguageCode;
  languages: VoiceLanguage[];
  onChange: (value: LanguageCode) => void;
  testId?: string;
  className?: string;
}

export function LanguageCombobox({
  value,
  languages,
  onChange,
  testId = "language-selector",
  className,
}: LanguageComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const ordered = useMemo(() => {
    const priority = [...new Set([...recents, ...SUGGESTED])];
    const rank = new Map(priority.map((id, index) => [id, index]));
    return [...languages].sort((a, b) => {
      const aRank = rank.get(a.id);
      const bRank = rank.get(b.id);
      if (aRank !== undefined || bRank !== undefined) return (aRank ?? Infinity) - (bRank ?? Infinity);
      return a.englishName.localeCompare(b.englishName);
    });
  }, [languages, recents]);

  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return ordered;
    return ordered.filter((language) =>
      fold(`${language.id} ${language.nativeName} ${language.englishName} ${localizedName(language.id)}`).includes(needle),
    );
  }, [ordered, query]);

  const choose = (language: VoiceLanguage) => {
    const nextRecents = [language.id, ...recents.filter((id) => id !== language.id)].slice(0, 5);
    setRecents(nextRecents);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(nextRecents));
    onChange(language.id);
    setOpen(false);
    setQuery("");
  };

  const selected = languages.find((language) => language.id === value);
  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        role="combobox"
        aria-controls={`${testId}-listbox`}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid={testId}
        data-value={value}
        onClick={() => {
          if (!open) setRecents(readRecents());
          setOpen((current) => !current);
        }}
        className="flex h-9 max-w-56 items-center gap-2 rounded-full border border-white/10 bg-background px-3 text-xs transition hover:border-white/25"
      >
        <span className="truncate">{languageLabel(selected, value)}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-[#121316] p-2 shadow-2xl shadow-black/60">
          <label className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              ref={input}
              data-testid={`${testId}-search`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((index) => Math.min(index + 1, filtered.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter" && filtered[active]) {
                  event.preventDefault();
                  choose(filtered[active]);
                } else if (event.key === "Escape") {
                  setOpen(false);
                }
              }}
              placeholder="Buscar idioma ou locale…"
              aria-label="Buscar idioma"
              aria-controls={`${testId}-listbox`}
              aria-activedescendant={filtered[active] ? `${testId}-${filtered[active].id}` : undefined}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <p className="px-2 pt-3 pb-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {query ? `${filtered.length} resultados` : "Recentes e sugeridos primeiro"}
          </p>
          <div id={`${testId}-listbox`} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {filtered.map((language, index) => (
              <button
                id={`${testId}-${language.id}`}
                key={language.id}
                type="button"
                role="option"
                aria-selected={language.id === value}
                data-testid={`${testId}-option-${language.id}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(language)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left",
                  index === active && "bg-white/[0.07]",
                )}
              >
                <span className="w-6 text-lg">{language.flag}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{language.nativeName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{language.englishName} · {language.id}</span>
                </span>
                {language.id === value ? <Check className="size-4 text-[var(--accent-brand)]" /> : null}
              </button>
            ))}
            {!filtered.length ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhum idioma encontrado.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
