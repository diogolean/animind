"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { STATUS_LABEL } from "@/lib/accounts/labels";
import type { LibraryCharacter, PublicUser } from "@/lib/accounts/types";

export function MyCharacters() {
  const router = useRouter();
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
    const response = await fetch("/api/library", { cache: "no-store" });
    if (response.status === 401) {
      router.replace("/login?next=/characters");
      return;
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string; characters?: LibraryCharacter[]; viewer?: PublicUser };
    if (!response.ok) {
      setError(data.error ?? "Não foi possível carregar a biblioteca");
      setCharacters([]);
      return;
    }
    setError("");
    setViewer(data.viewer ?? null);
    setCharacters(data.characters ?? []);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/library", { cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) {
          router.replace("/login?next=/characters");
          return;
        }
        const data = (await response.json().catch(() => ({}))) as { error?: string; characters?: LibraryCharacter[]; viewer?: PublicUser };
        if (cancelled) return;
        if (!response.ok) {
          setError(data.error ?? "Não foi possível carregar a biblioteca");
          setCharacters([]);
          return;
        }
        setViewer(data.viewer ?? null);
        setCharacters(data.characters ?? []);
      })
      .catch((cause) => {
        if (!cancelled) setError((cause as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

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
              ? "Você vê e gerencia a biblioteca de todo mundo."
              : "Personagens desta conta. Importe uma pasta com puppet.json e as camadas PNG."}
          </p>
        </div>
      </div>

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
          {characters.map((character) => (
            <li key={character.id}>
              <Link
                href={`/characters/${character.id}`}
                data-testid="character-card"
                className="block overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.03] transition hover:border-white/25"
              >
                <div className="flex aspect-[4/5] items-center justify-center bg-black/30">
                  {character.views.front ? (
                    <img src={character.views.front} alt="" className="size-full object-contain" />
                  ) : (
                    <span className="text-xs text-muted-foreground">Sem vista frontal</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{character.name}</p>
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
          ))}
        </ul>
      )}

      <form onSubmit={onImport} data-testid="import-character" className="mt-12 rounded-[1.5rem] border border-white/10 bg-white/[0.025] p-5">
        <h2 className="text-sm font-medium">Importar pasta</h2>
        <p className="mt-1 text-sm text-muted-foreground">puppet.json, vistas (frente, 3/4, perfil), ficha de emoções e PNGs das camadas.</p>
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
          className="mt-3 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-medium file:text-black"
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
      </form>
    </div>
  );
}
