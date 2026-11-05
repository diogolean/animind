import { VISEMES, type Character, type CharacterView, type Viseme } from "../contract";
import type { LibraryCharacter, LibraryDemo } from "../accounts/types";
import layout from "./einstein-layout.json";

/**
 * Approved Einstein (p82), served from public/characters/einstein_approved/.
 * The bytes are in the repo because this environment has no Blob token.
 * Private imports still use Neon + Blob when those env vars are set.
 * Left and right cameras reuse the front plate: the pack has no 3/4 views.
 */

interface MouthBox {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

const mouths = layout.visemes as Record<string, MouthBox>;

export const EINSTEIN_APPROVED_ID = layout.id;

export function isApprovedCharacterId(id: string): boolean {
  return id === EINSTEIN_APPROVED_ID;
}

function frontView(): CharacterView {
  const visemes: CharacterView["visemes"] = {};
  for (const name of VISEMES) {
    const box = mouths[name];
    if (!box) throw new Error(`Pacote Einstein sem a boca ${name}`);
    visemes[name] = { name: "mouth", url: box.url, x: box.x, y: box.y, w: box.w, h: box.h, z: box.z };
  }
  return {
    canvas: { w: layout.canvas.w, h: layout.canvas.h },
    layers: [{ name: "body", url: layout.body, x: 0, y: 0, w: layout.canvas.w, h: layout.canvas.h, z: 1 }],
    visemes,
  };
}

export function approvedEinsteinRig(): Character {
  const view = frontView();
  return {
    id: EINSTEIN_APPROVED_ID,
    name: layout.name,
    status: "ready",
    style: "rig",
    artStyle: "ghibli",
    characterType: "illustrated",
    views: { front: view, left: view, right: view },
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
    views: { front: layout.front },
    puppetUrl: "/characters/einstein_approved/puppet.json",
    layers: VISEMES.map((name) => ({ name, url: mouths[name]!.url })),
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
  return mouths[name as Viseme];
}
