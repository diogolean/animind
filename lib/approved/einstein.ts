import { VISEMES, type Character, type CharacterView, type Viseme } from "../contract";
import type { LibraryCharacter, LibraryDemo } from "../accounts/types";
import layout from "./einstein-layout.json";

/**
 * Approved Einstein, served from public/characters/einstein_approved/.
 * The bytes are in the repo because this environment has no Blob token.
 * Private imports still use Neon + Blob when those env vars are set.
 * Front, left, and right are the zip's three cameras: front, three-quarter,
 * and three-quarter-right. Each camera keeps its own layers and Rhubarb mouths.
 */

interface MouthBox {
  name: string;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

interface PackedView {
  canvas: { w: number; h: number };
  layers: MouthBox[];
  visemes: Record<string, MouthBox>;
}

const packed = layout.views as { front: PackedView; left: PackedView; right: PackedView };

export const EINSTEIN_APPROVED_ID = layout.id;

export function isApprovedCharacterId(id: string): boolean {
  return id === EINSTEIN_APPROVED_ID;
}

function camera(view: PackedView, label: string): CharacterView {
  const visemes: CharacterView["visemes"] = {};
  for (const name of VISEMES) {
    const box = view.visemes[name];
    if (!box) throw new Error(`Pacote Einstein sem a boca ${name} na vista ${label}`);
    visemes[name] = { name: "mouth", url: box.url, x: box.x, y: box.y, w: box.w, h: box.h, z: box.z };
  }
  return {
    canvas: { w: view.canvas.w, h: view.canvas.h },
    layers: view.layers.map((layer) => ({ name: layer.name, url: layer.url, x: layer.x, y: layer.y, w: layer.w, h: layer.h, z: layer.z })),
    visemes,
  };
}

export function approvedEinsteinRig(): Character {
  return {
    id: EINSTEIN_APPROVED_ID,
    name: layout.name,
    status: "ready",
    style: "rig",
    artStyle: "ghibli",
    characterType: "illustrated",
    views: {
      front: camera(packed.front, "front"),
      left: camera(packed.left, "left"),
      right: camera(packed.right, "right"),
    },
    imageUrl: layout.front,
    frontImageUrl: layout.front,
    reviewSheetUrl: layout.emotionSheet,
    generatorNote: "Pacote aprovado. Sem nova geração.",
    createdAt: layout.createdAt,
  };
}

function demos(): LibraryDemo[] {
  return [
    { id: "demo-pt", label: "Vídeo em português", kind: "video", url: layout.demoPt },
    { id: "demo-en", label: "Vídeo em inglês", kind: "video", url: layout.demoEn },
    { id: "voice-en", label: "Voz em inglês", kind: "audio", url: layout.voiceEn },
    { id: "dialog-en", label: "Falas em inglês", kind: "script", text: layout.dialogEn },
    { id: "emotion-en", label: "Ficha de emoções em inglês", kind: "image", url: layout.emotionSheetEn },
  ];
}

export function approvedLibraryCharacter(): LibraryCharacter {
  return {
    id: EINSTEIN_APPROVED_ID,
    ownerId: "catalog",
    name: layout.name,
    personaSheetRef: layout.personaSheetRef,
    views: {
      front: layout.front,
      three_quarter_left: layout.threeQuarterLeft,
      three_quarter_right: layout.threeQuarterRight,
    },
    puppetUrl: "/characters/einstein_approved/puppet.json",
    layers: VISEMES.map((name) => ({ name, url: packed.front.visemes[name]!.url })),
    emotionSheetUrl: layout.emotionSheet,
    status: "ready",
    catalog: true,
    demos: demos(),
    createdAt: layout.createdAt,
    updatedAt: layout.createdAt,
  };
}

/** Keeps the account library first and appends the catalog character once. */
export function mergeApproved(characters: LibraryCharacter[]): LibraryCharacter[] {
  if (characters.some((character) => character.id === EINSTEIN_APPROVED_ID)) return characters;
  return [...characters, approvedLibraryCharacter()];
}

/**
 * The mock job id drops view URLs. Put the approved plate back so the
 * player draws this character instead of the silhouette.
 */
export function applyApprovedCharacters(characters: Character[]): Character[] {
  return characters.map((character) => {
    if (character.id !== EINSTEIN_APPROVED_ID) return character;
    const rig = approvedEinsteinRig();
    return {
      ...rig,
      name: character.name.trim() || rig.name,
      ...(character.voice ? { voice: character.voice } : {}),
    };
  });
}

export function approvedViseme(name: string): MouthBox | undefined {
  return packed.front.visemes[name as Viseme];
}
