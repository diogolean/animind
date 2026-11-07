"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import type { LibraryCharacter, LibraryViewName } from "@/lib/accounts/types";
import type { Character, ViewName } from "@/lib/contract";
import { AvatarStage } from "@/components/avatar-stage";
import { useI18n } from "@/components/locale";
import type { EyeCapability, GazeDirection } from "@/lib/eye-rig";
import type { MessageKey } from "@/lib/i18n";

const VIEWS: { id: LibraryViewName; label: MessageKey; testId: string; rig: ViewName }[] = [
  { id: "front", label: "front", testId: "view-front", rig: "front" },
  { id: "three_quarter_left", label: "left", testId: "view-three-quarter-left", rig: "left" },
  { id: "three_quarter", label: "left", testId: "view-three-quarter", rig: "left" },
  { id: "three_quarter_right", label: "right", testId: "view-three-quarter-right", rig: "right" },
  { id: "profile", label: "profile", testId: "view-profile", rig: "right" },
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

const EN_EMOTION: Record<string, string> = {
  happy: "Happy",
  angry: "Angry",
  sad: "Sad",
  surprise: "Surprise",
  smug_smile: "Smile",
  ironic: "Ironic",
  stressed_grimace: "Tense",
};

export function ComposedCharacter({ character, rig }: { character: LibraryCharacter; rig: Character | null }) {
  const { t, locale } = useI18n();
  const views = VIEWS.filter((view) => character.views[view.id]).filter((view) => view.id !== "three_quarter" || !character.views.three_quarter_left);
  const [viewId, setViewId] = useState<LibraryViewName>(views[0]?.id ?? "front");
  const selected = views.find((view) => view.id === viewId) ?? views[0];
  const rigView = selected ? rig?.views[selected.rig] : undefined;
  const hasRig = Boolean(rigView && rigView.layers.length > 0);
  const emotions = Object.keys(rigView?.expressions ?? {});
  const [emotion, setEmotion] = useState("rest");
  const [eyes, setEyes] = useState<"open" | "half" | "closed">("open");
  const [gaze, setGaze] = useState<GazeDirection>("center");
  const [eyeCapability, setEyeCapability] = useState<EyeCapability | "pending">("pending");
  const lids = Boolean(rigView?.layers.some((layer) => layer.name === "eyes_half" || layer.name === "eyes_closed"));
  const brows = Boolean(rigView?.layers.some((layer) => layer.name === "brows" || layer.name === "brow_left"));
  const gazeReady = eyeCapability === "separable" || eyeCapability === "recovered";
  const missingSides = Boolean(character.views.front) && !character.views.three_quarter_left && !character.views.three_quarter && !character.views.three_quarter_right;
  return (
    <section className="mt-6" data-testid="composed-character">
      <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/30">
        {selected && hasRig && rigView ? (
          <figure data-testid={selected.testId} className="mx-auto w-full max-w-md bg-black">
            <AvatarStage
              view={rigView}
              emotion={emotion}
              lids={eyes}
              gaze={gaze}
              onCapability={(capability) => setEyeCapability(capability)}
            />
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
              setGaze("center");
              setEyeCapability("pending");
            }}
            className={chip(selected?.id === view.id)}
          >
            {t(view.label)}
          </button>
        ))}
      </div>
      {emotions.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Choice pressed={emotion === "rest"} onClick={() => setEmotion("rest")} label={t("rest")} />
          {emotions.map((name) => (
            <Choice key={name} pressed={emotion === name} onClick={() => setEmotion(name)} label={(locale === "en" ? EN_EMOTION : EMOTION_LABEL)[name] ?? name.replaceAll("_", " ")} />
          ))}
        </div>
      ) : null}
      {hasRig && lids ? (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("eyesOpen")}>
          <Choice pressed={eyes === "open"} onClick={() => setEyes("open")} label={t("eyesOpen")} />
          <Choice pressed={eyes === "half"} onClick={() => setEyes("half")} label={t("eyesHalf")} />
          <Choice pressed={eyes === "closed"} onClick={() => setEyes("closed")} label={t("eyesClosed")} />
          {brows ? <Choice pressed label={t("browsRest")} /> : null}
        </div>
      ) : null}
      {hasRig && gazeReady ? (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("gaze")} data-testid="gaze-controls" data-gaze={eyeCapability}>
          {(["center", "left", "right", "up", "down"] as const).map((direction) => (
            <Choice key={direction} pressed={gaze === direction} onClick={() => setGaze(direction)} label={t(GAZE_LABEL[direction])} testId={`gaze-${direction}`} />
          ))}
        </div>
      ) : hasRig && eyeCapability === "unavailable" ? (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="gaze-unavailable">{t("gazeUnavailable")}</p>
      ) : null}
      {missingSides ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("missingSides")}</p>
      ) : null}
    </section>
  );
}

const GAZE_LABEL: Record<GazeDirection, MessageKey> = {
  center: "gazeCenter",
  left: "gazeLeft",
  right: "gazeRight",
  up: "gazeUp",
  down: "gazeDown",
};

function chip(pressed: boolean): string {
  return pressed
    ? "inline-flex min-h-11 items-center rounded-full border border-white bg-white px-4 text-sm text-black outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
    : "inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-sm outline-none hover:border-white/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none";
}

function Choice({ pressed, onClick, label, testId }: { pressed: boolean; onClick?: () => void; label: string; testId?: string }) {
  return (
    <button type="button" data-testid={testId} aria-pressed={pressed} onClick={onClick} className={chip(pressed)}>
      {label}
    </button>
  );
}

