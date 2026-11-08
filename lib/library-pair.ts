/**
 * One background decision for every character on the library stage.
 * Both on, or both off. A missing transparent plate or a missing scenery
 * layer turns the whole pair off. The function does not matte, crop, or
 * rewrite a plate.
 */

export interface PairPlate {
  id: string;
  /** Real alpha, already in the file. A baked illustration is false. */
  transparent: boolean;
  /** Separate scenery layers. The id is the layer url, not a generated image. */
  sceneryIds: string[];
}

export type PairReason = "ready" | "needs-original" | "needs-scenery" | "empty";

export interface PairBackground {
  mode: "on" | "off";
  reason: PairReason;
  sceneryId: string | null;
  choices: string[];
}

export function sharedBackground(plates: readonly PairPlate[], requestedId: string | null, enabled: boolean): PairBackground {
  if (plates.length === 0) return { mode: "off", reason: "empty", sceneryId: null, choices: [] };
  const choices = intersection(plates.map((plate) => plate.sceneryIds));
  if (plates.some((plate) => !plate.transparent)) {
    return { mode: "off", reason: "needs-original", sceneryId: null, choices };
  }
  if (choices.length === 0) return { mode: "off", reason: "needs-scenery", sceneryId: null, choices: [] };
  if (!enabled) return { mode: "off", reason: "ready", sceneryId: null, choices };
  const sceneryId = requestedId && choices.includes(requestedId) ? requestedId : choices[0];
  return { mode: "on", reason: "ready", sceneryId, choices };
}

/** A new id for every plate. Inputs stay as they were. An off pair stays off. */
export function replaceSharedScenery(plates: readonly PairPlate[], requestedId: string | null, nextId: string, enabled: boolean): PairBackground {
  return sharedBackground(plates, nextId || requestedId, enabled);
}

export function pairPlates(characters: readonly { id: string; layers: readonly { name: string; url: string }[] }[]): PairPlate[] {
  return characters.map((character) => ({
    id: character.id,
    transparent: plateIsTransparent(character.layers),
    sceneryIds: character.layers.filter((layer) => layer.name === "scenery").map((layer) => layer.url),
  }));
}

/** An avatar file, or a head/torso stack with no baked body. A body plate is the painted picture. */
function plateIsTransparent(layers: readonly { name: string }[]): boolean {
  const names = new Set(layers.map((layer) => layer.name));
  if (names.has("avatar")) return true;
  if (names.has("body")) return false;
  return names.has("head") || names.has("torso");
}

const SCENERY_ID = "animindly-scenery-id";

export function sceneryChoice(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | null): {
  read(): string | null;
  write(id: string | null): void;
} {
  return {
    read() {
      const value = storage?.getItem(SCENERY_ID);
      return value ? value : null;
    },
    write(id: string | null) {
      storage?.setItem(SCENERY_ID, id ?? "");
    },
  };
}

function intersection(groups: readonly string[][]): string[] {
  if (groups.length === 0) return [];
  const [first, ...rest] = groups;
  return first.filter((id, index) => first.indexOf(id) === index && rest.every((group) => group.includes(id)));
}
