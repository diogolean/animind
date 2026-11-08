import type { AvatarIntent, AvatarParticipant, AvatarPlan, LanguageCode } from "./contract";
import { inferAutoConfig } from "./auto-config";
import { inferLanguage } from "./planner";

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const INANIMATE = new Set([
  "library", "room", "stage", "podium", "agora", "column", "columns", "table", "chair", "book", "books",
  "microphone", "background", "scenery", "scene", "audience", "arena", "studio", "classroom", "space",
  "ship", "planet", "temple", "palace", "forest", "city", "street", "sky", "sea", "ocean", "mountain",
  "window", "door", "lamp", "camera", "video", "script", "music", "light", "shadow", "floor", "wall",
  "ceiling", "garden", "park", "beach", "castle", "throne", "desk", "screen", "computer", "phone",
  "biblioteca", "sala", "palco", "pulpito", "coluna", "colunas", "mesa", "cadeira", "livro", "livros",
  "microfone", "fundo", "cenario", "plateia", "estudio", "escola", "nave", "planeta", "templo",
  "palacio", "floresta", "cidade", "rua", "ceu", "mar", "oceano", "montanha", "janela", "porta",
  "lampada", "roteiro", "musica", "luz", "sombra", "chao", "parede", "teto", "jardim", "parque",
  "praia", "castelo", "trono", "tela", "computador", "telefone", "aula", "lousa", "plateia",
]);

const TOPIC = new Set([
  "truth", "verdade", "time", "tempo", "death", "morte", "life", "vida", "courage", "coragem",
  "ethics", "etica", "science", "ciencia", "history", "historia", "love", "amor", "war", "guerra",
  "faith", "fe", "justice", "justica", "freedom", "liberdade", "knowledge", "conhecimento",
  "reality", "realidade", "mind", "mente", "soul", "alma", "nature", "natureza", "art", "arte",
  "politics", "politica", "future", "futuro", "past", "passado", "wonder", "circuits", "circuitos",
  "funding", "money", "dinheiro", "good", "evil", "bem", "mal",
]);

const STOP = new Set(["the", "and", "of", "de", "da", "do", "em", "on", "in", "um", "uma", "a", "o", "os", "as"]);

export type AvatarIssue = "speaker" | "second-identity" | "selection" | "resolution";

const titleCase = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60)
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase());

function cleanChunk(value: string): string {
  return value.replace(/^(?:the|an|um|uma|o|os|as|de|do|da|of|a)\s+/i, "").replace(/[?.!,;:]+$/g, "").trim();
}

function labelName(raw: string): string {
  const clean = cleanChunk(raw).replace(/\s+/g, " ").slice(0, 60);
  if (!clean) return "";
  return /[\p{Lu}]/u.test(clean) ? clean : titleCase(clean);
}

function isPerson(name: string): boolean {
  const folded = fold(name);
  if (!folded || folded.length < 2) return false;
  if (INANIMATE.has(folded) || TOPIC.has(folded)) return false;
  const parts = folded.split(" ").filter(Boolean);
  if (parts.length === 0 || parts.every((part) => INANIMATE.has(part) || TOPIC.has(part) || STOP.has(part))) return false;
  return true;
}

function splitCast(chunk: string): string[] {
  const names: string[] = [];
  for (const part of chunk.split(/\s*,\s*|\s+\be\b\s+|\s+\band\b\s+|\s+\bversus\b\s+|\s+\bvs\.?\b\s+/i)) {
    const label = labelName(part);
    if (!label || !isPerson(label)) continue;
    if (names.some((item) => fold(item) === fold(label))) continue;
    names.push(label);
  }
  return names;
}

function withoutTopic(prompt: string): string {
  return prompt.replace(/\b(?:sobre|about|debatendo|debating|discutindo|discussing|explicando|explaining)\s+.+$/i, "").trim();
}

function intentOf(prompt: string): AvatarIntent {
  const text = fold(prompt);
  if (/\b(debate|debates|debatendo|debater|debatem|versus|confronto|debating)\b/.test(text)) return "debate";
  if (/\b(apresentacao|apresenta|presentation|presents)\b/.test(text)) return "presentation";
  if (/\b(discurso|speech|palestra|keynote)\b/.test(text)) return "speech";
  if (/\b(monologo|monologue|soliloquio)\b/.test(text)) return "monologue";
  return "unspecified";
}

function namesFrom(prompt: string): string[] {
  const body = withoutTopic(prompt);
  const between = body.match(/\b(?:entre|between)\s+(.+)$/i);
  if (between) return splitCast(between[1]);
  const versus = body.match(/^(.+?)\s+(?:versus|vs\.?)\s+(.+)$/i);
  if (versus) return splitCast(`${versus[1]}, ${versus[2]}`);
  const withName = body.match(/\b(?:debate|monologo|monologue|apresentacao|apresentação|presentation|discurso|speech|palestra)\s+(?:de|do|da|of|by|com|with)\s+(.+)$/i);
  if (withName) return splitCast(withName[1]);
  const pair = body.match(/^(.+?)\s+(?:and|e)\s+(.+?)\s+(?:debate|debates|debatem|debatendo)\b/i);
  if (pair) return splitCast(`${pair[1]}, ${pair[2]}`);
  const debates = body.match(/^(.+?)\s+(?:debates|debate|debatem)\s+(.+)$/i);
  if (debates) return splitCast(`${debates[1]}, ${debates[2]}`);
  const subject = body.match(/^(.+?)\s+(?:fala|explica|ensina|apresenta|discursa|presents|speaks|explains|teaches)\b/i);
  if (subject) return splitCast(subject[1]);
  const leading = body.match(/^(.+?)\s+(?:debatendo|debating)\b/i);
  if (leading) return splitCast(leading[1]);
  return [];
}

