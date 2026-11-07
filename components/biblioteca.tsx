"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ASSET_LABEL } from "@/lib/accounts/labels";
import { ASSET_KINDS, type AssetKind, type LibraryAsset, type PublicUser } from "@/lib/accounts/types";

const VISUAL = new Set<AssetKind>(["character", "view", "emotion_sheet", "image"]);

export function Biblioteca() {
  const router = useRouter();
  const [viewer, setViewer] = useState<PublicUser | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null);
  const [kind, setKind] = useState<AssetKind | "">("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const query = kind ? `?kind=${encodeURIComponent(kind)}` : "";
    fetch(`/api/library/catalog${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) {
          router.replace("/login?next=/biblioteca");
          return;
        }
        const data = (await response.json().catch(() => ({}))) as { error?: string; assets?: LibraryAsset[]; viewer?: PublicUser };
        if (!response.ok) {
          setError(data.error ?? "Não foi possível carregar a biblioteca");
          setAssets([]);
          return;
        }
        setViewer(data.viewer ?? null);
        setAssets(data.assets ?? []);
      })
      .catch((cause) => {
        if (!cancelled) setError((cause as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, router]);

  return (
    <div data-testid="biblioteca" className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:px-8">
      <h1 className="text-3xl font-medium tracking-tight">Biblioteca</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        {viewer?.role === "super_admin"
          ? "Tudo o que foi gerado, em todas as contas."
          : "Personagens, vistas, roteiros, áudios e vídeos desta conta."}
      </p>
      <div className="-mx-5 mt-6 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <button type="button" data-testid="asset-filter-all" onClick={() => setKind("")} className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${kind === "" ? "bg-white text-black" : "border border-white/10 text-muted-foreground"}`}>
          Tudo
        </button>
        {ASSET_KINDS.map((item) => (
          <button
            key={item}
            type="button"
            data-testid={`asset-filter-${item}`}
            onClick={() => setKind(item)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${kind === item ? "bg-white text-black" : "border border-white/10 text-muted-foreground"}`}
          >
            {ASSET_LABEL[item]}
          </button>
        ))}
      </div>
      {error ? <p className="mt-6 text-sm text-red-400">{error}</p> : null}
      {assets === null ? (
        <p className="mt-10 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando
        </p>
      ) : assets.length === 0 ? (
        <p data-testid="biblioteca-empty" className="mt-10 text-sm text-muted-foreground">
          Nada neste filtro. Importe um personagem ou termine uma criação.
        </p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((asset) => (
            <li key={asset.id} data-testid="asset-card" data-kind={asset.kind} className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.03]">
              <div className="flex aspect-[4/5] items-center justify-center bg-black/30 p-3">
                {asset.url && VISUAL.has(asset.kind) ? (
                  <img src={asset.url} alt="" className="size-full object-contain" />
                ) : asset.kind === "video" && asset.url ? (
                  <video src={asset.url} controls className="max-h-full max-w-full" />
                ) : asset.kind === "audio" && asset.url ? (
                  <audio src={asset.url} controls className="w-full" />
                ) : (
                  <p className="line-clamp-6 text-sm text-muted-foreground">{asset.text || "Sem prévia"}</p>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{asset.name}</p>
                  {asset.owner ? <p className="truncate text-xs text-muted-foreground">{asset.owner.name}</p> : null}
                  {asset.kind === "character" && asset.characterId?.startsWith("chr_") ? (
                    <Link href={`/characters/${asset.characterId}`} className="text-xs text-muted-foreground underline">
                      Abrir personagem
                    </Link>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {ASSET_LABEL[asset.kind]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
