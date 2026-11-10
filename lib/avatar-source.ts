import { decodePngRgba, type Raster } from "./png-rgba";

/**
 * Avatar plate contract for the importer and the viewer.
 *
 * The cutout itself stays in the core factory (BiRefNet, then the existing
 * chroma fallback, then softness). This module does not matte, feather, or
 * upscale. It keeps the source bytes, records the real size, and refuses to
 * call a plate ready when the alpha or the resolution does not hold.
 *
 * Stage colours and the fringe distance are the factory's published values
 * (products/aiwake/animator/factory prompts, and chroma_key_cutout tolerance
 * 22 with `distance <= tolerance * 2.55`). They are an inspection list, not
 * a new keyer.
 */

export const MIN_LONG_SIDE = 1024;
/** UHD long side. A plate counts as native 4K only when the provider wrote at least this and said the pixels are native. */
export const FOUR_K_LONG_SIDE = 3840;

/** Factory generation backdrops. Copied from the core prompts. Not a price and not a new palette. */
export const FACTORY_STAGE_COLORS = [
  { name: "midnight-blue", rgb: [0x0a, 0x11, 0x28] },
  { name: "chroma-blue", rgb: [0x00, 0x33, 0xcc] },
  { name: "magenta", rgb: [0xff, 0x00, 0xff] },
  { name: "neutral-grey", rgb: [0x7b, 0x8c, 0x9e] },
  { name: "slate-blue", rgb: [0x9f, 0xba, 0xcd] },
] as const;

/** `chroma_key_cutout` uses tolerance 22 and compares distance with `tolerance * 2.55`. */
export const FACTORY_CHROMA_DISTANCE = 22 * 2.55;

export type PlateKind = "transparent" | "opaque-black" | "baked";
export type SceneryState = "ready" | "needs-original" | "needs-scenery";
export type RequestedResolution = "1k" | "4k";
export type Provenance = "native" | "upscale" | "source";

export interface ResolutionSupport {
  premium: boolean;
  providerSupports4k: boolean;
}

const FLAT_NAME = /^(?:flattened|composed|canvas|final)\.png$/i;

export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80) return null;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const start = offset + 8;
    if (start + length + 4 > bytes.length) return null;
    if (type === "IHDR" && length >= 8) {
      const width = readUint32(bytes, start);
      const height = readUint32(bytes, start + 4);
      if (width < 1 || height < 1) return null;
      return { width, height };
    }
    if (type === "IEND") break;
    offset = start + length + 4;
  }
  return null;
}

export function plateKind(raster: Raster): PlateKind {
  const count = raster.width * raster.height;
  if (count === 0) return "baked";
  let transparent = 0;
  let opaque = 0;
  let blackOpaque = 0;
  let border = 0;
  let borderTransparent = 0;
  let borderBlack = 0;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const index = (y * raster.width + x) * 4;
      const alpha = raster.data[index + 3];
      const black = raster.data[index] < 12 && raster.data[index + 1] < 12 && raster.data[index + 2] < 12;
      const edge = x === 0 || y === 0 || x === raster.width - 1 || y === raster.height - 1;
      if (edge) {
        border += 1;
        if (alpha < 16) borderTransparent += 1;
        else if (alpha > 240 && black) borderBlack += 1;
      }
      if (alpha < 16) transparent += 1;
      else if (alpha > 240) {
        opaque += 1;
        if (black) blackOpaque += 1;
      }
    }
  }
  if (border > 0 && transparent / count >= 0.02 && borderTransparent / border >= 0.5) return "transparent";
  if (opaque / count > 0.98 && blackOpaque / Math.max(1, opaque) > 0.2 && border > 0 && borderBlack / border > 0.5) return "opaque-black";
  return "baked";
}

export function sceneryState(kind: PlateKind, hasSceneryLayer: boolean): SceneryState {
  if (kind !== "transparent") return "needs-original";
  if (!hasSceneryLayer) return "needs-scenery";
  return "ready";
}

export function longSide(width: number, height: number): number {
  return Math.max(width, height);
}

/** No entitlement record exists. A browser field cannot turn this on. */
export function productResolutionSupport(): ResolutionSupport {
  return { premium: false, providerSupports4k: false };
}

export function readRequestedResolution(body: unknown): RequestedResolution | "absent" | "invalid" {
  if (!body || typeof body !== "object") return "absent";
  const value = (body as { requestedResolution?: unknown }).requestedResolution;
  if (value == null || value === "") return "absent";
  if (value === "1k" || value === "1K") return "1k";
  if (value === "4k" || value === "4K") return "4k";
  return "invalid";
}

export function authorizeResolution(
  requested: RequestedResolution | "absent" | "invalid",
  support: ResolutionSupport,
): { ok: true; requested: RequestedResolution } | { ok: false; code: "resolution_unavailable" | "resolution_invalid" } {
  if (requested === "invalid") return { ok: false, code: "resolution_invalid" };
  const choice: RequestedResolution = requested === "absent" ? "1k" : requested;
  if (choice === "4k" && !(support.premium && support.providerSupports4k)) {
    return { ok: false, code: "resolution_unavailable" };
  }
  return { ok: true, requested: choice };
}

export function resolutionRecord(input: {
  requested: RequestedResolution;
  width: number;
  height: number;
  provenance: Provenance;
}): {
  requested: RequestedResolution;
  width: number;
  height: number;
  provenance: Provenance;
  satisfies: "1k" | "4k" | "legacy-below-1k" | "not-native";
} {
  const side = longSide(input.width, input.height);
  const base = { requested: input.requested, width: input.width, height: input.height, provenance: input.provenance };
  if (input.provenance === "upscale") return { ...base, satisfies: "not-native" };
  if (side < MIN_LONG_SIDE) return { ...base, satisfies: "legacy-below-1k" };
  if (input.requested === "4k" && input.provenance === "native" && side >= FOUR_K_LONG_SIDE) return { ...base, satisfies: "4k" };
  if (input.requested === "4k") return { ...base, satisfies: "not-native" };
  return { ...base, satisfies: "1k" };
}

