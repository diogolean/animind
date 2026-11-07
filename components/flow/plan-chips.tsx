"use client";

import { Pencil } from "lucide-react";
import type { CreationPlan, ToneOption, VoiceCatalog } from "@/lib/contract";
import { ART_STYLES } from "@/lib/contract";
import { languageLabel } from "@/components/flow/language-combobox";
import { useI18n } from "@/components/locale";

export type PlanField = "language" | "mode" | "characters" | "topic" | "tone" | "objective" | "style" | "scenario" | "duration" | `voice-${number}`;

const MODES = {
  en: { monologue: "Monologue", dialogue: "Dialogue", debate: "Debate" },
  "pt-BR": { monologue: "Monólogo", dialogue: "Diálogo", debate: "Debate" },
} as const;
const OBJECTIVES = {
  en: { ensinar: "Teach", debater: "Debate", entreter: "Entertain", convencer: "Persuade" },
  "pt-BR": { ensinar: "Ensinar", debater: "Debater", entreter: "Entreter", convencer: "Convencer" },
} as const;

export function PlanChips({ plan, tones, voices, onEdit }: { plan: CreationPlan; tones: ToneOption[]; voices: VoiceCatalog; onEdit: (field: PlanField) => void }) {
  const { locale, t } = useI18n();
  const chips: { field: PlanField; label: string; value: string }[] = [
    { field: "language", label: t("contentLanguage"), value: languageLabel(voices.languages.find((language) => language.id === plan.language), plan.language) },
    { field: "mode", label: t("mode"), value: MODES[locale][plan.mode] },
    { field: "characters", label: t("cast"), value: plan.characters.map((character) => character.name).join(" + ") },
    ...plan.characters.map((character, index) => {
      const gender = character.gender ?? "male";
      const selected = voices.voices.find((voice) => voice.id === character.voiceId);
      return {
        field: `voice-${index}` as const,
        label: character.name,
        value: `${gender === "male" ? (locale === "en" ? "Male" : "Masc.") : locale === "en" ? "Female" : "Fem."} · ${selected?.label ?? "Auto"}`,
      };
    }),
    { field: "topic", label: t("topic"), value: plan.topic },
    { field: "tone", label: t("tone"), value: tones.find((tone) => tone.id === plan.tone)?.label ?? plan.tone },
    { field: "objective", label: t("objective"), value: OBJECTIVES[locale][plan.objective] },
    { field: "style", label: t("style"), value: ART_STYLES.find((style) => style.id === plan.artStyle)?.label ?? plan.artStyle },
    { field: "scenario", label: t("scene"), value: plan.scenarioLabel },
    { field: "duration", label: t("duration"), value: `${plan.duration}s` },
  ];
  return (
    <div data-testid="plan-chips" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <button
          key={chip.field}
          type="button"
          data-testid={`plan-chip-${chip.field}`}
          onClick={() => onEdit(chip.field)}
          title={`Editar ${chip.label.toLowerCase()}`}
          className="group flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-left text-sm transition hover:border-white/25 hover:bg-white/[0.07]"
        >
          <span className="text-xs text-muted-foreground">{chip.label}</span>
          <span className="max-w-64 truncate font-medium">{chip.value}</span>
          <Pencil className="size-3 text-muted-foreground opacity-50 transition group-hover:opacity-100" />
        </button>
      ))}
    </div>
  );
}
