import type { Scenario } from "./contract";

/** Classical Greek/Roman figures: their debates default to the Ágora set (era-matched scenery).
 *  Matching is accent- and case-insensitive on whole words of the persona name. */
const CLASSICAL = [
  "socrates", "platao", "plato", "aristoteles", "aristotle", "diogenes", "epicuro", "epicurus", "seneca",
  "marco aurelio", "marcus aurelius", "heraclito", "heraclitus", "pitagoras", "pythagoras", "parmenides",
  "zenao", "zeno", "democrito", "democritus", "tales", "thales", "protagoras", "hipocrates", "hippocrates",
  "euclides", "euclid", "arquimedes", "archimedes", "cicero", "epicteto", "epictetus", "homero", "homer",
  "safo", "sappho", "pericles", "hipatia", "hypatia", "plotino", "plotinus", "xenofonte", "anaximandro",
];

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function placeForPersona(name: string): Scenario | null {
  const n = ` ${fold(name).replace(/[^a-z]+/g, " ")} `;
  return CLASSICAL.some((k) => n.includes(` ${k} `)) ? "agora" : null;
}

/** Deterministic fallback while the core does not generate scenery from a prompt. */
export function placeForPrompt(prompt: string): Scenario {
  const p = fold(prompt);
  if (/(grecia|grego|romano|antiguidade|agora|templo|coluna)/.test(p)) return "agora";
  if (/(espaco|nave|planeta|estrela|futuro|lua|marte)/.test(p)) return "space";
  if (/(escola|sala de aula|lousa|quadro|universidade)/.test(p)) return "classroom";
  if (/(arena|estadio|palco|debate|auditorio)/.test(p)) return "arena";
  return "studio";
}