function slug(name: string): string {
  const base = fold(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "person";
  return base.slice(0, 40);
}

function participantsFrom(names: string[], source: AvatarParticipant["source"]): AvatarParticipant[] {
  const used = new Set<string>();
  return names.map((name) => {
    let id = slug(name);
    while (used.has(id)) id = `${id}-2`;
    used.add(id);
    return { id, name, source };
  });
}

function contextOf(prompt: string): string {
  const match = prompt.match(/\b(?:sobre|about|debatendo|debating|discutindo|discussing|explicando|explaining)\s+(.+?)[.!?]*$/i);
  return (match?.[1] ?? "").trim().slice(0, 160);
}

export function avatarIssues(plan: AvatarPlan): AvatarIssue[] {
  const issues: AvatarIssue[] = [];
  const selected = plan.participants.filter((item) => plan.selectedIds.includes(item.id) && item.name.trim());
  const distinct = new Set(selected.map((item) => fold(item.name)));
  const named = plan.participants.filter((item) => item.name.trim());
  const chosen = selected.length === plan.defaultCount && selected.length === distinct.size;
  if (!chosen) {
    if (named.length > plan.defaultCount) issues.push("selection");
    else if (named.length === 0) issues.push("speaker");
    else if (named.length < plan.defaultCount) issues.push("second-identity");
    else issues.push("selection");
    if (plan.defaultCount === 2 && named.length === 0) issues.push("second-identity");
  }
  if (plan.requestedResolution === "4k") issues.push("resolution");
  return issues;
}

export function inferAvatarPlan(rawPrompt: string, requestedLanguage?: LanguageCode): AvatarPlan {
  const prompt = rawPrompt.trim().replace(/\s+/g, " ").slice(0, 1200);
  const language = requestedLanguage ?? inferLanguage(prompt);
  const intent = intentOf(prompt);
  const defaultCount: 1 | 2 = intent === "debate" ? 2 : 1;
  const names = namesFrom(prompt);
  const participants = participantsFrom(names, "prompt");
  const context = contextOf(prompt);
  const automatic = inferAutoConfig({
    mode: intent === "debate" ? "dialogue" : "monologue",
    characterNames: names,
    characterPrompts: [],
    topic: context || prompt,
    scriptPrompt: prompt,
  });
  const requestedResolution = /\b4\s*k\b/i.test(prompt) ? "4k" : "1k";
  const selectedIds = names.length === defaultCount ? participants.map((item) => item.id) : [];
  return {
    prompt,
    language,
    intent,
    defaultCount,
    participants,
    selectedIds,
    context,
    artStyle: automatic.artStyle,
    requestedResolution,
    source: "local",
  };
}

export function addAvatarParticipant(plan: AvatarPlan, rawName: string): AvatarPlan {
  const name = labelName(rawName);
  if (!name || !isPerson(name)) return plan;
  if (plan.participants.some((item) => fold(item.name) === fold(name))) return plan;
  const [participant] = participantsFrom([name], "edited");
  const participants = [...plan.participants, { ...participant, id: uniqueId(plan, participant.id) }];
  const named = participants.length;
  const selectedIds = named === plan.defaultCount ? participants.map((item) => item.id) : plan.selectedIds;
  return { ...plan, participants, selectedIds };
}

function uniqueId(plan: AvatarPlan, base: string): string {
  const used = new Set(plan.participants.map((item) => item.id));
  let id = base;
  while (used.has(id)) id = `${id}-2`;
  return id;
}

export function pinAvatarParticipant(plan: AvatarPlan, rawName: string): AvatarPlan {
  const name = labelName(rawName);
  if (!name || !isPerson(name)) return plan;
  const next = addAvatarParticipant(plan, name);
  return {
    ...next,
    participants: next.participants.map((item) => fold(item.name) === fold(name) ? { ...item, source: "library" } : item),
  };
}

export function toggleAvatarParticipant(plan: AvatarPlan, id: string): AvatarPlan {
  if (!plan.participants.some((item) => item.id === id)) return plan;
  const has = plan.selectedIds.includes(id);
  if (!has && plan.selectedIds.length >= plan.defaultCount) return plan;
  const selectedIds = has ? plan.selectedIds.filter((item) => item !== id) : [...plan.selectedIds, id];
  return { ...plan, selectedIds };
}

/** Opaque key. The prompt text is not the key. */
export function avatarAttemptKey(prompt: string, names: string[]): string {
  const raw = `${fold(prompt)}|${names.map(fold).sort().join("|")}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  return `av_${hash.toString(16)}`;
}

export function buttonAllowsClick(issues: AvatarIssue[], included: boolean): boolean {
  return !included && !issues.includes("speaker") && !issues.includes("second-identity") && !issues.includes("selection") && !issues.includes("resolution");
}
