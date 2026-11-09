"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AvatarStage } from "@/components/avatar-stage";
import { PendingFace } from "@/components/pending-face";
import { useI18n } from "@/components/locale";
import { apiErrorMessage, fill, statusLabel, type MessageKey } from "@/lib/i18n";
import { sceneryPreference, type PlateKind } from "@/lib/avatar-source";
import type { CharacterView } from "@/lib/contract";
import { isChargeName } from "@/lib/charge-parity";
import { pairPlates, replaceSharedScenery, sceneryChoice, sharedBackground } from "@/lib/library-pair";
import { Loader2 } from "lucide-react";
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
      setNotice(t("importChooseFolder"));
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
      setNotice(fill(t("importAdded"), { name: data.character?.name ?? t("importFallbackName") }));
      form.reset();
      await load();
    } catch {
      setNotice(apiErrorMessage(locale, { code: "import_rejected" }));
    } finally {
      setImporting(false);
    }
  }

  const [sceneryOn, setSceneryOn] = useState(false);
  const [sceneryId, setSceneryId] = useState<string | null>(null);

  useEffect(() => {
    setSceneryOn(sceneryPreference(window.sessionStorage).read());
    setSceneryId(sceneryChoice(window.sessionStorage).read());
  }, []);
  const plates = pairPlates(characters ?? []);
  const pair = sharedBackground(plates, sceneryId, sceneryOn);
  const pairNote: MessageKey = pair.reason === "needs-original" ? "sharedPairOriginal" : pair.mode === "on" ? "sharedPairOn" : pair.reason === "ready" ? "sharedPairHeld" : "sharedPairOff";

  return (
    <div data-testid="my-characters" className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col px-5 py-6 landscape:py-4 sm:px-8 sm:py-10">
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
          {t("charactersEmpty")}
        </p>
      ) : (
        <>
        <div data-testid="shared-scenery" data-mode={pair.mode} data-reason={pair.reason} data-baked={pair.reason === "needs-original" ? "true" : "false"} className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={pair.mode === "on"}
            aria-disabled={pair.reason !== "ready"}
            data-testid="shared-scenery-switch"
            className="rounded-full border border-white/15 px-4 py-2 text-sm"
            onClick={(event) => {
              if (pair.reason !== "ready") {
                event.preventDefault();
                return;
              }
              setSceneryOn((value) => {
                const next = !value;
                sceneryPreference(window.sessionStorage).write(next);
                return next;
              });
            }}
          >
            {t("scenerySwitch")}
          </button>
          <label className="text-sm text-white/80" htmlFor="replace-scenery">
            {t("replaceScenery")}
          </label>
          <select
            id="replace-scenery"
            data-testid="replace-scenery"
            disabled={pair.choices.length === 0}
            value={pair.sceneryId ?? ""}
            onChange={(event) => {
              const next = replaceSharedScenery(plates, sceneryId, event.target.value, true);
              if (next.mode !== "on" || !next.sceneryId) return;
              setSceneryId(next.sceneryId);
              setSceneryOn(true);
              sceneryChoice(window.sessionStorage).write(next.sceneryId);
              sceneryPreference(window.sessionStorage).write(true);
            }}
            className="min-h-11 rounded-full border border-white/10 bg-black px-3 text-sm disabled:opacity-50"
          >
            {pair.choices.length === 0 ? <option value="">{t("sceneryOff")}</option> : pair.choices.map((id) => (
              <option key={id} value={id}>{id.split("/").pop()}</option>
            ))}
          </select>
          <p data-testid="shared-scenery-note" className="max-w-xl text-sm leading-relaxed text-white/80">{t(pairNote)}</p>
        </div>
        <ul data-testid="character-pair" data-fit="contain" data-template="face" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((character) => {
            return (
            <li key={character.id} className="min-w-0">
              <Link
                href={`/characters/${character.id}`}
                data-testid="character-card"
                className="flex w-full flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-black transition hover:border-white/25"
              >
                <CharacterFace character={character} pendingLabel={t("pendingPart")} emptyLabel={t("noFrontView")} scenery={pair.mode === "on"} sceneryId={pair.sceneryId} />
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{character.name}</p>
                    {character.catalog ? (
                      <p data-testid="catalog-badge" className="text-xs text-muted-foreground">
                        {t("approvedCatalog")}
                      </p>
                    ) : null}
                    {character.owner ? (
                      <p data-testid="character-owner" className="truncate text-xs text-muted-foreground">
                        {character.owner.name}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {statusLabel(locale, character.status)}
                  </span>
                </div>
            </Link>
          </li>
            );
          })}
        </ul>
        </>
      )}

      {viewer ? <form onSubmit={onImport} data-testid="import-character" className="mt-12 max-w-full rounded-[1.5rem] border border-white/10 bg-white/[0.025] p-5">
        <h2 className="text-sm font-medium">{t("importFolder")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("importFolderHint")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input name="name" placeholder={t("importNamePlaceholder")} className="min-h-11 w-full min-w-0 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-base outline-none" />
          <input name="persona" placeholder={t("importSheetPlaceholder")} className="min-h-11 w-full min-w-0 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-base outline-none" />
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
          {t("importSubmit")}
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

function CharacterFace({ character, pendingLabel, emptyLabel, scenery, sceneryId }: { character: LibraryCharacter; pendingLabel: string; emptyLabel: string; scenery: boolean; sceneryId: string | null }) {
  const [view, setView] = useState<CharacterView | null>(null);
  const [kind, setKind] = useState<PlateKind | "pending" | "source">("pending");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/library/${character.id}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { rig?: { views?: { front?: CharacterView } } } | null) => {
        if (cancel) return;
        setLoaded(true);
        const front = data?.rig?.views?.front;
        if (front && front.layers.some((layer) => layer.name === "head" || layer.name === "torso")) {
          setView(front);
          return;
        }
        if (isChargeName(character.name)) {
          setKind("pending");
          return;
        }
        setKind("source");
      })
      .catch(() => {
        if (cancel) return;
        setLoaded(true);
        setKind(isChargeName(character.name) ? "pending" : "source");
      });
    return () => {
      cancel = true;
    };
  }, [character.id, character.name]);

  if (!view) {
    if (!loaded) return <div data-template="face" data-ground="black" data-plate="pending" className="aspect-[4/5] bg-black" />;
    if (kind === "pending" || isChargeName(character.name)) return <PendingFace label={pendingLabel} />;
    return (
      <div data-template="face" data-ground="black" data-plate="source" className="flex aspect-[4/5] items-center justify-center bg-black">
        {kind === "source" && character.views.front ? (
          <img src={character.views.front} alt="" data-testid="card-view-front" className="max-h-full max-w-full object-contain" />
        ) : kind === "source" ? (
          <span className="px-3 text-center text-xs text-muted-foreground">{emptyLabel}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div data-testid="card-stage" data-template="face" data-ground={kind === "baked" ? "baked" : "black"} data-plate={kind} className="aspect-[4/5] bg-black">
      <AvatarStage view={view} emotion="neutral" lids="open" gaze="center" framing="close" scenery={scenery} sceneryId={sceneryId} onPlate={(plate) => setKind(plate.kind)} />
    </div>
  );
}

