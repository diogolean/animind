import type { LibraryCharacter } from "./accounts/types";
import { placeHeadOnStage } from "./stage-frame";
import {
  reservedMouthVariations,
  type Character,
  type CharacterView,
  type Layer,
} from "./contract";

/**
 * The painted plate (the drawn room mixed in as einstein_plate_ca8386e2)
 * is not the approved charge. These urls are dropped wherever a charge is shown.
 */
export const PAINTED_CHARGE_URL = /(?:^|\/)body\.png$|ca8386e2|emotion-sheet|(?:^|\/)mouths\/|(?:^|\/)views\/front\.png/i;

export const APPROVED_CHARGE_FILES = {
  front: "head_front.png",
  left: "head_3q_left.png",
  right: "head_3q_right.png",
} as const;

export interface ApprovedHead {
  file: string;
  url: string;
  canvas: { w: number; h: number };
}

export interface ApprovedHeads {
  front: ApprovedHead;
  left: ApprovedHead;
  right: ApprovedHead;
}

const EMPTY_CANVAS = { w: 800, h: 1000 };

export function isChargeName(name: string): boolean {
  const value = name.toLowerCase();
  return value.includes("charge") || value.includes("caricatura");
}

export function paintedChargeUrl(url: string): boolean {
  return PAINTED_CHARGE_URL.test(url);
}

/** A head cut-out on the shared 4/5 stage. The reserved mouth slots stay empty. */
export function headView(url: string, head: { w: number; h: number }, sceneryUrl: string | null): CharacterView {
  const placed = placeHeadOnStage(head);
  const canvas = placed.canvas;
  const layers: Layer[] = [{ name: "head", url, x: placed.x, y: placed.y, w: head.w, h: head.h, z: 1 }];
  if (sceneryUrl) layers.unshift({ name: "scenery", url: sceneryUrl, x: 0, y: 0, w: canvas.w, h: canvas.h, z: 0 });
  return {
    canvas,
    layers,
    visemes: {},
    mouthVariations: reservedMouthVariations(),
  };
}

export function emptyChargeView(): CharacterView {
  return {
    canvas: EMPTY_CANVAS,
    layers: [],
    visemes: {},
    mouthVariations: reservedMouthVariations(),
  };
}

/**
 * The charge the page shows. Approved heads replace the stored puppet.
 * Without those files the views stay empty, which the stage draws as pending.
 */
export function chargeCharacterRig(character: LibraryCharacter, approved: ApprovedHeads | null, sceneryUrl: string | null): Character {
  const front = approved ? headView(approved.front.url, approved.front.canvas, sceneryUrl) : emptyChargeView();
  const left = approved ? headView(approved.left.url, approved.left.canvas, sceneryUrl) : emptyChargeView();
  const right = approved ? headView(approved.right.url, approved.right.canvas, sceneryUrl) : emptyChargeView();
  return {
    id: character.id,
    name: character.name,
    status: "placeholder",
    style: "rig",
    views: { front, left, right },
    generatorNote: "Approved charge heads. Eyes, mouth, body, and profile are pending.",
    createdAt: character.createdAt,
  };
}

function withoutPainted(character: LibraryCharacter): LibraryCharacter {
  return {
    ...character,
    status: "draft",
    emotionSheetUrl: character.emotionSheetUrl && paintedChargeUrl(character.emotionSheetUrl) ? null : character.emotionSheetUrl,
    views: {
      ...character.views,
      front: character.views.front && paintedChargeUrl(character.views.front) ? undefined : character.views.front,
      three_quarter: character.views.three_quarter && paintedChargeUrl(character.views.three_quarter) ? undefined : character.views.three_quarter,
      three_quarter_left: character.views.three_quarter_left && paintedChargeUrl(character.views.three_quarter_left) ? undefined : character.views.three_quarter_left,
      three_quarter_right: character.views.three_quarter_right && paintedChargeUrl(character.views.three_quarter_right) ? undefined : character.views.three_quarter_right,
      profile: character.views.profile && paintedChargeUrl(character.views.profile) ? undefined : character.views.profile,
    },
    layers: character.layers.filter((layer) => layer.name !== "body" && !paintedChargeUrl(layer.url)),
  };
}

/** Library card for the pair. The charge never keeps the painted plate. */
export function presentPairMember(character: LibraryCharacter, approved: ApprovedHeads | null, sceneryUrl: string | null): LibraryCharacter {
  if (!isChargeName(character.name)) {
    if (!sceneryUrl || character.layers.some((layer) => layer.name === "scenery")) return character;
    return { ...character, layers: [...character.layers, { name: "scenery", url: sceneryUrl }] };
  }
  const clean = withoutPainted(character);
  if (!approved) {
    return sceneryUrl ? { ...clean, layers: [...clean.layers, { name: "scenery", url: sceneryUrl }] } : clean;
  }
  return {
    ...clean,
    views: {
      front: approved.front.url,
      three_quarter_left: approved.left.url,
      three_quarter_right: approved.right.url,
    },
    layers: [
      { name: "head", url: approved.front.url },
      ...(sceneryUrl ? [{ name: "scenery", url: sceneryUrl }] : []),
    ],
  };
}

export function withSharedScenery(rig: Character, sceneryUrl: string | null): Character {
  if (!sceneryUrl) return rig;
  const views = { ...rig.views };
  for (const name of ["front", "left", "right"] as const) {
    const view = views[name];
    if (!view || view.layers.some((layer) => layer.name === "scenery")) continue;
    views[name] = {
      ...view,
      layers: [{ name: "scenery", url: sceneryUrl, x: 0, y: 0, w: view.canvas.w, h: view.canvas.h, z: 0 }, ...view.layers],
    };
  }
  return { ...rig, views };
}

/**
 * One canonical avatar job, prepared and not sent.
 * create_character → build_rig is a whole character. It has no published
 * call that keeps these approved heads and draws only the missing parts.
 * Image output at $0.039 is not the cost: input tokens are unknown, so the
 * estimate stays null. The ceiling is the published plan limit.
 */
export const CHARGE_COMPLETION = {
  executed: false,
  pipeline: ["create_character", "build_rig"],
  request: {
    method: "POST",
    path: "/v1/avatars",
    body: {
      prompt: "Albert Einstein caricature. Keep the approved transparent head. Add profile, separable eyes, visemes, the nine expressions, neck, and torso. No painted room.",
      name: "Einstein charge",
      language: "en",
      reuse: false,
      generate: true,
    },
    headers: ["Authorization", "X-Animind-User", "X-Animind-Admin", "Idempotency-Key", "X-Request-Id"],
  },
  ceiling: { images: 18, detectFeatures: 6 },
  publishedRates: {
    "gemini-2.5-flash-image": { outputPerImageUsd: 0.039, inputPerMillionUsd: 0.3 },
    "gemini-2.5-flash": { inputPerMillionUsd: 0.3, cachePerMillionUsd: 0.03, outputPerMillionUsd: 2.5 },
  },
  imageOutputCeilingUsd: 18 * 0.039,
  estimateUsd: null,
  missing: ["profile", "eyes", "mouth", "expressions", "neck", "torso"],
} as const;
