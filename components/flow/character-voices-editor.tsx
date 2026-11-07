"use client";

import { Volume2 } from "lucide-react";
import { cn } from "cn";
import type { CreationPlanCharacter, LanguageCode, VoiceCatalog, VoiceGender } from "@/lib/contract";

interface CharacterVoicesEditorProps {
  characters: CreationPlanCharacter[];
  onChange: (characters: CreationPlanCharacter[]) => void;
  catalog: VoiceCatalog;
  language: LanguageCode;
  onlyIndex?: number;
  testIdPrefix?: string;
}

export function CharacterVoicesEditor({
  characters,
  onChange,
  catalog,
  language,
  onlyIndex,
  testIdPrefix = "voice",
}: CharacterVoicesEditorProps) {
  const update = (index: number, patch: Partial<CreationPlanCharacter>) =>
    onChange(characters.map((character, itemIndex) => itemIndex === index ? { ...character, ...patch } : character));

  const preview = (character: CreationPlanCharacter) => {
    const gender = character.gender ?? "male";
    const selected = catalog.voices.find((voice) => voice.id === character.voiceId)
      ?? catalog.voices.find((voice) => voice.id === catalog.defaultByGender[gender]);
    if (selected?.previewUrl) {
      void new Audio(selected.previewUrl).play();
      return;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const sample = new SpeechSynthesisUtterance(language === "pt-BR" ? `Olá, eu sou ${character.name || "seu personagem"}.` : `Hello, I am ${character.name || "your character"}.`);
      sample.lang = language;
      window.speechSynthesis.speak(sample);
    }
  };

  return (
    <div className="space-y-3">
      {characters.map((character, index) => {
        if (onlyIndex !== undefined && onlyIndex !== index) return null;
        const gender = character.gender ?? "male";
        const voices = catalog.voices.filter((voice) => voice.gender === gender);
        return (
          <div key={index} className="rounded-2xl border border-white/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-medium">{character.name || `Personagem ${index + 1}`}</p>
              <div className="flex rounded-full bg-white/[0.05] p-1">
                {(["male", "female"] as const).map((option: VoiceGender) => (
                  <button
                    key={option}
                    type="button"
                    data-testid={`${testIdPrefix}-gender-${index}-${option}`}
                    onClick={() => update(index, { gender: option, voiceId: undefined })}
                    className={cn("rounded-full px-3 py-1 text-xs transition", gender === option ? "bg-white text-black" : "text-muted-foreground hover:text-white")}
                  >
                    {option === "male" ? "Masc." : "Fem."}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <select
                data-testid={`${testIdPrefix}-select-${index}`}
                value={character.voiceId ?? "auto"}
                onChange={(event) => update(index, { voiceId: event.target.value === "auto" ? undefined : event.target.value })}
                className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm"
              >
                <option value="auto">Automática · {gender === "male" ? "masculina" : "feminina"}</option>
                {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
              </select>
              <button
                type="button"
                data-testid={`${testIdPrefix}-preview-${index}`}
                onClick={() => preview(character)}
                title="Ouvir prévia"
                className="flex h-10 items-center gap-2 rounded-xl border px-3 text-sm text-muted-foreground hover:text-white"
              >
                <Volume2 className="size-4" /><span className="hidden sm:inline">Prévia</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
