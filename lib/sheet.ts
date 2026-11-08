import type { CharacterView } from "./contract";
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

export const SHEET_GRID = "flex flex-wrap gap-2";
export const SHEET_CELL = "w-[calc(50%-0.25rem)] min-w-0 sm:w-[calc(33.333%-0.375rem)] lg:w-[calc(20%-0.4rem)]";
