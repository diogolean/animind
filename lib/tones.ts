import type { Tone, ToneCatalog } from "./contract";

interface CoreTone {
  id?: unknown;
  label?: unknown;
}

const PRODUCT_TONES: { id: Tone; label: string; aliases: string[]; fallbackId: string }[] = [
  { id: "humor", label: "Humor", aliases: ["humor", "comedia", "comedy"], fallbackId: "comedia" },
  { id: "terror", label: "Terror", aliases: ["terror", "horror"], fallbackId: "horror" },
  { id: "educacional", label: "Educacional", aliases: ["educacional", "educativo", "educational"], fallbackId: "serio" },
  { id: "sabio", label: "Sábio", aliases: ["sabio", "sabedoria", "wise", "wisdom"], fallbackId: "serio" },
  { id: "serio", label: "Sério", aliases: ["serio", "serious"], fallbackId: "serio" },
];

const KNOWN_CORE_TONES: CoreTone[] = [
  { id: "comedia", label: "Comédia" },
  { id: "ficcao", label: "Ficção" },
  { id: "horror", label: "Horror" },
  { id: "serio", label: "Sério" },
];

const fold = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();

export function normalizeToneCatalog(data?: { tones?: CoreTone[] } | null, source: ToneCatalog["source"] = "fallback"): ToneCatalog {
  const advertised = data?.tones?.length ? data.tones : KNOWN_CORE_TONES;
  const tones = PRODUCT_TONES.map((product) => {
    const hit = advertised.find((candidate) => {
      const words = `${fold(String(candidate.id ?? ""))} ${fold(String(candidate.label ?? ""))}`;
      return product.aliases.some((alias) => words.split(" ").includes(alias));
    });
    return {
      id: product.id,
      label: product.label,
      coreId: hit ? String(hit.id) : product.fallbackId,
      fallback: !hit,
    };
  });
  return { tones, default: "humor", source };
}

export function coreToneId(tone: Tone | undefined, catalog: ToneCatalog): string {
  return catalog.tones.find((option) => option.id === tone)?.coreId ?? catalog.tones[0].coreId;
}
