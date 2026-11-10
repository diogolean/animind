import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LibraryCharacter } from "./accounts/types";
import {
  APPROVED_CHARGE_FILES,
  chargeCharacterRig,
  presentPairMember,
  withSharedScenery,
  type ApprovedHeads,
} from "./charge-parity";
import type { Character } from "./contract";
import { cropRaster, decodePngRgba, encodePngRgba, opaqueBounds } from "./png-rgba";

const APPROVED_DIR = path.join(process.cwd(), "private/characters/einstein-charge-approved/einstein_v1");
const SCENERY_FILE = path.join(process.cwd(), "private/characters/shared-scenery/studio.png");

const cropped = new Map<string, { png: Uint8Array; canvas: { w: number; h: number } }>();

export function chargeHeadPng(file: string): { png: Uint8Array; canvas: { w: number; h: number } } | null {
  if (!Object.values(APPROVED_CHARGE_FILES).includes(file as (typeof APPROVED_CHARGE_FILES)[keyof typeof APPROVED_CHARGE_FILES])) return null;
  const cached = cropped.get(file);
  if (cached) return cached;
  const full = path.join(APPROVED_DIR, file);
  if (!existsSync(full)) return null;
  const raster = decodePngRgba(readFileSync(full));
  if (!raster) return null;
  const cut = cropRaster(raster, opaqueBounds(raster));
  const png = encodePngRgba(cut);
  const value = { png, canvas: { w: cut.width, h: cut.height } };
  cropped.set(file, value);
  return value;
}

export function discoverApprovedHeads(): ApprovedHeads | null {
  const front = chargeHeadPng(APPROVED_CHARGE_FILES.front);
  const left = chargeHeadPng(APPROVED_CHARGE_FILES.left);
  const right = chargeHeadPng(APPROVED_CHARGE_FILES.right);
  if (!front || !left || !right) return null;
  const url = (file: string) => `/api/packs/charge-approved/${file}`;
  return {
    front: { file: APPROVED_CHARGE_FILES.front, url: url(APPROVED_CHARGE_FILES.front), canvas: front.canvas },
    left: { file: APPROVED_CHARGE_FILES.left, url: url(APPROVED_CHARGE_FILES.left), canvas: left.canvas },
    right: { file: APPROVED_CHARGE_FILES.right, url: url(APPROVED_CHARGE_FILES.right), canvas: right.canvas },
  };
}

export function sharedSceneryUrl(): string | null {
  return existsSync(SCENERY_FILE) ? "/api/packs/shared-scenery" : null;
}

export function sharedSceneryPng(): Uint8Array | null {
  if (!existsSync(SCENERY_FILE)) return null;
  return readFileSync(SCENERY_FILE);
}

export function presentLibraryCharacter(character: LibraryCharacter): LibraryCharacter {
  return presentPairMember(character, discoverApprovedHeads(), sharedSceneryUrl());
}

export function presentLibraryRig(character: LibraryCharacter, rig: Character | null): Character | null {
  const scenery = sharedSceneryUrl();
  if (character.name.toLowerCase().includes("charge") || character.name.toLowerCase().includes("caricatura")) {
    return chargeCharacterRig(character, discoverApprovedHeads(), scenery);
  }
  if (!rig) return null;
  return withSharedScenery(rig, scenery);
}
