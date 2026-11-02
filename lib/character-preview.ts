import type { Character, CharacterPreview, CreationPlanCharacter } from "./contract";

const ACCENTS = ["hsl(218 75% 64%)", "hsl(275 67% 68%)", "hsl(163 61% 55%)", "hsl(30 80% 62%)"];

export const previewAccent = (index: number) => ACCENTS[index % ACCENTS.length];

/** Silhouette shown only while the core is cutting, or as a labeled fallback. */
export function stickPreview(
  character: Pick<CreationPlanCharacter, "name">,
  index: number,
  source: "loading" | "local",
): CharacterPreview {
  return {
    id: `${source}-${index}-${character.name}`,
    index,
    name: character.name || `Personagem ${index + 1}`,
    kind: "stick",
    source,
    accent: previewAccent(index),
    note: source === "loading" ? "Gerando o recorte no núcleo…" : "Prévia local: o núcleo está fora.",
  };
}

/** Real cut-out, or null when this character is still a placeholder (mock / core down). */
export function previewFromCharacter(character: Character, index: number): CharacterPreview | null {
  const cutout = character.views?.front;
  const layers = cutout?.layers ?? [];
  const imageUrl = character.frontImageUrl || character.imageUrl || undefined;
  if (character.status !== "ready" || (layers.length === 0 && !imageUrl)) return null;
  const generator = character.generator;
  const note =
    character.generatorNote ??
    (generator && generator !== "gemini" ? `Arte do núcleo (${generator}), sem gerador de imagem pago.` : undefined);
  return {
    id: character.id,
    index,
    name: character.name,
    kind: "image",
    source: "core",
    accent: previewAccent(index),
    ...(imageUrl ? { imageUrl } : {}),
    ...(layers.length > 0 && cutout ? { cutout } : {}),
    ...(note ? { note } : {}),
  };
}
