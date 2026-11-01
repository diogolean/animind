"use client";

import { Plus, Trash2 } from "lucide-react";
import type { CreationPlanCharacter } from "@/lib/contract";

interface CharacterListEditorProps {
  value: CreationPlanCharacter[];
  onChange: (characters: CreationPlanCharacter[]) => void;
  testIdPrefix?: string;
}

export function CharacterListEditor({ value, onChange, testIdPrefix = "character" }: CharacterListEditorProps) {
  const update = (index: number, patch: Partial<CreationPlanCharacter>) =>
    onChange(value.map((character, itemIndex) => itemIndex === index ? { ...character, ...patch } : character));

  return (
    <div className="space-y-3">
      {value.map((character, index) => (
        <div key={index} className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-[0.7fr_1.5fr_auto]">
          <input
            data-testid={`${testIdPrefix}-name-${index}`}
            value={character.name}
            onChange={(event) => update(index, { name: event.target.value })}
            maxLength={60}
            aria-label={`Nome do personagem ${index + 1}`}
            placeholder="Nome"
            className="h-11 rounded-xl border bg-transparent px-3 outline-none focus:border-foreground/30"
          />
          <input
            data-testid={`${testIdPrefix}-prompt-${index}`}
            value={character.prompt}
            onChange={(event) => update(index, { prompt: event.target.value })}
            maxLength={600}
            aria-label={`Descrição do personagem ${index + 1}`}
            placeholder="Aparência, roupa, idade e personalidade"
            className="h-11 rounded-xl border bg-transparent px-3 outline-none focus:border-foreground/30"
          />
          <button
            type="button"
            aria-label={`Remover personagem ${index + 1}`}
            disabled={value.length === 1}
            onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
            className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-20"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      {value.length < 6 ? (
        <button
          type="button"
          data-testid={`${testIdPrefix}-add`}
          onClick={() => onChange([...value, { name: "", prompt: "" }])}
          className="flex h-10 items-center gap-2 rounded-full border px-4 text-sm text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-4" />Adicionar personagem
        </button>
      ) : null}
    </div>
  );
}
