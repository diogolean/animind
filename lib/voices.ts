import type { LanguageCode, VoiceCatalog, VoiceGender, VoiceOption } from "./contract";

const FALLBACK_VOICES: Record<string, VoiceOption[]> = {
  "en-US": [
    { id: "en-US-AndrewMultilingualNeural", label: "Andrew", language: "en-US", gender: "male" },
    { id: "en-US-BrianMultilingualNeural", label: "Brian", language: "en-US", gender: "male" },
    { id: "en-US-AvaMultilingualNeural", label: "Ava", language: "en-US", gender: "female" },
    { id: "en-US-EmmaMultilingualNeural", label: "Emma", language: "en-US", gender: "female" },
  ],
  "pt-BR": [
    { id: "pt-BR-AntonioNeural", label: "Antônio", language: "pt-BR", gender: "male" },
    { id: "pt-BR-FabioNeural", label: "Fábio", language: "pt-BR", gender: "male" },
    { id: "pt-BR-FranciscaNeural", label: "Francisca", language: "pt-BR", gender: "female" },
    { id: "pt-BR-ThalitaMultilingualNeural", label: "Thalita", language: "pt-BR", gender: "female" },
  ],
};

const gender = (value: unknown): VoiceGender =>
  /^(f|female|femin)/i.test(String(value ?? "")) ? "female" : "male";

export function normalizeVoiceCatalog(data: unknown, language: LanguageCode, source: VoiceCatalog["source"]): VoiceCatalog {
  const raw = (data as { voices?: unknown[] } | null)?.voices;
  const voices = Array.isArray(raw)
    ? raw.flatMap((item) => {
        const value = item as Record<string, unknown>;
        const id = String(value.id ?? value.voice ?? value.name ?? "");
        if (!id) return [];
        return [{
          id,
          label: String(value.label ?? value.displayName ?? id),
          language: String(value.language ?? value.lang ?? value.locale ?? language) as LanguageCode,
          gender: gender(value.gender),
          ...(value.previewUrl ? { previewUrl: String(value.previewUrl) } : {}),
        } satisfies VoiceOption];
      })
    : [];
  const selected = voices.length ? voices : FALLBACK_VOICES[language] ?? FALLBACK_VOICES["en-US"];
  const first = (voiceGender: VoiceGender) => selected.find((voice) => voice.gender === voiceGender)?.id ?? selected[0].id;
  return {
    voices: selected,
    defaultByGender: { male: first("male"), female: first("female") },
    source: voices.length ? source : "fallback",
  };
}

export function fallbackVoiceCatalog(language: LanguageCode): VoiceCatalog {
  return normalizeVoiceCatalog(null, language, "fallback");
}
