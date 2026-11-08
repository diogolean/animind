"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import type { LibraryCharacter } from "@/lib/accounts/types";
import { VISEMES, type Character, type CharacterView, type Viseme } from "@/lib/contract";
import { AvatarStage } from "@/components/avatar-stage";
import { useI18n } from "@/components/locale";
import { PackVoice } from "@/components/pack-voice";
import { longSide, MIN_LONG_SIDE, sceneryPreference, type PlateKind, type SceneryState } from "@/lib/avatar-source";
import { controlClass } from "@/lib/control-class";
import type { EyeCapability, GazeDirection } from "@/lib/eye-rig";
import { separableGaze } from "@/lib/eye-rig";
import { fill, type MessageKey } from "@/lib/i18n";
import { packVoiceUrls, viewHasMouth } from "@/lib/pack-voice";
import { capsFromView, emotionTags, hoverTag, initialMap, leaveMap, NEUTRAL, pinTag, shownPose, type EmotionCaps, type MapState } from "@/lib/emotion-map";
import { sceneryChoice } from "@/lib/library-pair";
import { controllerSlots, normalizedAnchors, poseAt, visemePresent, type ControllerSlotId } from "@/lib/puppet-controller";
import { SHEET_CELL, SHEET_GRID, sheetGroups, type SheetCategory, type SheetGroup } from "@/lib/sheet";
import { hasFullBody, type Framing } from "@/lib/stage-frame";

const SLOT_META: { id: ControllerSlotId; label: MessageKey; testId: string }[] = [
  { id: "front", label: "front", testId: "view-front" },
  { id: "three_quarter_left", label: "left", testId: "view-three-quarter-left" },
  { id: "three_quarter_right", label: "right", testId: "view-three-quarter-right" },
  { id: "profile", label: "profile", testId: "view-profile" },
];

const EMOTION_LABEL: Record<string, string> = {
  happy: "Feliz",
  angry: "Bravo",
  sad: "Triste",
  surprise: "Surpresa",
  smug_smile: "Sorriso",
  ironic: "Irônico",
  stressed_grimace: "Tenso",
  surprised: "Surpreso",
  thoughtful: "Pensativo",
};

const EN_EMOTION: Record<string, string> = {
  happy: "Happy",
  angry: "Angry",
  sad: "Sad",
  surprise: "Surprise",
  smug_smile: "Smile",
  ironic: "Ironic",
  stressed_grimace: "Tense",
  surprised: "Surprised",
  thoughtful: "Thoughtful",
};

const CATEGORY_LABEL: Record<SheetCategory, MessageKey> = {
  gaze: "gaze",
  emotion: "sheetEmotion",
  lids: "sheetLids",
};

