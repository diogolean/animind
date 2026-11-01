"use client";

import { Pencil } from "lucide-react";
import type { CreationPlan, ToneOption } from "@/lib/contract";
import { ART_STYLES } from "@/lib/contract";

export type PlanField = "mode" | "characters" | "topic" | "tone" | "objective" | "style" | "scenario" | "duration";

const MODES = { monologue: "Monólogo", dialogue: "Diálogo", debate: "Debate" };
const OBJECTIVES = { ensinar: "Ensinar", debater: "Debater", entreter: "Entreter", convencer: "Convencer" };

export function PlanChips({ plan, tones, onEdit }: { plan: CreationPlan; tones: ToneOption[]; onEdit: (field: PlanField) => void }) {
  const chips: { field: PlanField; label: string; value: string }[] = [
    { field: "mode", label: "Modo", value: MODES[plan.mode] },
    { field: "characters", label: "Elenco", value: plan.characters.map((character) => character.name).join(" + ") },
    { field: "topic", label: "Tema", value: plan.topic },
    { field: "tone", label: "Tom", value: tones.find((tone) => tone.id === plan.tone)?.label ?? plan.tone },
    { field: "objective", label: "Objetivo", value: OBJECTIVES[plan.objective] },
    { field: "style", label: "Estilo", value: ART_STYLES.find((style) => style.id === plan.artStyle)?.label ?? plan.artStyle },
    { field: "scenario", label: "Cenário", value: plan.scenarioLabel },
    { field: "duration", label: "Duração", value: `${plan.duration}s` },
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
