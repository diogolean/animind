import { VISEMES, type Character, type CharacterView, type Layer, type ViewName, type Viseme } from "../contract";
import type { LibraryCharacter } from "./types";

const emptyView = (): CharacterView => ({ canvas: { w: 512, h: 640 }, layers: [], visemes: {} });

function asLayer(value: unknown): Layer | null {
  if (!value || typeof value !== "object") return null;
  const layer = value as Record<string, unknown>;
  if (typeof layer.name !== "string" || typeof layer.url !== "string") return null;
  const num = (key: string) => (typeof layer[key] === "number" && Number.isFinite(layer[key] as number) ? (layer[key] as number) : null);
  const x = num("x");
  const y = num("y");
  const w = num("w");
  const h = num("h");
  const z = num("z");
  if (x === null || y === null || w === null || h === null || z === null) return null;
  return { name: layer.name, url: layer.url, x, y, w, h, z };
}

function asView(value: unknown): CharacterView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const view = value as { canvas?: { w?: unknown; h?: unknown }; layers?: unknown; visemes?: unknown; eyeRig?: unknown };
  if (!Array.isArray(view.layers)) return null;
  const layers = view.layers.map(asLayer).filter((layer): layer is Layer => layer !== null);
  const expressions = asExpressions((view as { expressions?: unknown }).expressions);
  const visemes: CharacterView["visemes"] = {};
  if (view.visemes && typeof view.visemes === "object") {
    for (const [name, layer] of Object.entries(view.visemes)) {
      const parsed = asLayer(layer);
      if (parsed && (VISEMES as readonly string[]).includes(name)) visemes[name as Viseme] = parsed;
    }
  }
  const eyeRig = asEyeRig(view.eyeRig);
  return {
    canvas: {
      w: typeof view.canvas?.w === "number" ? view.canvas.w : 512,
      h: typeof view.canvas?.h === "number" ? view.canvas.h : 640,
    },
    layers,
    visemes,
    ...(expressions ? { expressions } : {}),
    ...(eyeRig ? { eyeRig } : {}),
  };
}

function asEyeRig(value: unknown): CharacterView["eyeRig"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rig = value as { maxShift?: unknown; irises?: unknown };
  if (!Array.isArray(rig.maxShift) || rig.maxShift.length !== 2 || !Array.isArray(rig.irises)) return undefined;
  const [x, y] = rig.maxShift;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const irises: [number, number, number][] = [];
  for (const item of rig.irises) {
    if (!Array.isArray(item) || item.length < 3) return undefined;
    const [cx, cy, radius] = item;
    if (![cx, cy, radius].every((part) => typeof part === "number" && Number.isFinite(part))) return undefined;
    irises.push([cx, cy, radius]);
  }
  return { maxShift: [x, y], irises };
}

function asExpressions(value: unknown): Record<string, Layer> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const expressions: Record<string, Layer> = {};
  for (const [key, layer] of Object.entries(value)) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(key)) continue;
    const parsed = asLayer(layer);
    if (parsed) expressions[key] = parsed;
  }
  return Object.keys(expressions).length ? expressions : undefined;
}

function normalizedViewKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

function firstNamedView(views: Record<string, unknown>, keys: readonly string[]): CharacterView | null {
  const wanted = new Set(keys);
  for (const key of keys) {
    const parsed = asView(views[key]);
    if (parsed) return parsed;
  }
  for (const [key, value] of Object.entries(views)) {
    if (!wanted.has(normalizedViewKey(key))) continue;
    const parsed = asView(value);
    if (parsed) return parsed;
  }
  return null;
}

function viewFromLayers(puppet: Record<string, unknown>): CharacterView | null {
  if (!Array.isArray(puppet.layers)) return null;
  const layers = puppet.layers.map(asLayer).filter((layer): layer is Layer => layer !== null);
  if (!layers.length) return null;
  const canvas = puppet.canvas as { w?: unknown; h?: unknown } | undefined;
  return {
    canvas: {
      w: typeof canvas?.w === "number" ? canvas.w : 512,
      h: typeof canvas?.h === "number" ? canvas.h : 640,
    },
    layers,
    visemes: {},
  };
}

/** Turns a stored puppet.json into the Character the renderer already accepts. */
export function puppetToRig(character: LibraryCharacter, puppet: unknown): Character {
  const record = puppet && typeof puppet === "object" ? (puppet as Record<string, unknown>) : {};
  const views = record.views && typeof record.views === "object" ? (record.views as Record<string, unknown>) : {};
  const front = asView(views.front) ?? viewFromLayers(record) ?? emptyView();
  const left =
    firstNamedView(views, [
      "three-quarter-left",
      "left",
      "3-4-left",
      "3/4-left",
      "34-left",
      "three-quarter-esquerda",
      "esquerda",
      "three-quarter",
      "3-4",
      "3/4",
      "34",
    ]) ?? emptyView();
  const right =
    firstNamedView(views, ["three-quarter-right", "right", "3-4-right", "3/4-right", "34-right", "three-quarter-direita", "direita"]) ??
    asView(views.profile) ??
    emptyView();
  const rigViews: Record<ViewName, CharacterView> = { front, left, right };
  const frontImage = character.views.front ?? null;
  return {
    id: character.id,
    name: character.name,
    status: character.status === "ready" ? "ready" : "placeholder",
    style: "rig",
    views: rigViews,
    ...(frontImage ? { imageUrl: frontImage, frontImageUrl: frontImage } : {}),
    generatorNote: "Personagem da sua biblioteca",
    createdAt: character.createdAt,
  };
}
