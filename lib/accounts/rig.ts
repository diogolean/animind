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
  const visemes: CharacterView["visemes"] = {};
  if (view.visemes && typeof view.visemes === "object") {
    for (const [name, layer] of Object.entries(view.visemes)) {
      const parsed = asLayer(layer);
      if (parsed && (VISEMES as readonly string[]).includes(name)) visemes[name as Viseme] = parsed;
    }
  }
  return {
    canvas: {
      w: typeof view.canvas?.w === "number" ? view.canvas.w : 512,
      h: typeof view.canvas?.h === "number" ? view.canvas.h : 640,
    },
    layers,
    visemes,
  };
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
  const left = asView(views.left) ?? asView(views.three_quarter) ?? asView(views["three-quarter"]) ?? emptyView();
  const right = asView(views.right) ?? asView(views.profile) ?? emptyView();
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
