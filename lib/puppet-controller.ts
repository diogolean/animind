import type { Character, CharacterView, ViewName, Viseme } from "./contract";
import { VISEMES } from "./contract";
import type { LibraryViewName } from "./accounts/types";
import type { GazeDirection } from "./eye-rig";

/**
 * One controller for every saved puppet.
 * Anchors are fractions of that view's canvas, so a 480×620 charge and a
 * 1080×1920 realistic plate share the same layout. A side view that reuses
 * the front plate is missing, not a 3/4.
 */

export const CONTROLLER_SLOTS = ["front", "three_quarter_left", "three_quarter_right", "profile"] as const;
export type ControllerSlotId = (typeof CONTROLLER_SLOTS)[number];

export interface ControllerSlot {
  id: ControllerSlotId;
  present: boolean;
  reason: "present" | "reused-front" | "absent";
  rig: ViewName | null;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface ControllerAnchors {
  mouth: NormalizedPoint | null;
  leftEye: NormalizedPoint | null;
  rightEye: NormalizedPoint | null;
  head: NormalizedPoint | null;
}

const SLOT_RIG: Record<ControllerSlotId, { rig: ViewName | null; library: readonly LibraryViewName[] }> = {
  front: { rig: "front", library: ["front"] },
  three_quarter_left: { rig: "left", library: ["three_quarter_left", "three_quarter"] },
  three_quarter_right: { rig: "right", library: ["three_quarter_right"] },
  profile: { rig: null, library: ["profile"] },
};

function plateKey(view: CharacterView | null | undefined): string {
  if (!view) return "";
  return view.layers
    .filter((layer) => layer.name !== "scenery")
    .map((layer) => `${layer.name}\n${layer.url}\n${layer.x}\n${layer.y}\n${layer.w}\n${layer.h}`)
    .sort()
    .join("\n");
}

function libraryUrl(views: Partial<Record<LibraryViewName, string>>, names: readonly LibraryViewName[]): string | null {
  for (const name of names) {
    const url = views[name];
    if (url) return url;
  }
  return null;
}

/** Same four slots for every puppet. A copied front plate does not become a 3/4. */
export function controllerSlots(
  views: Partial<Record<LibraryViewName, string>>,
  rig: Character | null,
): ControllerSlot[] {
  const front = rig?.views.front;
  const frontKey = plateKey(front);
  const frontUrl = views.front ?? null;
  return CONTROLLER_SLOTS.map((id) => {
    const spec = SLOT_RIG[id];
    const side = spec.rig ? rig?.views[spec.rig] : undefined;
    const sideKey = plateKey(side);
    const url = libraryUrl(views, spec.library);
    const copiedPlate = Boolean(sideKey) && sideKey === frontKey && id !== "front";
    const copiedFile = Boolean(url) && url === frontUrl && id !== "front";
    if (id === "front") {
      const present = Boolean(frontKey) || Boolean(frontUrl);
      return { id, present, reason: present ? "present" : "absent", rig: present ? "front" : null };
    }
    if (copiedPlate || copiedFile) return { id, present: false, reason: "reused-front", rig: null };
    if (spec.rig && sideKey) return { id, present: true, reason: "present", rig: spec.rig };
    if (url) return { id, present: true, reason: "present", rig: spec.rig };
    return { id, present: false, reason: "absent", rig: null };
  });
}

function unit(value: number, span: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(span) || span <= 0) return 0;
  return Math.min(1, Math.max(0, value / span));
}

function point(x: number, y: number, canvas: { w: number; h: number }): NormalizedPoint {
  return { x: unit(x, canvas.w), y: unit(y, canvas.h) };
}

/** Mouth, eyes and head as fractions of the view canvas. Missing parts stay null. */
export function normalizedAnchors(view: CharacterView | null | undefined): ControllerAnchors {
  const empty: ControllerAnchors = { mouth: null, leftEye: null, rightEye: null, head: null };
  if (!view) return empty;
  const canvas = view.canvas;
  const mouthLayer = view.visemes.X ?? VISEMES.map((name) => view.visemes[name]).find(Boolean);
  const head = view.layers.find((layer) => layer.name === "head");
  const irises = view.eyeRig?.irises ?? [];
  let leftEye: NormalizedPoint | null = null;
  let rightEye: NormalizedPoint | null = null;
  if (irises.length >= 2) {
    const ordered = [...irises].sort((a, b) => a[0] - b[0]);
    leftEye = point(ordered[0][0], ordered[0][1], canvas);
    rightEye = point(ordered[1][0], ordered[1][1], canvas);
  } else if (irises.length === 1) {
    leftEye = point(irises[0][0], irises[0][1], canvas);
  } else {
    const eyes = view.layers.find((layer) => layer.name === "eye_white" || layer.name === "eyes" || layer.name === "iris");
    if (eyes) {
      leftEye = point(eyes.x + eyes.w * 0.25, eyes.y + eyes.h / 2, canvas);
      rightEye = point(eyes.x + eyes.w * 0.75, eyes.y + eyes.h / 2, canvas);
    }
  }
  return {
    mouth: mouthLayer ? point(mouthLayer.x + mouthLayer.w / 2, mouthLayer.y + mouthLayer.h / 2, canvas) : null,
    leftEye,
    rightEye,
    head: head ? point(head.x + head.w / 2, head.y + head.h / 2, canvas) : null,
  };
}

export function visemePresent(view: CharacterView | null | undefined, viseme: Viseme): boolean {
  return Boolean(view?.visemes[viseme]);
}

/**
 * A blink and a small gaze wander from the clock.
 * No network and no model. The caller still has to refuse a view that has no lids.
 */
export function poseAt(seconds: number): { lids: "open" | "closed"; gaze: GazeDirection } {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const blink = time % 3.6 > 3.42;
  const x = Math.sin(time * 0.85);
  const gaze: GazeDirection = blink ? "center" : x > 0.45 ? "right" : x < -0.45 ? "left" : "center";
  return { lids: blink ? "closed" : "open", gaze };
}
