"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import type { LibraryCharacter, LibraryViewName } from "@/lib/accounts/types";
import type { Character, CharacterView, ViewName, Viseme } from "@/lib/contract";
import { AvatarStage } from "@/components/avatar-stage";
import { useI18n } from "@/components/locale";
import { PackVoice } from "@/components/pack-voice";
import { longSide, MIN_LONG_SIDE, sceneryPreference, type PlateKind, type SceneryState } from "@/lib/avatar-source";
import { controlClass } from "@/lib/control-class";
import type { EyeCapability, GazeDirection } from "@/lib/eye-rig";
import { separableGaze } from "@/lib/eye-rig";
import { fill, type MessageKey } from "@/lib/i18n";
import { packVoiceUrls, viewHasMouth } from "@/lib/pack-voice";
import { SHEET_CELL, SHEET_GRID, sheetGroups, type SheetCategory, type SheetGroup } from "@/lib/sheet";
import { hasFullBody, type Framing } from "@/lib/stage-frame";

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

const CATEGORY_LABEL: Record<SheetCategory, MessageKey> = {
  gaze: "gaze",
  emotion: "sheetEmotion",
  lids: "sheetLids",
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
  const [framing, setFraming] = useState<Framing>(rigView && hasFullBody(rigView) ? "body" : "close");
  const [sceneryOn, setSceneryOn] = useState(false);
  const [sceneryState, setSceneryState] = useState<SceneryState | "pending">("pending");
  const [plate, setPlate] = useState<{ width: number; height: number; kind: PlateKind } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [spoken, setSpoken] = useState<Viseme | null>(null);
  const lids = Boolean(rigView?.layers.some((layer) => layer.name === "eyes_half" || layer.name === "eyes_closed"));
  const brows = Boolean(rigView?.layers.some((layer) => layer.name === "brows" || layer.name === "brow_left"));
  const gazeReady = eyeCapability === "separable" || eyeCapability === "recovered";
  const bodyReady = Boolean(rigView && hasFullBody(rigView));
  const missingSides = Boolean(character.views.front) && !character.views.three_quarter_left && !character.views.three_quarter && !character.views.three_quarter_right;
  const sheet = views.flatMap((view) => {
    const source = rig?.views[view.rig];
    if (!source || source.layers.length === 0) return [];
    const capability = separableGaze(source.layers) ? "separable" : view.id === selected?.id ? eyeCapability : "unavailable";
    return sheetGroups(source, capability).map((group) => ({ view, group }));
  });
  const waiting = hasRig && eyeCapability === "pending" && sheet.length === 0;

  useEffect(() => {
    setSceneryOn(sceneryPreference(window.sessionStorage).read());
  }, []);

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

  return (
    <section className="mt-6" data-testid="composed-character">
      <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-black">
        {selected && hasRig && rigView ? (
          <figure data-testid={selected.testId} data-framing={framing} data-ground="black" className="mx-auto w-full max-w-md bg-black">
            <AvatarStage
              view={rigView}
              emotion={emotion}
              lids={eyes}
              gaze={gaze}
              framing={bodyReady ? framing : "close"}
              scenery={sceneryOn}
              viseme={spoken}
              onCapability={(capability) => setEyeCapability(capability)}
              onScenery={setSceneryState}
              onPlate={setPlate}
            />
          </figure>
        ) : selected && character.views[selected.id] ? (
          <figure data-testid={selected.testId} className="mx-auto flex max-h-[70dvh] w-full max-w-md items-center justify-center bg-black">
            <img src={character.views[selected.id]} alt="" className="max-h-[70dvh] w-full bg-black object-contain" />
          </figure>
        ) : (
          <p className="px-4 py-10 text-sm text-muted-foreground">Sem vista para compor.</p>
        )}
      </div>
      <PackVoice
        key={`${selected?.id ?? "none"}:${packVoiceUrls(character.demos, locale).join("|")}`}
        urls={packVoiceUrls(character.demos, locale)}
        mouths={viewHasMouth(rigView)}
        onViseme={setSpoken}
      />
      <div className="mt-4 flex flex-wrap gap-2" data-testid="view-controls">
        {views.map((view) => (
          <Choice
            key={view.id}
            pressed={selected?.id === view.id}
            testId={`choose-${view.testId}`}
            onClick={() => {
              const next = rig?.views[view.rig];
              setViewId(view.id);
              setEmotion("rest");
              setGaze("center");
              setEyeCapability("pending");
              setSceneryState("pending");
              setPlate(null);
              setFraming(next && hasFullBody(next) ? "body" : "close");
            }}
            label={t(view.label)}
          />
        ))}
      </div>
      {hasRig && bodyReady ? (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("framingBody")} data-testid="framing-controls">
          <Choice pressed={framing === "body"} onClick={() => setFraming("body")} label={t("framingBody")} testId="framing-body" />
          <Choice pressed={framing === "close"} onClick={() => setFraming("close")} label={t("framingClose")} testId="framing-close" />
        </div>
      ) : null}
      {hasRig ? (
        <div className="mt-3 flex flex-wrap items-center gap-3" data-testid="scenery-controls">
          <button
            type="button"
            role="switch"
            aria-checked={sceneryState === "ready" && sceneryOn}
            aria-disabled={sceneryState !== "ready"}
            data-testid="scenery-switch"
            data-scenery={sceneryState}
            className={`${controlClass(sceneryState === "ready" && sceneryOn)} font-medium tracking-wide`}
            onClick={() => {
              if (sceneryState !== "ready") return;
              setSceneryOn((value) => {
                const next = !value;
                sceneryPreference(window.sessionStorage).write(next);
                return next;
              });
            }}
          >
            {t("scenerySwitch")}
          </button>
          {sceneryState === "needs-original" ? <p id="scenery-note" data-testid="scenery-note" className="max-w-md text-sm leading-relaxed text-white/80">{t("sceneryNeedsOriginal")}</p> : null}
          {sceneryState === "needs-scenery" ? <p id="scenery-note" data-testid="scenery-note" className="max-w-md text-sm leading-relaxed text-white/80">{t("sceneryNeedsLayer")}</p> : null}
        </div>
      ) : null}
      {hasRig ? (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("resolution")} data-testid="resolution-controls">
          <button type="button" aria-pressed="true" data-testid="resolution-1k" className={controlClass(true)}>{t("resolution1k")}</button>
          <button type="button" aria-disabled="true" aria-describedby="resolution-note" data-testid="resolution-4k" className={`${controlClass(false)} opacity-60`} onClick={(event) => event.preventDefault()}>{t("resolution4k")}</button>
          <p id="resolution-note" data-testid="resolution-note" className="max-w-md text-sm leading-relaxed text-white/80">
            {plate
              ? fill(t(longSide(plate.width, plate.height) < MIN_LONG_SIDE ? "legacyBelow1k" : "plateSize"), { w: plate.width, h: plate.height })
              : null}{" "}
            {t("resolution4kOff")}
          </p>
        </div>
      ) : null}
      {emotions.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Choice pressed={emotion === "rest"} onClick={() => setEmotion("rest")} label={t("rest")} />
          {emotions.map((name) => (
            <Choice key={name} pressed={emotion === name} onClick={() => setEmotion(name)} label={emotionLabel(name, locale)} />
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
      {missingSides ? <p className="mt-3 text-sm text-muted-foreground">{t("missingSides")}</p> : null}
      {sheet.length ? (
        <section className="mt-8 bg-black" data-testid="emotion-sheet" data-ground="black">
          <h2 className="text-sm font-medium">{t("emotionSheet")}</h2>
          {views.map((view) => {
            const groups = sheet.filter((entry) => entry.view.id === view.id);
            if (!groups.length) return null;
            const source = rig?.views[view.rig];
            if (!source) return null;
            return (
              <div key={view.id} className="mt-4" data-testid={`sheet-${view.testId}`}>
                <h3 className="text-sm text-white/80">{t(view.label)}</h3>
                {groups.map(({ group }) => (
                  <SheetRow key={group.category} view={source} viewId={view.testId} group={group} title={t(CATEGORY_LABEL[group.category])} labelFor={(id) => stateLabel(group.category, id, locale, t)} />
                ))}
              </div>
            );
          })}
        </section>
      ) : waiting ? null : (
        <section className="mt-8">
          <h2 className="text-sm font-medium">{t("emotionSheet")}</h2>
          <div data-testid="emotion-sheet" className="mt-3 overflow-hidden rounded-[1.5rem] border border-white/10 bg-black">
            {character.emotionSheetUrl ? (
              <button type="button" data-testid="emotion-sheet-zoom" onClick={() => setSheetOpen(true)} className="block min-h-11 w-full cursor-zoom-in text-left">
                <img src={character.emotionSheetUrl} alt="" className="w-full bg-black" />
                <span className="block px-4 py-3 text-sm text-muted-foreground">{t("zoom")}</span>
              </button>
            ) : (
              <p className="px-4 py-10 text-sm text-muted-foreground">{t("noSheet")}</p>
            )}
          </div>
        </section>
      )}
      {sheetOpen && character.emotionSheetUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("emotionSheet")}
          data-testid="emotion-sheet-lightbox"
          className="fixed inset-0 z-50 overflow-auto overscroll-contain bg-black px-[max(0.75rem,env(safe-area-inset-left))] pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-8"
          onClick={() => setSheetOpen(false)}
        >
          <div className="sticky top-0 z-10 mb-3 flex justify-end">
            <button type="button" onClick={() => setSheetOpen(false)} className={controlClass(false)}>
              {t("close")}
            </button>
          </div>
          <img data-testid="emotion-sheet-full" src={character.emotionSheetUrl} alt="" className="mx-auto h-auto w-max min-w-full max-w-none bg-black" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </section>
  );
}

function SheetRow({
  view,
  viewId,
  group,
  title,
  labelFor,
}: {
  view: CharacterView;
  viewId: string;
  group: SheetGroup;
  title: string;
  labelFor: (id: string) => string;
}) {
  return (
    <div className="mt-3" data-testid={`sheet-${viewId}-${group.category}`}>
      <h4 className="text-xs uppercase tracking-wide text-white/50">{title}</h4>
      <ul className={`mt-2 ${SHEET_GRID}`}>
        {group.states.map((state) => (
          <li key={state.id} data-testid={`sheet-${viewId}-${group.category}-${state.id}`} className={`${SHEET_CELL} overflow-hidden rounded-2xl bg-black`}>
            <div className="bg-black">
              <AvatarStage view={view} emotion={state.emotion} lids={state.lids} gaze={state.gaze} framing="close" scenery={false} />
            </div>
            <p className="px-2 py-2 text-center text-xs text-white/70">{labelFor(state.id)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function stateLabel(category: SheetCategory, id: string, locale: string, t: (key: MessageKey) => string): string {
  if (category === "gaze") return t(GAZE_LABEL[id as GazeDirection]);
  if (category === "lids") {
    if (id === "half") return t("eyesHalf");
    if (id === "closed") return t("eyesClosed");
    return t("eyesOpen");
  }
  if (id === "rest") return t("rest");
  return emotionLabel(id, locale);
}

function emotionLabel(name: string, locale: string): string {
  return (locale === "en" ? EN_EMOTION : EMOTION_LABEL)[name] ?? name.replaceAll("_", " ");
}

const GAZE_LABEL: Record<GazeDirection, MessageKey> = {
  center: "gazeCenter",
  left: "gazeLeft",
  right: "gazeRight",
  up: "gazeUp",
  down: "gazeDown",
};

function Choice({ pressed, onClick, label, testId }: { pressed: boolean; onClick?: () => void; label: string; testId?: string }) {
  return (
    <button type="button" data-testid={testId} aria-pressed={pressed} onClick={onClick} className={controlClass(pressed)}>
      {label}
    </button>
  );
}
