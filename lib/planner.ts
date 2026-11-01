import type { CreationMode, CreationPlan, CreationPlanCharacter } from "./contract";
import { inferAutoConfig } from "./auto-config";

const fold = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const titleCase = (value: string) =>
  value
    .trim()
    .replace(/^(?:o|a|um|uma)\s+/i, "")
    .replace(/\s+/g, " ")
    .slice(0, 60)
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase());

function inferMode(prompt: string): CreationMode {
  const text = fold(prompt);
  if (/\b(debate|debatendo|debater|versus|confronto)\b/.test(text)) return "debate";
  if (/\b(conversa|conversando|dialogo|entrevista|entre)\b/.test(text)) return "dialogue";
  return "monologue";
}

function namedCharacters(prompt: string, mode: CreationMode): string[] {
  const between = prompt.match(
    /\bentre\s+(.+?)\s+e\s+(.+?)(?=\s+(?:debatendo|conversando|dialogando|discutindo|falando|sobre|que|numa?|em)\b|[,.!?]|$)/i,
  );
  if (between) return [titleCase(between[1]), titleCase(between[2])].filter(Boolean);

  const withPair = prompt.match(
    /\b(?:conversa|dialogo|debate)\s+(?:de\s+)?(.+?)\s+(?:com|e|versus)\s+(.+?)(?=\s+(?:sobre|debatendo|discutindo|em)\b|[,.!?]|$)/i,
  );
  if (withPair) return [titleCase(withPair[1]), titleCase(withPair[2])].filter(Boolean);

  const solo = prompt.match(/^(.+?)\s+(?:fala|explica|ensina|conta|reflete)\b/i);
  if (solo) return [titleCase(solo[1])];
  return mode === "monologue" ? ["Personagem principal"] : ["Personagem 1", "Personagem 2"];
}

function inferTopic(prompt: string): string {
  const match = prompt.match(/\b(?:sobre|debatendo|discutindo|explicando)\s+(.+?)[.!?]*$/i);
  return (match?.[1] ?? prompt).trim().slice(0, 160);
}

export function inferCreationPlan(rawPrompt: string): CreationPlan {
  const prompt = rawPrompt.trim().replace(/\s+/g, " ").slice(0, 1200);
  const mode = inferMode(prompt);
  const names = namedCharacters(prompt, mode);
  const characters: CreationPlanCharacter[] = names.map((name) => ({
    name,
    prompt: `${name}, coerente com esta criação: ${prompt}`.slice(0, 600),
  }));
  const topic = inferTopic(prompt);
  const automatic = inferAutoConfig({
    mode: mode === "monologue" ? "monologue" : "dialogue",
    characterNames: names,
    characterPrompts: characters.map((character) => character.prompt),
    topic,
    scriptPrompt: prompt,
  });
  return {
    prompt,
    mode,
    characters,
    topic,
    tone: automatic.tone,
    objective: mode === "debate" ? "debater" : automatic.objective,
    artStyle: automatic.artStyle,
    characterType: "stick",
    scenarioRequest: automatic.scenarioRequest,
    scenarioLabel: automatic.scenarioLabel,
    duration: automatic.duration,
    source: "local",
  };
}
