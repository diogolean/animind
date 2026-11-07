import type { ArtStyle, Objective, ScenarioRequest, Tone } from "./contract";
import { placeForPersona, placeForPrompt } from "./eras";

export interface AutoConfigInput {
  mode: "monologue" | "dialogue";
  characterNames: string[];
  characterPrompts: string[];
  topic: string;
  scriptPrompt?: string;
}

export interface AutoConfig {
  tone: Tone;
  objective: Objective;
  artStyle: ArtStyle;
  duration: 30 | 60 | 90;
  scenarioRequest: ScenarioRequest;
  scenarioLabel: string;
}

const fold = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function inferAutoConfig(input: AutoConfigInput): AutoConfig {
  const text = fold([...input.characterNames, ...input.characterPrompts, input.topic, input.scriptPrompt ?? ""].join(" "));
  const philosophical = /(socrates|platao|aristoteles|filosof|sabedoria|etica|existencia|morte|sentido da vida)/.test(text);
  const frightening = /(terror|horror|fantasma|assombr|monstro|pesadelo|sombrio|macabr|sangue)/.test(text);
  const funny = /(humor|comedia|piada|engracad|divertid|satira|parodia)/.test(text);
  const educational = /(ensina|explique|explica|educa|aula|tutorial|como |por que|historia de|ciencia)/.test(text);

  const tone: Tone = philosophical ? "sabio" : frightening ? "terror" : funny ? "humor" : educational ? "educacional" : "serio";
  const objective: Objective =
    /(convenc|persuad|venda|campanha|defenda)/.test(text)
      ? "convencer"
      : input.mode === "dialogue" || /(debate|versus|discord|confront)/.test(text)
        ? "debater"
        : philosophical || educational
          ? "ensinar"
          : "entreter";
  const artStyle: ArtStyle = tone === "humor" ? "cartoon" : tone === "terror" ? "retro" : tone === "serio" ? "realista" : "ghibli";
  const duration: 30 | 60 | 90 =
    input.mode === "dialogue" ? 90 : /(curto|rapido|reel|short|30 segundos)/.test(text) ? 30 : 60;

  const era = input.characterNames.map(placeForPersona).find(Boolean);
  if (era) {
    return {
      tone,
      objective,
      artStyle,
      duration,
      scenarioRequest: { mode: "auto", characterNames: input.characterNames },
      scenarioLabel: era === "agora" ? "Ágora · época do personagem" : "Automático por época",
    };
  }

  const promptedScenario = /(espaco|nave|planeta|marte|lua|escola|sala de aula|arena|estadio|palco|grecia|templo)/.test(text);
  const scenario = placeForPrompt(text);
  return {
    tone,
    objective,
    artStyle,
    duration,
    scenarioRequest: promptedScenario
      ? { mode: "prompt", prompt: input.topic || input.characterPrompts.join(" "), characterNames: input.characterNames }
      : { mode: "auto", characterNames: input.characterNames },
    scenarioLabel: promptedScenario
      ? { space: "Espaço", classroom: "Sala de aula", arena: "Arena", agora: "Ágora", studio: "Estúdio" }[scenario]
      : "Estúdio automático",
  };
}
