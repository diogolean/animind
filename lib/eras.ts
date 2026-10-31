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
