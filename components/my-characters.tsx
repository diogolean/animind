"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/locale";
import { apiErrorMessage } from "@/lib/i18n";
import { Loader2 } from "lucide-react";
import { STATUS_LABEL } from "@/lib/accounts/labels";
import type { LibraryCharacter, PublicUser } from "@/lib/accounts/types";

async function readLibrary(): Promise<{ characters: LibraryCharacter[]; viewer: PublicUser | null; errorCode: string }> {
  const libraryResponse = await fetch("/api/library", { cache: "no-store" });
  if (libraryResponse.status === 401) {
    return { characters: [], viewer: null, errorCode: "" };
  }
  const data = (await libraryResponse.json().catch(() => ({}))) as { code?: string; characters?: LibraryCharacter[]; viewer?: PublicUser };
  if (!libraryResponse.ok) {
    return { characters: [], viewer: null, errorCode: data.code || (libraryResponse.status === 503 ? "accounts_unavailable" : "library_load_failed") };
  }
  return { characters: data.characters ?? [], viewer: data.viewer ?? null, errorCode: "" };
}

export function MyCharacters() {
  const { t, locale } = useI18n();
  const [viewer, setViewer] = useState<PublicUser | null>(null);
  const [characters, setCharacters] = useState<LibraryCharacter[] | null>(null);
  const [errorCode, setErrorCode] = useState("");
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
    folderRef.current?.setAttribute("directory", "");
  }, []);

  const load = useCallback(async () => {
    const next = await readLibrary();
    setCharacters(next.characters);
    setViewer(next.viewer);
    setErrorCode(next.errorCode);
  }, []);

  useEffect(() => {
    let cancelled = false;
    readLibrary()
      .then((next) => {
        if (cancelled) return;
        setCharacters(next.characters);
        setViewer(next.viewer);
        setErrorCode(next.errorCode);
      })
      .catch(() => {
        if (!cancelled) setErrorCode("library_load_failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("folder");
    const files = input instanceof HTMLInputElement ? input.files : null;
    if (!files?.length) {
      setNotice("Escolha a pasta do personagem.");
      return;
    }
    const body = new FormData();
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    const persona = (form.elements.namedItem("persona") as HTMLInputElement).value.trim();
    if (name) body.set("name", name);
    if (persona) body.set("personaSheetRef", persona);
    for (const file of files) body.append("file", file, file.webkitRelativePath || file.name);
    setImporting(true);
    setNotice("");
    try {
      const response = await fetch("/api/library/import", { method: "POST", body });
      const data = (await response.json().catch(() => ({}))) as { code?: string; character?: { name: string } };
      if (!response.ok) {
        setNotice(apiErrorMessage(locale, { code: data.code || "import_rejected" }));
        return;
      }
      setNotice(`${data.character?.name ?? "Personagem"} entrou na biblioteca.`);
      form.reset();
      await load();
    } catch {
      setNotice(apiErrorMessage(locale, { code: "import_rejected" }));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div data-testid="my-characters" className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-5 py-6 landscape:py-4 sm:px-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium tracking-tight">{t("charactersTitle")}</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            {viewer?.role === "super_admin"
              ? t("charactersAdmin")
              : viewer
                ? t("charactersOwn")
                : t("charactersGuest")}
          </p>
          {viewer ? null : (
            <Link href="/login?next=/characters" className="mt-3 inline-block text-sm underline">
              {t("signIn")}
            </Link>
          )}
        </div>
      </div>

      {notice ? <p className="mt-6 text-sm text-muted-foreground">{notice}</p> : null}
      {errorCode ? (
        <p data-testid="characters-error" className="mt-6 text-sm text-red-400">
          {apiErrorMessage(locale, { code: errorCode })}
        </p>
      ) : null}

      {characters === null ? (
        <p className="mt-10 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t("loading")}
        </p>
      ) : !viewer ? null : characters.length === 0 ? (
        <p data-testid="characters-empty" className="mt-10 text-sm text-muted-foreground">
          Nenhum personagem ainda.
        </p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((character) => {
            return (
            <li key={character.id}>
              <Link
                href={`/characters/${character.id}`}
                data-testid="character-card"
                className="block overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.03] transition hover:border-white/25"
              >
                <div className="flex aspect-[9/16] items-center justify-center bg-black/30">
                  {character.views.front ? (
                    <img src={character.views.front} alt="" data-testid="card-view-front" className="size-full object-contain" />
                  ) : (
                    <span className="px-3 text-center text-xs text-muted-foreground">Sem vista frontal</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{character.name}</p>
                    {character.catalog ? (
                      <p data-testid="catalog-badge" className="text-xs text-muted-foreground">
                        Catálogo aprovado
                      </p>
                    ) : null}
                    {character.owner ? (
                      <p data-testid="character-owner" className="truncate text-xs text-muted-foreground">
                        {character.owner.name}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {STATUS_LABEL[character.status]}
                  </span>
                </div>
            </Link>
          </li>
            );
          })}
        </ul>
      )}

      {viewer ? <form onSubmit={onImport} data-testid="import-character" className="mt-12 max-w-full rounded-[1.5rem] border border-white/10 bg-white/[0.025] p-5">
        <h2 className="text-sm font-medium">Importar pasta</h2>
        <p className="mt-1 text-sm text-muted-foreground">puppet.json, as vistas que a pasta tiver (frente e 3/4; perfil se houver), ficha de emoções e PNGs em layers/&lt;vista&gt;/.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input name="name" placeholder="Nome (opcional)" className="min-h-11 w-full min-w-0 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-base outline-none" />
          <input name="persona" placeholder="Ref. da ficha (opcional)" className="min-h-11 w-full min-w-0 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-base outline-none" />
        </div>
        <input
          ref={folderRef}
          name="folder"
          data-testid="import-folder"
          type="file"
          multiple
          required
          className="mt-3 block w-full max-w-full text-base text-muted-foreground file:mr-3 file:inline-flex file:min-h-11 file:items-center file:rounded-full file:border-0 file:bg-white file:px-4 file:text-sm file:font-medium file:text-black"
        />
        <button
          type="submit"
          data-testid="import-submit"
          disabled={importing}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black disabled:opacity-50"
        >
          {importing ? <Loader2 className="size-4 animate-spin" /> : null}
          Importar
        </button>
        {notice ? (
          <p data-testid="import-notice" className="mt-3 text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
      </form> : null}
    </div>
  );
}

