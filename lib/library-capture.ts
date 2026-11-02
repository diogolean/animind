import type { AssetKind } from "./accounts/types";

export interface CaptureItem {
  kind: AssetKind;
  name: string;
  text?: string;
  url?: string;
  mime?: string;
  characterId?: string;
  projectId?: string;
}

export interface FinishedGeneration {
  jobId: string;
  libraryCharacterId?: string | null;
  result: {
    template: string;
    topic?: string;
    script: { text: string }[];
    characters: { id: string; name: string; imageUrl?: string; frontImageUrl?: string | null; photo?: { url: string } }[];
    audioUrl?: string | null;
    videoUrl?: string | null;
  };
}

/** The files a finished render should drop into the signed-in user's library. */
export function captureGeneration(input: FinishedGeneration): CaptureItem[] {
  const projectId = input.jobId;
  const libraryId = input.libraryCharacterId?.trim() || undefined;
  const topic = input.result.topic?.trim() || "Criação";
  const transcript = input.result.script
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 20_000);
  const items: CaptureItem[] = [];
  if (transcript) {
    const debate = input.result.template === "debate";
    items.push({
      kind: debate ? "debate" : "script",
      name: debate ? `Debate · ${topic}` : topic,
      text: transcript,
      characterId: libraryId,
      projectId,
    });
  }
  if (input.result.audioUrl) {
    items.push({ kind: "audio", name: `${topic} · áudio`, url: input.result.audioUrl, mime: "audio/mpeg", characterId: libraryId, projectId });
  }
  if (input.result.videoUrl) {
    items.push({ kind: "video", name: `${topic} · vídeo`, url: input.result.videoUrl, mime: "video/mp4", characterId: libraryId, projectId });
  }
  for (const character of input.result.characters) {
    const url = character.frontImageUrl || character.imageUrl || character.photo?.url;
    if (!url) continue;
    items.push({
      kind: "image",
      name: character.name.trim() || "Imagem",
      url,
      mime: "image/png",
      characterId: libraryId || character.id,
      projectId,
    });
  }
  return items;
}