export function stageFringe(raster: Raster): { color: (typeof FACTORY_STAGE_COLORS)[number]["name"] | null } {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  for (let index = 0; index < raster.data.length; index += 4) {
    const alpha = raster.data[index + 3];
    if (alpha <= 0 || alpha >= 255) continue;
    reds.push(raster.data[index]);
    greens.push(raster.data[index + 1]);
    blues.push(raster.data[index + 2]);
  }
  if (reds.length < 16) return { color: null };
  const median = [medianOf(reds), medianOf(greens), medianOf(blues)];
  for (const stage of FACTORY_STAGE_COLORS) {
    const distance = Math.hypot(median[0] - stage.rgb[0], median[1] - stage.rgb[1], median[2] - stage.rgb[2]);
    if (distance <= FACTORY_CHROMA_DISTANCE) return { color: stage.name };
  }
  return { color: null };
}

export interface AvatarAssessment {
  width: number;
  height: number;
  kind: PlateKind;
  resolution: "1k" | "legacy-below-1k";
  provenance: "source";
  block: string | null;
}

/** Reads `avatar.png` when the package has one. Legacy folders without that file are left alone. Bytes are not rewritten. */
export function assessImportedAvatar(files: { path: string; bytes: Uint8Array }[]): AvatarAssessment | null {
  const file = files.find((item) => item.path.split("/").pop() === "avatar.png");
  if (!file) return null;
  const size = pngSize(file.bytes);
  if (!size) {
    return { width: 0, height: 0, kind: "baked", resolution: "legacy-below-1k", provenance: "source", block: "unreadable-plate" };
  }
  const raster = decodePngRgba(file.bytes);
  const kind = raster ? plateKind(raster) : "baked";
  const resolution = longSide(size.width, size.height) >= MIN_LONG_SIDE ? "1k" : "legacy-below-1k";
  let block: string | null = null;
  if (!raster || kind !== "transparent") block = "needs-original";
  else if (stageFringe(raster).color) block = "stage-fringe";
  else if (resolution === "legacy-below-1k") block = "legacy-below-1k";
  return { width: size.width, height: size.height, kind, resolution, provenance: "source", block };
}

export function retainAvatarSources<T extends { path: string; bytes: Uint8Array }>(files: T[]): T[] {
  const avatarDirs = new Set<string>();
  for (const file of files) {
    if (file.path.split("/").pop() === "avatar.png") avatarDirs.add(directoryOf(file.path));
  }
  if (avatarDirs.size === 0) return files.slice();
  return files.filter((file) => {
    const name = file.path.split("/").pop() ?? "";
    if (!FLAT_NAME.test(name)) return true;
    return !avatarDirs.has(directoryOf(file.path));
  });
}

export function pointLayersAtAvatar(puppet: Record<string, unknown>, paths: ReadonlySet<string>): void {
  const views = puppet.views;
  if (!views || typeof views !== "object" || Array.isArray(views)) return;
  for (const value of Object.values(views as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const layers = (value as { layers?: unknown }).layers;
    if (!Array.isArray(layers)) continue;
    for (const layer of layers) {
      if (!layer || typeof layer !== "object") continue;
      const url = (layer as { url?: unknown }).url;
      if (typeof url !== "string" || !FLAT_NAME.test(url.split("/").pop() ?? "")) continue;
      const avatar = `${directoryOf(url)}avatar.png`;
      if (paths.has(avatar)) (layer as { url: string }).url = avatar;
    }
  }
}

export function presentAvatar(avatar: Raster, scenery: Raster | null, on: boolean, state: SceneryState): Raster {
  if (state !== "ready" || !on || !scenery || scenery.width !== avatar.width || scenery.height !== avatar.height) {
    return { width: avatar.width, height: avatar.height, data: new Uint8ClampedArray(avatar.data) };
  }
  const out: Raster = { width: avatar.width, height: avatar.height, data: new Uint8ClampedArray(scenery.data) };
  for (let index = 0; index < avatar.data.length; index += 4) {
    const alpha = avatar.data[index + 3];
    if (alpha === 0) continue;
    if (alpha === 255) {
      out.data[index] = avatar.data[index];
      out.data[index + 1] = avatar.data[index + 1];
      out.data[index + 2] = avatar.data[index + 2];
      out.data[index + 3] = 255;
      continue;
    }
    const cover = alpha / 255;
    const keep = 1 - cover;
    out.data[index] = Math.round(avatar.data[index] * cover + out.data[index] * keep);
    out.data[index + 1] = Math.round(avatar.data[index + 1] * cover + out.data[index + 1] * keep);
    out.data[index + 2] = Math.round(avatar.data[index + 2] * cover + out.data[index + 2] * keep);
    out.data[index + 3] = Math.round(alpha + out.data[index + 3] * keep);
  }
  return out;
}

const SCENERY_KEY = "animindly-scenery";

export function sceneryPreference(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | null): {
  read(): boolean;
  write(on: boolean): void;
} {
  return {
    read() {
      return storage?.getItem(SCENERY_KEY) === "1";
    },
    write(on: boolean) {
      storage?.setItem(SCENERY_KEY, on ? "1" : "0");
    },
  };
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function medianOf(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