export function ComposedCharacter({ character, rig }: { character: LibraryCharacter; rig: Character | null }) {
  const { t, locale } = useI18n();
  const slots = controllerSlots(character.views, rig);
  const [slotId, setSlotId] = useState<ControllerSlotId>("front");
  const [holding, setHolding] = useState(false);
  const active = slots.find((slot) => slot.id === slotId && slot.present) ?? slots.find((slot) => slot.present) ?? slots[0];
  const selected = SLOT_META.find((slot) => slot.id === active?.id) ?? SLOT_META[0];
  const rigView = active?.rig ? rig?.views[active.rig] : undefined;
  const hasRig = Boolean(rigView && rigView.layers.length > 0);
  const [map, setMap] = useState(initialMap);
  const [eyes, setEyes] = useState<"open" | "half" | "closed">("open");
  const [gaze, setGaze] = useState<GazeDirection>("center");
  const [eyeCapability, setEyeCapability] = useState<EyeCapability | "pending">("pending");
  const [framing, setFraming] = useState<Framing>("close");
  const [sceneryOn, setSceneryOn] = useState(false);
  const [sceneryId, setSceneryId] = useState<string | null>(null);
  const [sceneryState, setSceneryState] = useState<SceneryState | "pending">("pending");
  const [plate, setPlate] = useState<{ width: number; height: number; kind: PlateKind } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [spoken, setSpoken] = useState<Viseme | null>(null);
  const lids = Boolean(rigView?.layers.some((layer) => layer.name === "eyes_half" || layer.name === "eyes_closed"));
  const brows = Boolean(rigView?.layers.some((layer) => layer.name === "brows" || layer.name === "brow_left"));
  const gazeReady = eyeCapability === "separable" || eyeCapability === "recovered";
  const caps = capsFromView(rigView, gazeReady);
  const pose = shownPose(map, caps, { emotion: NEUTRAL, gaze, lids: eyes });
  const emotion = pose.emotion;
  const shownGaze = pose.gaze;
  const shownLids = pose.lids;
  const bodyReady = Boolean(rigView && hasFullBody(rigView));
  const missingSides = !slots.some((slot) => (slot.id === "three_quarter_left" || slot.id === "three_quarter_right") && slot.present);
  const anchors = normalizedAnchors(rigView);
  const sheet = slots.flatMap((slot) => {
    if (!slot.present || !slot.rig) return [];
    const source = rig?.views[slot.rig];
    const meta = SLOT_META.find((item) => item.id === slot.id);
    if (!source || source.layers.length === 0 || !meta) return [];
    const capability = separableGaze(source.layers) ? "separable" : slot.id === active?.id ? eyeCapability : "unavailable";
    return sheetGroups(source, capability).map((group) => ({ view: { ...meta, rig: slot.rig }, group }));
  });
  const waiting = hasRig && eyeCapability === "pending" && sheet.length === 0;

  useEffect(() => {
    setSceneryOn(sceneryPreference(window.sessionStorage).read());
    setSceneryId(sceneryChoice(window.sessionStorage).read());
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

  useEffect(() => {
    if (!holding || map.hover || map.pinned) return;
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const clock = poseAt((now - started) / 1000);
      if (lids) setEyes(clock.lids);
      if (gazeReady) setGaze(clock.gaze);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [holding, lids, gazeReady, map.hover, map.pinned]);

  function chooseSlot(id: ControllerSlotId) {
    const slot = slots.find((item) => item.id === id);
    if (!slot?.present || !slot.rig || slot.id === slotId) return;
    setHolding(false);
    setSlotId(id);
    setMap(initialMap());
    setSpoken(null);
    setGaze("center");
    setEyes("open");
    setEyeCapability("pending");
    setFraming("close");
  }

  const flatUrl = active?.id === "three_quarter_left"
    ? character.views.three_quarter_left ?? character.views.three_quarter
    : active ? character.views[active.id] : undefined;

  return (
    <section className="mt-6" data-testid="composed-character">
      <div data-testid="puppet-controller">
      <h2 className="text-sm font-medium">{t("controller")}</h2>
      <div className="mt-3 overflow-hidden rounded-[1.5rem] border border-white/10 bg-black">
        {selected && hasRig && rigView ? (
          <figure data-testid={selected.testId} data-framing={framing} data-template={framing === "close" ? "face" : "body"} data-ground={plate?.kind === "baked" || sceneryState === "needs-original" ? "baked" : "black"} data-fit="contain" data-emotion={emotion} data-pinned={map.pinned ?? ""} className="mx-auto w-full max-w-md bg-black">
            <AvatarStage
              view={rigView}
              emotion={emotion}
              lids={shownLids}
              gaze={shownGaze}
              framing={bodyReady ? framing : "close"}
              scenery={sceneryOn}
              sceneryId={sceneryId}
              viseme={spoken}
              onCapability={(capability) => setEyeCapability(capability)}
              onScenery={setSceneryState}
              onPlate={setPlate}
            />
          </figure>
        ) : selected && flatUrl ? (
          <figure data-testid={selected.testId} data-template="face" data-ground="black" data-fit="contain" className="mx-auto flex max-h-[70dvh] w-full max-w-md items-center justify-center bg-black">
            <img src={flatUrl} alt="" className="max-h-[70dvh] w-full bg-black object-contain" />
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
        {slots.map((slot) => {
          const meta = SLOT_META.find((item) => item.id === slot.id);
          if (!meta) return null;
          if (!slot.present) {
            return (
              <button
                key={slot.id}
                type="button"
                aria-disabled="true"
                data-missing={slot.reason}
                data-testid={`missing-${slot.id}`}
                className={`${controlClass(false)} opacity-60`}
                onClick={(event) => event.preventDefault()}
              >
                {t(meta.label)} · {t("missingView")}
              </button>
            );
          }
          return (
            <Choice
              key={slot.id}
              pressed={active?.id === slot.id}
              testId={`choose-${meta.testId}`}
              onClick={() => chooseSlot(slot.id)}
              label={t(meta.label)}
            />
          );
        })}
      </div>
      <p data-testid="puppet-anchors" className="mt-3 text-sm text-white/80">
        {t("anchorMouth")} {formatAnchor(anchors.mouth)} · {t("anchorEyes")} {formatAnchor(anchors.leftEye)} {formatAnchor(anchors.rightEye)}
      </p>
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
      <EmotionMap
        caps={caps}
        map={map}
        emotion={emotion}
        neutralMouth={Boolean(rigView?.expressions?.neutral)}
        labelFor={(id) => stateLabel("emotion", id, locale, t)}
        onHover={(id) => setMap((current) => hoverTag(current, id, caps))}
        onLeave={() => setMap((current) => leaveMap(current))}
        onPin={(id) => setMap((current) => pinTag(current, id, caps))}
        t={t}
      />
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
            <Choice key={direction} pressed={gaze === direction} onClick={() => { setHolding(false); setGaze(direction); }} label={t(GAZE_LABEL[direction])} testId={`gaze-${direction}`} />
          ))}
        </div>
      ) : hasRig && eyeCapability === "unavailable" ? (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="gaze-unavailable">{t("gazeUnavailable")}</p>
      ) : null}
      {hasRig ? (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("anchorMouth")} data-testid="mouth-controls">
          {VISEMES.map((viseme) => visemePresent(rigView, viseme) ? (
            <Choice
              key={viseme}
              pressed={spoken === viseme}
              testId={`mouth-${viseme}`}
              onClick={() => {
                setHolding(false);
                setSpoken(viseme);
              }}
              label={viseme}
            />
          ) : (
            <button key={viseme} type="button" aria-disabled="true" data-missing="absent" data-testid={`mouth-${viseme}`} className={`${controlClass(false)} opacity-60`} onClick={(event) => event.preventDefault()}>
              {viseme} · {t("missingView")}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-3">
        <button
          type="button"
          data-testid="parametric-pose"
          aria-pressed={holding}
          aria-disabled={!lids && !gazeReady}
          className={`${controlClass(holding)} ${!lids && !gazeReady ? "opacity-60" : ""}`}
          onClick={() => {
            if (!lids && !gazeReady) return;
            setHolding((value) => !value);
          }}
        >
          {t("parametricPose")}
        </button>
      </div>
      {missingSides ? <p className="mt-3 text-sm text-muted-foreground" data-testid="missing-sides">{t("missingSides")}</p> : null}
      </div>
      {sheet.length ? (
        <section className="mt-8 bg-black" data-testid="emotion-sheet" data-ground="black">
          <h2 className="text-sm font-medium">{t("emotionSheet")}</h2>
          <p className="mt-1 text-sm text-white/70" data-testid="sheet-review">{t("sheetReview")}</p>
          {slots.filter((slot) => slot.present).map((slot) => {
            const view = SLOT_META.find((item) => item.id === slot.id);
            if (!view || !slot.rig) return null;
            const groups = sheet.filter((entry) => entry.view.id === view.id);
            if (!groups.length) return null;
            const source = rig?.views[slot.rig];
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
          <p className="mt-1 text-sm text-white/70" data-testid="sheet-review">{t("sheetReview")}</p>
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

function EmotionMap({
  caps,
  map,
  emotion,
  neutralMouth,
  labelFor,
  onHover,
  onLeave,
  onPin,
  t,
}: {
  caps: EmotionCaps;
  map: MapState;
  emotion: string;
  neutralMouth: boolean;
  labelFor: (id: string) => string;
  onHover: (id: string) => void;
  onLeave: () => void;
  onPin: (id: string) => void;
  t: (key: MessageKey) => string;
}) {
  const leaveTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (leaveTimer.current != null) window.clearTimeout(leaveTimer.current);
  }, []);
  function cancelLeave() {
    if (leaveTimer.current != null) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  }
  function scheduleLeave() {
    cancelLeave();
    leaveTimer.current = window.setTimeout(() => onLeave(), 90);
  }
  const groups = [
    { id: "expression", title: t("emotionGroup") },
    { id: "gaze", title: t("gazeGroup") },
    { id: "lids", title: t("lidsGroup") },
  ] as const;
  const tags = emotionTags(caps);
  return (
    <div
      data-testid="emotion-map"
      data-emotion={emotion}
      data-pinned={map.pinned ?? ""}
      className="mt-3"
      onPointerEnter={cancelLeave}
      onPointerLeave={scheduleLeave}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        scheduleLeave();
      }}
    >
      <h3 className="text-sm font-medium">{t("emotionMap")}</h3>
      {groups.map((group) => (
        <div key={group.id} className="mt-2 flex flex-wrap items-center gap-1" data-testid={`emotion-group-${group.id}`}>
          <span className="mr-1 text-xs uppercase tracking-wide text-white/50">{group.title}</span>
          {tags.filter((tag) => tag.group === group.id).map((tag) => {
            const label = tag.group === "expression" ? labelFor(tag.id) : tag.group === "gaze" ? t(GAZE_LABEL[tag.id.slice(5) as GazeDirection]) : tag.id === "lids:half" ? t("eyesHalf") : tag.id === "lids:closed" ? t("eyesClosed") : t("eyesOpen");
            return (
              <button
                key={tag.id}
                type="button"
                data-testid={`tag-${tag.id}`}
                data-supported={tag.supported ? "true" : "false"}
                aria-disabled={!tag.supported}
                aria-pressed={map.pinned === tag.id || (map.hover === tag.id)}
                className={`${controlClass(map.pinned === tag.id || emotion === tag.id || map.hover === tag.id)} ${tag.supported ? "" : "opacity-60"}`}
                onPointerEnter={() => {
                  if (!tag.supported) return;
                  cancelLeave();
                  onHover(tag.id);
                }}
                onFocus={() => {
                  if (!tag.supported) return;
                  cancelLeave();
                  onHover(tag.id);
                }}
                onPointerDown={() => {
                  if (!tag.supported) return;
                  cancelLeave();
                  onHover(tag.id);
                }}
                onClick={() => {
                  if (!tag.supported) return;
                  onPin(tag.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  if (!tag.supported) return;
                  onPin(tag.id);
                }}
              >
                {label}{tag.supported ? "" : ` · ${t("unsupportedTag")}`}
              </button>
            );
          })}
        </div>
      ))}
      {map.pinned ? <p className="mt-1 text-xs text-white/60">{t("pinEmotion")}</p> : null}
      {neutralMouth ? null : <p data-testid="neutral-plate" className="mt-1 text-sm text-white/70">{t("neutralPlate")}</p>}
    </div>
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
          <li key={state.id} data-testid={`sheet-${viewId}-${group.category}-${state.id}`} data-template="face" className={`${SHEET_CELL} overflow-hidden rounded-2xl bg-black`}>
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
  if (id === "neutral") return t("neutral");
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

function formatAnchor(point: { x: number; y: number } | null): string {
  return point ? `${point.x.toFixed(3)}, ${point.y.toFixed(3)}` : "—";
}

function Choice({ pressed, onClick, label, testId }: { pressed: boolean; onClick?: () => void; label: string; testId?: string }) {
  return (
    <button type="button" data-testid={testId} aria-pressed={pressed} onClick={onClick} className={controlClass(pressed)}>
      {label}
    </button>
  );
}
