"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { STATUS_LABEL } from "@/lib/accounts/labels";
import type { LibraryCharacter, PublicUser } from "@/lib/accounts/types";

async function readLibrary(): Promise<{ characters: LibraryCharacter[]; viewer: PublicUser | null; error: string; notice: string }> {
  const [approvedResponse, libraryResponse] = await Promise.all([
    fetch("/api/library/approved", { cache: "no-store" }),
    fetch("/api/library", { cache: "no-store" }),
  ]);
  const approved = (await approvedResponse.json().catch(() => ({}))) as { characters?: LibraryCharacter[] };
  const catalog = approved.characters ?? [];
  if (libraryResponse.status === 401 || libraryResponse.status === 503) {
    return {
      characters: catalog,
      viewer: null,
      error: catalog.length ? "" : libraryResponse.status === 401 ? "Entre para ver os seus personagens." : "A biblioteca da conta não está disponível neste deploy.",
      notice: libraryResponse.status === 503 && catalog.length ? "A biblioteca da conta não está disponível neste deploy. O catálogo aprovado continua aqui." : "",
    };
  }
  const data = (await libraryResponse.json().catch(() => ({}))) as { error?: string; characters?: LibraryCharacter[]; viewer?: PublicUser };
  if (!libraryResponse.ok) {
    return { characters: catalog, viewer: null, error: data.error ?? "Não foi possível carregar a biblioteca", notice: "" };
  }
  const mine = data.characters ?? [];
  const extra = catalog.filter((character) => !mine.some((item) => item.id === character.id));
  return { characters: [...mine, ...extra], viewer: data.viewer ?? null, error: "", notice: "" };
}

export function MyCharacters() {
  const [viewer, setViewer] = useState<PublicUser | null>(null);
  const [characters, setCharacters] = useState<LibraryCharacter[] | null>(null);
  const [error, setError] = useState("");
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
    setError(next.error);
    setNotice(next.notice);
  }, []);

  useEffect(() => {
    let cancelled = false;
    readLibrary()
      .then((next) => {
        if (cancelled) return;
        setCharacters(next.characters);
        setViewer(next.viewer);
        setError(next.error);
        setNotice(next.notice);
      })
      .catch((cause) => {
        if (!cancelled) setError((cause as Error).message);
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
      const data = (await response.json().catch(() => ({}))) as { error?: string; character?: { name: string } };
      if (!response.ok) throw new Error(data.error ?? "Falha na importação");
      setNotice(`${data.character?.name ?? "Personagem"} entrou na biblioteca.`);
      form.reset();
      await load();
    } catch (cause) {
      setNotice((cause as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div data-testid="my-characters" className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium tracking-tight">Meus personagens</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            {viewer?.role === "super_admin"
              ? "Você vê e gerencia a biblioteca de todo mundo. O Einstein aprovado fica no catálogo."
              : viewer
                ? "Personagens desta conta, mais o catálogo aprovado. Importe uma pasta com puppet.json e as camadas PNG."
                : "O Einstein aprovado está no catálogo. Entre para ver e importar os personagens da sua conta."}
          </p>
          {viewer ? null : (
            <Link href="/login?next=/characters" className="mt-3 inline-block text-sm underline">
              Entrar
            </Link>
          )}
        </div>
      </div>

      {notice ? <p className="mt-6 text-sm text-muted-foreground">{notice}</p> : null}
      {error ? (
        <p data-testid="characters-error" className="mt-6 text-sm text-red-400">
          {error}
        </p>
      ) : null}

      {characters === null ? (
        <p className="mt-10 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando
        </p>
      ) : characters.length === 0 ? (
        <p data-testid="characters-empty" className="mt-10 text-sm text-muted-foreground">
          Nenhum personagem ainda.
        </p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((character) => {
            const angles = cardAngles(character);
            return (
            <li key={character.id}>
              <Link
                href={`/characters/${character.id}`}
                data-testid="character-card"
                className="block overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.03] transition hover:border-white/25"
              >
                {angles ? (
                  <div className="grid grid-cols-3 gap-px bg-black/40">
                    {angles.map((angle) => (
                      <figure key={angle.id} data-testid={angle.testId} className="bg-black/30">
                        <div className="flex aspect-[9/16] items-center justify-center">
                          <img src={angle.url} alt={angle.label} className="size-full object-contain" />
                        </div>
                        <figcaption className="px-1 py-1.5 text-center text-[10px] text-muted-foreground">{angle.label}</figcaption>
                      </figure>
                    ))}
                  </div>
                ) : (
                <div className="flex aspect-[4/5] items-center justify-center bg-black/30">
                  {character.views.front ? (
                    <img src={character.views.front} alt="" className="size-full object-contain" />
                  ) : (
                    <span className="text-xs text-muted-foreground">Sem vista frontal</span>
                  )}
                </div>
                )}
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
          <input name="name" placeholder="Nome (opcional)" className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none" />
          <input name="persona" placeholder="Ref. da ficha (opcional)" className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none" />
        </div>
        <input
          ref={folderRef}
          name="folder"
          data-testid="import-folder"
          type="file"
          multiple
          required
          className="mt-3 block w-full max-w-full text-sm text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-medium file:text-black"
        />
        <button
          type="submit"
          data-testid="import-submit"
          disabled={importing}
          className="mt-4 flex h-10 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black disabled:opacity-50"
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

function cardAngles(character: LibraryCharacter) {
  const left = character.views.three_quarter_left ?? character.views.three_quarter;
  const right = character.views.three_quarter_right;
  const front = character.views.front;
  if (!front || !left || !right) return null;
  return [
    { id: "front", label: "Frente", url: front, testId: "card-view-front" },
    { id: "left", label: "3/4 esquerda", url: left, testId: "card-view-three-quarter-left" },
    { id: "right", label: "3/4 direita", url: right, testId: "card-view-three-quarter-right" },
  ];
}
