import type { CharacterView } from "./contract";
import type { GazeDirection } from "./eye-rig";

/** Same semantic home for every character. Geometry stays in the pack. */
export const NEUTRAL = "neutral";

export const EXPRESSION_ORDER = [
  NEUTRAL,
  "happy",
  "smug_smile",
  "ironic",
  "angry",
  "stressed_grimace",
  "sad",
  "surprised",
  "thoughtful",
] as const;

export const GAZE_ORDER = ["center", "left", "right", "up", "down"] as const;
export const LID_ORDER = ["open", "half", "closed"] as const;

export interface EmotionCaps {
  expressions: readonly string[];
  gaze: boolean;
  lids: readonly ("open" | "half" | "closed")[];
}

export interface EmotionTag {
  id: string;
  group: "expression" | "gaze" | "lids";
  supported: boolean;
}

export interface MapPose {
  emotion: string;
  gaze: GazeDirection;
  lids: "open" | "half" | "closed";
}

export interface MapState {
  baseEmotion: string;
  hover: string | null;
  pinned: string | null;
}

export function capsFromView(view: CharacterView | undefined, gaze: boolean): EmotionCaps {
  const lids: ("open" | "half" | "closed")[] = ["open"];
  if (view?.layers.some((layer) => layer.name === "eyes_half")) lids.push("half");
  if (view?.layers.some((layer) => layer.name === "eyes_closed")) lids.push("closed");
  return {
    expressions: Object.keys(view?.expressions ?? {}),
    gaze,
    lids,
  };
}

export function emotionTags(caps: EmotionCaps): EmotionTag[] {
  const expressions = EXPRESSION_ORDER.map((id) => ({
    id,
    group: "expression" as const,
    supported: id === NEUTRAL || caps.expressions.includes(id),
  }));
  const gaze = GAZE_ORDER.map((id) => ({
    id: `gaze:${id}`,
    group: "gaze" as const,
    supported: id === "center" || caps.gaze,
  }));
  const lids = LID_ORDER.map((id) => ({
    id: `lids:${id}`,
    group: "lids" as const,
    supported: caps.lids.includes(id),
  }));
  return [...expressions, ...gaze, ...lids];
}

export function initialMap(): MapState {
  return { baseEmotion: NEUTRAL, hover: null, pinned: null };
}

export function hoverTag(state: MapState, id: string, caps: EmotionCaps): MapState {
  if (!emotionTags(caps).some((tag) => tag.id === id && tag.supported)) return state;
  return { ...state, hover: id };
}

export function leaveMap(state: MapState): MapState {
  return { ...state, hover: null };
}

export function pinTag(state: MapState, id: string, caps: EmotionCaps): MapState {
  if (!emotionTags(caps).some((tag) => tag.id === id && tag.supported)) return state;
  if (state.pinned === id) return { ...state, pinned: null, hover: null };
  return { ...state, pinned: id, hover: null };
}

export function shownPose(state: MapState, caps: EmotionCaps, base: MapPose = { emotion: NEUTRAL, gaze: "center", lids: "open" }): MapPose {
  const home: MapPose = { ...base, emotion: state.baseEmotion || NEUTRAL };
  const id = state.hover ?? state.pinned;
  if (!id) return home;
  const applied = applyTag(id, caps);
  if (!applied) return home;
  return { ...home, ...applied };
}

export function tagSupported(id: string, caps: EmotionCaps): boolean {
  return emotionTags(caps).some((tag) => tag.id === id && tag.supported);
}

function applyTag(id: string, caps: EmotionCaps): Partial<MapPose> | null {
  if (!tagSupported(id, caps)) return null;
  if (id === NEUTRAL) return { emotion: NEUTRAL, gaze: "center", lids: "open" };
  if (id.startsWith("gaze:")) return { gaze: id.slice(5) as GazeDirection };
  if (id.startsWith("lids:")) return { lids: id.slice(5) as MapPose["lids"] };
  return { emotion: id };
}
