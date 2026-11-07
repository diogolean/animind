import type { QuoteRef } from "./contract";

/**
 * Real quote sheets for the dev mock (no core): a few quotes copied byte for byte from the core's cached
 * Wikiquote sheets (products/animind_core personas, pt-BR), with their sources and links. The mock may only
 * show these as "Citação real"; every other line is a marked paraphrase. Text: Wikiquote, CC BY-SA 4.0.
 */
export interface SheetQuote extends Omit<QuoteRef, "site"> {
  /** Mock only: the idea a written reply picks up from this quote. */
  idea?: string;
}

export interface QuoteSheet {
  name: string;
  wikiquote: string;
  license: string;
  /** Mock roles: the quote a speaker opens with (thesis / lesson), turns with, closes with. */
  roles: { thesis: string; turn: string; close: string };
  quotes: SheetQuote[];
}

export const fold = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const MOCK_SHEETS: Record<string, QuoteSheet> = {
  "socrates": {
    "name": "Sócrates",
    "wikiquote": "https://pt.wikiquote.org/wiki/S%C3%B3crates",
    "license": "Textos da Wikiquote, CC BY-SA 4.0",
    "roles": {
      "thesis": "q3",
      "turn": "q1",
      "close": "q4"
    },
    "quotes": [
      {
        "id": "q1",
        "text": "As palavras falsas não são apenas más em si, mas também infectam a alma com o mal.",
        "source": "Platão · Fédon, 91",
        "label": "Platão · Fédon, 91",
        "url": "https://pt.wikiquote.org/wiki/S%C3%B3crates",
        "idea": "palavras falsas"
      },
      {
        "id": "q3",
        "text": "A admiração é o sentimento de um filósofo, e a filosofia começa pela admiração.",
        "source": "Platão · Teeteto 150c",
        "label": "Platão · Teeteto 150c",
        "url": "https://pt.wikiquote.org/wiki/S%C3%B3crates",
        "idea": "admiração"
      },
      {
        "id": "q4",
        "text": "A hora da partida chegou, e seguimos os nossos caminhos - eu de morrer e você de viver. Qual é o melhor, só Deus sabe.",
        "source": "Platão · Apologia de Sócrates · 42a",
        "label": "Platão · Apologia de Sócrates · 42a",
        "url": "https://pt.wikiquote.org/wiki/S%C3%B3crates"
      }
    ]
  },
  "nietzsche": {
    "name": "Nietzsche",
    "wikiquote": "https://pt.wikiquote.org/wiki/Friedrich_Nietzsche",
    "license": "Textos da Wikiquote, CC BY-SA 4.0",
    "roles": {
      "thesis": "q21",
      "turn": "q3",
      "close": "q24"
    },
    "quotes": [
      {
        "id": "q3",
        "text": "Na Escola Bélica da Vida — O que não me faz morrer me torna mais forte.",
        "source": "O Crepúsculo dos Ídolos · Página 10, Máximas e Sátiras, 8",
        "label": "O Crepúsculo dos Ídolos · Máximas e Sátiras, 8",
        "url": "https://pt.wikiquote.org/wiki/Friedrich_Nietzsche",
        "idea": "mais forte"
      },
      {
        "id": "q21",
        "text": "'Verdade' é a vontade de tornar-se senhor da multiplicidade de sensações - seria os fenômenos em categorias determinadas.",
        "source": "Vontade de Potência",
        "label": "Vontade de Potência",
        "url": "https://pt.wikiquote.org/wiki/Friedrich_Nietzsche",
        "idea": "vontade"
      },
      {
        "id": "q24",
        "text": "Sem música a vida seria um erro.",
        "source": "O Crepúsculo dos Ídolos · Página 13 Máximas e Sátiras, 33",
        "label": "O Crepúsculo dos Ídolos · Máximas e Sátiras, 33",
        "url": "https://pt.wikiquote.org/wiki/Friedrich_Nietzsche"
      }
    ]
  }
};

/** The mock sheet for a persona typed as "Sócrates", "socrates, de toga", "Friedrich Nietzsche"... */
export function mockSheet(name: string): QuoteSheet | null {
  const words = fold(name.split(/[,(:;]| - /)[0]).split(" ");
  for (const [key, sheet] of Object.entries(MOCK_SHEETS)) if (words.includes(key)) return sheet;
  return null;
}
