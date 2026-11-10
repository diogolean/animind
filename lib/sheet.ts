import type { CharacterView } from "./contract";
import { EXPRESSION_ORDER, GAZE_ORDER, LID_ORDER } from "./emotion-map";
import type { EyeCapability, GazeDirection } from "./eye-rig";
import { GAZE_DIRECTIONS } from "./eye-rig";

export type SheetCategory = "gaze" | "emotion" | "lids";

export interface SheetState {
  id: string;
  emotion: string;
  lids: "open" | "half" | "closed";
  gaze: GazeDirection;
}

export interface SheetGroup {
  category: SheetCategory;
  states: SheetState[];
}

export interface ParityState extends SheetState {
  ready: boolean;
}

export interface ParityGroup {
  category: SheetCategory;
  states: ParityState[];
}

/**
 * States the view can already draw. Gaze is included only after the composer
 * proved the pupils move. Missing emotions, lids, and views are omitted.
 */
export function sheetGroups(view: CharacterView, capability: EyeCapability | "pending" | "unavailable"): SheetGroup[] {
  const groups: SheetGroup[] = [];
  if (capability === "separable" || capability === "recovered") {
    groups.push({
      category: "gaze",
      states: GAZE_DIRECTIONS.map((gaze) => ({ id: gaze, emotion: "rest", lids: "open", gaze })),
    });
  }
  const emotions = Object.keys(view.expressions ?? {});
  if (emotions.length) {
    groups.push({
      category: "emotion",
      states: ["rest", ...emotions].map((emotion) => ({ id: emotion, emotion, lids: "open" as const, gaze: "center" as const })),
    });
  }
  const lids: SheetState["lids"][] = ["open"];
  if (view.layers.some((layer) => layer.name === "eyes_half")) lids.push("half");
  if (view.layers.some((layer) => layer.name === "eyes_closed")) lids.push("closed");
  if (lids.length > 1) {
    groups.push({
      category: "lids",
      states: lids.map((state) => ({ id: state, emotion: "rest", lids: state, gaze: "center" as const })),
    });
  }
  return groups;
}

/**
 * The same cells for every character. A missing layer stays in the grid
 * and is marked pending. A baked body plate does not count as a finished face.
 */
export function paritySheet(view: CharacterView | null, capability: EyeCapability | "pending" | "unavailable"): ParityGroup[] {
  const cutout = Boolean(view?.layers.some((layer) => layer.name === "head" || layer.name === "torso"));
  const gazeReady = capability === "separable" || capability === "recovered";
  return [
    {
      category: "gaze",
      states: GAZE_ORDER.map((gaze) => ({
        id: gaze,
        emotion: "rest",
        lids: "open" as const,
        gaze,
        ready: cutout && (gaze === "center" || gazeReady),
      })),
    },
    {
      category: "emotion",
      states: EXPRESSION_ORDER.map((emotion) => ({
        id: emotion,
        emotion,
        lids: "open" as const,
        gaze: "center" as const,
        ready: cutout && (emotion === "neutral" || Boolean(view?.expressions?.[emotion])),
      })),
    },
    {
      category: "lids",
      states: LID_ORDER.map((lids) => ({
        id: lids,
        emotion: "rest",
        lids,
        gaze: "center" as const,
        ready: cutout && (lids === "open" || Boolean(view?.layers.some((layer) => layer.name === (lids === "half" ? "eyes_half" : "eyes_closed")))),
      })),
    },
  ];
}

export const SHEET_GRID = "flex flex-wrap gap-2";
export const SHEET_CELL = "w-[calc(50%-0.25rem)] min-w-0 sm:w-[calc(33.333%-0.375rem)] lg:w-[calc(25%-0.375rem)]";
