"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { STATUS_LABEL } from "@/lib/accounts/labels";
import type { LibraryCharacter, LibraryStatus, LibraryViewName } from "@/lib/accounts/types";

const VIEWS: { id: LibraryViewName; label: string; testId: string }[] = [
  { id: "front", label: "Frente", testId: "view-front" },
  { id: "three_quarter_left", label: "3/4 esquerda", testId: "view-three-quarter-left" },
  { id: "three_quarter", label: "3/4 esquerda", testId: "view-three-quarter" },
  { id: "three_quarter_right", label: "3/4 direita", testId: "view-three-quarter-right" },
  { id: "profile", label: "Perfil", testId: "view-profile" },
];

export function CharacterDetail() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [character, setCharacter] = useState<LibraryCharacter | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!sheetOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSheetOpen(false);
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/library/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace(`/login?next=/characters/${id}`);
          return null;
        }
        const data = (await response.json().catch(() => ({}))) as { error?: string; character?: LibraryCharacter };
        if (!response.ok) throw new Error(data.error ?? "Personagem não encontrado");
        return data.character ?? null;
      })
      .then((next) => {
        if (!cancelled && next) setCharacter(next);
      })
      .catch((cause) => {
        if (!cancelled) setError((cause as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  async function changeStatus(status: LibraryStatus) {
    setPending(true);
    try {
      const response = await fetch(`/api/library/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; character?: LibraryCharacter };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível atualizar");
      if (data.character) setCharacter(data.character);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    try {
      const response = await fetch(`/api/library/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Não foi possível apagar");
      }
      router.push("/characters");
    } catch (cause) {
      setError((cause as Error).message);
      setPending(false);
    }
  }

  if (error && !character) {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-16">
        <p className="text-sm text-red-400">{error}</p>
        <Link href="/characters" className="mt-4 inline-block text-sm underline">
          Voltar
        </Link>
      </div>
    );
  }
  if (!character) {
    return (
      <p className="mx-auto flex w-full max-w-5xl items-center gap-2 px-5 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando
      </p>
    );
  }

  const ready = character.status === "ready";
  const availableViews = VIEWS.filter((view) => character.views[view.id]).filter(
    (view) => view.id !== "three_quarter" || !character.views.three_quarter_left,
  );
  const viewColumns = availableViews.length >= 3 ? "sm:grid-cols-3" : availableViews.length === 2 ? "sm:grid-cols-2" : "";
  const viewCard = availableViews.length > 1 ? "w-[min(78vw,20rem)] shrink-0 snap-center sm:w-auto sm:shrink" : "w-full";
  return (
    <div data-testid="character-detail" className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:px-8">
      <Link href="/characters" className="text-sm text-muted-foreground hover:text-foreground">
        Meus personagens
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium tracking-tight">{character.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ficha: {character.personaSheetRef ? <span data-testid="persona-ref">{character.personaSheetRef}</span> : "sem referência"}
          </p>
          {character.owner ? (
            <p data-testid="character-owner" className="mt-1 text-sm text-muted-foreground">
              Conta: {character.owner.name} · {character.owner.email}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs uppercase tracking-wide text-muted-foreground" htmlFor="character-status">
            Status
          </label>
          <select
            id="character-status"
            data-testid="character-status"
            value={character.status}
            disabled={pending}
            onChange={(event) => changeStatus(event.target.value as LibraryStatus)}
            className="rounded-full border border-white/10 bg-black/30 px-3 py-2 text-sm"
          >
            {(Object.keys(STATUS_LABEL) as LibraryStatus[]).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={`mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 sm:grid sm:overflow-visible ${viewColumns}`}>
        {availableViews.map((view) => (
          <figure key={view.id} data-testid={view.testId} className={`${viewCard} overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/30`}>
            <div className="flex aspect-[3/4] items-center justify-center bg-black sm:aspect-[9/16]">
              <img src={character.views[view.id]} alt={view.label} className="size-full object-contain" />
            </div>
            <figcaption className="px-4 py-3 text-sm">{view.label}</figcaption>
          </figure>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-medium">Ficha de emoções</h2>
        <div data-testid="emotion-sheet" className="mt-3 overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/30">
          {character.emotionSheetUrl ? (
            <button type="button" data-testid="emotion-sheet-zoom" onClick={() => setSheetOpen(true)} className="block w-full cursor-zoom-in text-left">
              <img src={character.emotionSheetUrl} alt="Ficha de emoções" className="w-full" />
              <span className="block px-4 py-3 text-sm text-muted-foreground">Toque para ver em tamanho real</span>
            </button>
          ) : (
            <p className="px-4 py-10 text-sm text-muted-foreground">Esta pasta não trouxe uma ficha de emoções.</p>
          )}
        </div>
      </section>
      {sheetOpen && character.emotionSheetUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Ficha de emoções em tamanho real"
          data-testid="emotion-sheet-lightbox"
          className="fixed inset-0 z-50 overflow-auto overscroll-contain bg-black/95 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-8"
          onClick={() => setSheetOpen(false)}
        >
          <div className="sticky top-0 z-10 mb-3 flex justify-end">
            <button type="button" onClick={() => setSheetOpen(false)} className="rounded-full border border-white/20 bg-black/80 px-4 py-2 text-sm">
              Fechar
            </button>
          </div>
          <img
            data-testid="emotion-sheet-full"
            src={character.emotionSheetUrl}
            alt="Ficha de emoções em tamanho real"
            className="mx-auto h-auto w-max min-w-full max-w-none"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}

      {character.layers.length ? (
        <p className="mt-4 text-xs text-muted-foreground">{character.layers.length} camadas no armazenamento de objetos.</p>
      ) : null}
      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      <div className="mt-8 flex flex-wrap gap-3">
        {ready ? (
          <>
            <Link href={`/?library=${encodeURIComponent(character.id)}&intent=video`} data-testid="use-video" className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black">
              Novo vídeo
            </Link>
            <Link href={`/?library=${encodeURIComponent(character.id)}&intent=debate`} data-testid="use-debate" className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium">
              Debate
            </Link>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Marque o personagem como pronto para usá-lo num vídeo ou debate.</p>
        )}
        <button type="button" data-testid="delete-character" disabled={pending} onClick={remove} className="rounded-full px-4 py-2.5 text-sm text-red-400">
          Apagar
        </button>
      </div>
    </div>
  );
}
