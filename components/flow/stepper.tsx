"use client";

import { Check } from "lucide-react";
import { cn } from "cn";

export const FLOW_STEPS = ["Modo", "Personagens", "Tema e roteiro", "Cenário", "Gerar"] as const;

export function Stepper({ current, maxStep, onSelect }: { current: number; maxStep: number; onSelect: (step: number) => void }) {
  return (
    <nav aria-label="Etapas da criação" className="mb-8 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-2">
        {FLOW_STEPS.map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              data-testid={`step-${index}`}
              disabled={index > maxStep}
              onClick={() => onSelect(index)}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition-colors",
                index === current ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <span className="grid size-5 place-items-center rounded-full border border-current/30">
                {index < current ? <Check className="size-3" /> : index + 1}
              </span>
              {label}
            </button>
            {index < FLOW_STEPS.length - 1 ? <span className="h-px w-4 bg-border" /> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
