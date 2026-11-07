"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import type { LibraryCharacter, LibraryViewName } from "@/lib/accounts/types";
import type { Character, CharacterView, Layer, ViewName } from "@/lib/contract";

const VIEWS: { id: LibraryViewName; label: string; testId: string; rig: ViewName }[] = [
  { id: "front", label: "Frente", testId: "view-front", rig: "front" },
  { id: "three_quarter_left", label: "3/4 esquerda", testId: "view-three-quarter-left", rig: "left" },
  { id: "three_quarter", label: "3/4 esquerda", testId: "view-three-quarter", rig: "left" },
  { id: "three_quarter_right", label: "3/4 direita", testId: "view-three-quarter-right", rig: "right" },
  { id: "profile", label: "Perfil", testId: "view-profile", rig: "right" },
];

const EMOTION_LABEL: Record<string, string> = {
  happy: "Feliz",
  angry: "Bravo",
  sad: "Triste",
  surprise: "Surpresa",
  smug_smile: "Sorriso",
  ironic: "Irônico",
  stressed_grimace: "Tenso",
};

export function ComposedCharacter({ character, rig }: { character: LibraryCharacter; rig: Character | null }) {
  const views = VIEWS.filter((view) => character.views[view.id]).filter((view) => view.id !== "three_quarter" || !character.views.three_quarter_left);
  const [viewId, setViewId] = useState<LibraryViewName>(views[0]?.id ?? "front");
  const selected = views.find((view) => view.id === viewId) ?? views[0];
  const rigView = selected ? rig?.views[selected.rig] : undefined;
  const hasRig = Boolean(rigView && rigView.layers.length > 0);
  const emotions = Object.keys(rigView?.expressions ?? {});
  const [emotion, setEmotion] = useState("rest");
  const [eyes, setEyes] = useState<"open" | "half" | "closed">("open");
  const missingSides = Boolean(character.views.front) && !character.views.three_quarter_left && !character.views.three_quarter && !character.views.three_quarter_right;
  return (
    <section className="mt-6" data-testid="composed-character">
      <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/30">
        {selected && hasRig && rigView ? (
          <figure data-testid={selected.testId} className="mx-auto w-full max-w-md">
            <ComposedRig view={rigView} emotion={emotion} eyes={eyes} />
          </figure>
        ) : selected && character.views[selected.id] ? (
          <figure data-testid={selected.testId} className="mx-auto flex max-h-[70dvh] w-full max-w-md items-center justify-center">
            <img src={character.views[selected.id]} alt="" className="max-h-[70dvh] w-full object-contain" />
          </figure>
        ) : (
          <p className="px-4 py-10 text-sm text-muted-foreground">Sem vista para compor.</p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            data-testid={`choose-${view.testId}`}
            aria-pressed={selected?.id === view.id}
            onClick={() => {
              setViewId(view.id);
              setEmotion("rest");
            }}
            className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-sm"
          >
            {view.label}
          </button>
        ))}
      </div>
      {emotions.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Choice pressed={emotion === "rest"} onClick={() => setEmotion("rest")} label="Repouso" />
          {emotions.map((name) => (
            <Choice key={name} pressed={emotion === name} onClick={() => setEmotion(name)} label={EMOTION_LABEL[name] ?? name.replaceAll("_", " ")} />
          ))}
        </div>
      ) : null}
      {hasRig ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Choice pressed={eyes === "open"} onClick={() => setEyes("open")} label="Olhos abertos" />
          <Choice pressed={eyes === "half"} onClick={() => setEyes("half")} label="Olhos meio" />
          <Choice pressed={eyes === "closed"} onClick={() => setEyes("closed")} label="Olhos fechados" />
          <Choice pressed label="Sobrancelhas em repouso" />
        </div>
      ) : null}
      {missingSides ? (
        <p className="mt-3 text-sm text-muted-foreground">As vistas 3/4 desta charge ainda não existem. A única vista composta é a frontal.</p>
      ) : null}
    </section>
  );
}

function Choice({ pressed, onClick, label }: { pressed: boolean; onClick?: () => void; label: string }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-sm">
      {label}
    </button>
  );
}

function ComposedRig({ view, emotion, eyes }: { view: CharacterView; emotion: string; eyes: "open" | "half" | "closed" }) {
  const { w, h } = view.canvas;
  const movable = view.layers.some((layer) => layer.name === "eye_socket") && view.layers.some((layer) => layer.name === "iris") && view.layers.some((layer) => layer.name === "eye_white");
  const expression = emotion !== "rest" ? view.expressions?.[emotion] : undefined;
  const mouth = expression ?? view.visemes.X;
  const parts = [
    ...view.layers.filter((layer) => keepLayer(layer, eyes, movable)),
    ...(mouth ? [{ ...mouth, name: expression ? "expression" : "mouth" }] : []),
  ].sort((a, b) => a.z - b.z);
  return (
    <div data-testid="composed-preview" className="relative mx-auto w-full bg-black" style={{ aspectRatio: `${w} / ${h}` }}>
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
    </div>
  );
}

function keepLayer(layer: Layer, eyes: "open" | "half" | "closed", movable: boolean): boolean {
  if (layer.name === "eye_socket") return false;
  if (layer.name === "eyes_closed") return eyes === "closed";
  if (layer.name === "eyes_half") return eyes === "half";
  if (eyes !== "open" && (layer.name === "eyes" || layer.name === "iris" || layer.name === "eye_white")) return false;
  if (movable && eyes === "open" && layer.name === "eyes") return false;
  return true;
}
