"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { STATUS_LABEL } from "@/lib/accounts/labels";
import type { LibraryCharacter, LibraryDemo, LibraryStatus, LibraryViewName } from "@/lib/accounts/types";
import { VISEMES, type Character, type CharacterView } from "@/lib/contract";

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
  const [rig, setRig] = useState<Character | null>(null);
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
        const data = (await response.json().catch(() => ({}))) as { error?: string; character?: LibraryCharacter; rig?: Character | null };
        if (!response.ok) throw new Error(data.error ?? "Personagem não encontrado");
        return { character: data.character ?? null, rig: data.rig ?? null };
      })
      .then((next) => {
        if (!cancelled && next?.character) {
          setCharacter(next.character);
          setRig(next.rig);
        }
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
  const viewCard = availableViews.length > 1 ? "w-[min(17.5rem,calc(100vw-4.5rem))] shrink-0 snap-center sm:w-auto sm:shrink" : "w-full";
  return (
    <div data-testid="character-detail" className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-5 py-6 landscape:py-4 sm:px-8 sm:py-10">
      <Link href="/characters" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
        Meus personagens
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-medium tracking-tight">{character.name}</h1>
          <p className="mt-2 break-words text-sm text-muted-foreground">
            Ficha: {character.personaSheetRef ? <span data-testid="persona-ref">{character.personaSheetRef}</span> : "sem referência"}
          </p>
          {character.owner ? (
            <p data-testid="character-owner" className="mt-1 break-words text-sm text-muted-foreground">
              Conta: {character.owner.name} · {character.owner.email}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {character.catalog ? (
            <span data-testid="catalog-badge" className="rounded-full border border-white/15 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
              Catálogo aprovado
            </span>
          ) : (
            <>
          <label className="text-xs uppercase tracking-wide text-muted-foreground" htmlFor="character-status">
            Status
          </label>
          <select
            id="character-status"
            data-testid="character-status"
            value={character.status}
            disabled={pending}
            onChange={(event) => changeStatus(event.target.value as LibraryStatus)}
            className="min-h-11 rounded-full border border-white/10 bg-black/30 px-3 text-base"
          >
            {(Object.keys(STATUS_LABEL) as LibraryStatus[]).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
            </>
          )}
        </div>
      </div>

      <div data-testid="view-strip" className={`mt-6 flex w-full min-w-0 snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-1 max-sm:-mx-5 max-sm:px-5 max-sm:scroll-px-5 sm:grid sm:overflow-visible ${viewColumns}`}>
        {availableViews.map((view) => (
          <figure key={view.id} data-testid={view.testId} className={`${viewCard} overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/30`}>
            <div className="flex aspect-[3/4] items-center justify-center bg-black max-sm:landscape:aspect-square sm:aspect-[9/16]">
              <img src={character.views[view.id]} alt={view.label} className="size-full object-contain" />
            </div>
            <figcaption className="px-4 py-3 text-sm">{view.label}</figcaption>
          </figure>
        ))}
      </div>
      <PackPieces character={character} />

      {rig?.views.front.layers.length ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Prévia muda</h2>
          <p className="mt-1 text-sm text-muted-foreground">A boca troca no ritmo das formas aprovadas. Sem áudio e sem o núcleo.</p>
          <div className="mt-3 overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/30">
            <MouthPreview view={rig.views.front} />
          </div>
        </section>
      ) : null}

      {mouthLayers(character).length ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Bocas</h2>
          <ul className="mt-3 grid grid-cols-3 gap-2 min-[400px]:gap-3 sm:grid-cols-5 lg:grid-cols-9">
            {mouthLayers(character).map((layer) => (
              <li key={layer.name} data-testid={`mouth-${layer.name}`} className="overflow-hidden rounded-2xl border border-white/10 bg-[#f2c9a0]">
                <div className="flex aspect-square items-center justify-center p-2">
                  <img src={layer.url} alt={`Boca ${layer.name}`} className="max-h-full max-w-full object-contain" />
                </div>
                <p className="break-words border-t border-white/10 px-2 py-1.5 text-center text-xs">{layer.name}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-medium">Ficha de emoções</h2>
        <div data-testid="emotion-sheet" className="mt-3 overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/30">
          {character.emotionSheetUrl ? (
            <button type="button" data-testid="emotion-sheet-zoom" onClick={() => setSheetOpen(true)} className="block min-h-11 w-full cursor-zoom-in text-left">
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
          className="fixed inset-0 z-50 overflow-auto overscroll-contain bg-black/95 px-[max(0.75rem,env(safe-area-inset-left))] pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-8"
          onClick={() => setSheetOpen(false)}
        >
          <div className="sticky top-0 z-10 mb-3 flex justify-end">
            <button type="button" onClick={() => setSheetOpen(false)} className="inline-flex min-h-11 items-center rounded-full border border-white/20 bg-black/80 px-4 text-sm">
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

      {character.layers.length && !character.catalog ? (
        <p className="mt-4 text-xs text-muted-foreground">{character.layers.length} camadas no armazenamento de objetos.</p>
      ) : null}
      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {ready ? (
          <>
            <Link href={`/?library=${encodeURIComponent(character.id)}&intent=video`} data-testid="use-video" className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-medium text-black">
              Novo vídeo
            </Link>
            <Link href={`/?library=${encodeURIComponent(character.id)}&intent=debate`} data-testid="use-debate" className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 px-5 text-sm font-medium">
              Debate
            </Link>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Marque o personagem como pronto para usá-lo num vídeo ou debate.</p>
        )}
        {character.catalog ? null : (
          <button type="button" data-testid="delete-character" disabled={pending} onClick={remove} className="inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm text-red-400">
            Apagar
          </button>
        )}
      </div>
      {character.demos?.length ? <Demos demos={character.demos} /> : null}
    </div>
  );
}

function viewFolder(url: string): string {
  const match = url.match(/layers\/([^/]+)\//);
  if (match?.[1] === "three-quarter") return "3/4 esquerda";
  if (match?.[1] === "three-quarter-right") return "3/4 direita";
  if (match?.[1] === "front") return "frente";
  return match?.[1] ?? "";
}

function PackPieces({ character }: { character: LibraryCharacter }) {
  const eyes = character.layers.filter((layer) => layer.name === "eyes" || layer.name.startsWith("eye") || layer.name === "iris");
  const brows = character.layers.filter((layer) => layer.name.includes("brow"));
  const expressions = character.layers.filter((layer) => layer.url.includes("/expressions/"));
  if (!eyes.length && !brows.length && !expressions.length) return null;
  return (
    <div className="mt-8 space-y-8">
      {eyes.length ? <PieceGrid title="Olhos" testId="pack-eyes" pieces={eyes} /> : null}
      {brows.length ? <PieceGrid title="Sobrancelhas" testId="pack-brows" pieces={brows} /> : null}
      {expressions.length ? <PieceGrid title="Expressões" testId="pack-expressions" pieces={expressions} /> : null}
    </div>
  );
}

function PieceGrid({ title, testId, pieces }: { title: string; testId: string; pieces: LibraryCharacter["layers"] }) {
  return (
    <section data-testid={testId}>
      <h2 className="text-sm font-medium">{title}</h2>
      <ul className="mt-3 grid grid-cols-2 gap-2 min-[400px]:grid-cols-3 min-[400px]:gap-3 sm:grid-cols-5">
        {pieces.map((piece) => {
          const folder = viewFolder(piece.url);
          return (
            <li key={piece.url} className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
              <div className="flex aspect-square items-center justify-center p-2">
                <img src={piece.url} alt="" className="max-h-full max-w-full object-contain" />
              </div>
              <p className="break-words border-t border-white/10 px-2 py-1.5 text-center text-xs">
                {piece.name}
                {folder ? ` · ${folder}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function mouthLayers(character: LibraryCharacter) {
  const names = new Set<string>(VISEMES);
  return VISEMES.flatMap((name) => character.layers.filter((layer) => layer.name === name && names.has(layer.name)));
}

function MouthPreview({ view }: { view: CharacterView }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((current) => (current + 1) % VISEMES.length), 320);
    return () => clearInterval(timer);
  }, []);
  const viseme = VISEMES[index] ?? "X";
  const mouth = view.visemes[viseme];
  const { w, h } = view.canvas;
  const movable =
    view.layers.some((layer) => layer.name === "eye_socket") &&
    view.layers.some((layer) => layer.name === "iris") &&
    view.layers.some((layer) => layer.name === "eye_white");
  const parts = [...view.layers, ...(mouth ? [{ ...mouth, name: "mouth" }] : [])]
    .filter((layer) => {
      if (layer.name === "eye_socket" || layer.name === "eyes_closed" || layer.name === "eyes_half") return false;
      if (movable && layer.name === "eyes") return false;
      return true;
    })
    .sort((a, b) => a.z - b.z);
  return (
    <div data-testid="mouth-preview" data-viseme={viseme} className="relative mx-auto w-full max-w-md bg-black" style={{ aspectRatio: `${w} / ${h}` }}>
      {parts.map((layer) => (
        <img
          key={`${layer.name}-${layer.url}`}
          src={layer.url}
          alt=""
          className="absolute max-w-none"
          style={{
            left: `${(layer.x / w) * 100}%`,
            top: `${(layer.y / h) * 100}%`,
            width: `${(layer.w / w) * 100}%`,
            height: `${(layer.h / h) * 100}%`,
            zIndex: layer.z,
          }}
        />
      ))}
      <p className="absolute bottom-3 left-3 rounded-full bg-black/70 px-3 py-1 text-xs">Boca {viseme}</p>
    </div>
  );
}

function Demos({ demos }: { demos: LibraryDemo[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium">Demos do pacote</h2>
      <ul className="mt-3 grid gap-4 sm:grid-cols-2">
        {demos.map((demo) => (
          <li key={demo.id} data-testid={demo.id} className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/30">
            <p className="px-4 pt-4 text-sm">{demo.label}</p>
            <div className="p-4">
              {demo.kind === "video" && demo.url ? <video src={demo.url} controls muted playsInline preload="metadata" className="max-w-full w-full rounded-xl" /> : null}
              {demo.kind === "audio" && demo.url ? <audio src={demo.url} controls preload="metadata" className="w-full" /> : null}
              {demo.kind === "image" && demo.url ? <img src={demo.url} alt={demo.label} className="w-full rounded-xl" /> : null}
              {demo.kind === "script" && demo.text ? <p className="text-sm leading-relaxed text-muted-foreground">{demo.text}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
