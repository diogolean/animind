"use client";

import { Loader2, Plus } from "lucide-react";

export interface CharacterDraft {
  name: string;
  prompt: string;
}

interface CharacterFormProps {
  value: CharacterDraft;
  onChange: (value: CharacterDraft) => void;
  onSubmit: () => void;
  busy?: boolean;
  submitLabel?: string;
}

export function CharacterForm({ value, onChange, onSubmit, busy, submitLabel = "Adicionar personagem" }: CharacterFormProps) {
  const valid = value.name.trim() && value.prompt.trim();
  return (
    <div className="rounded-2xl border bg-card p-4 sm:p-5">
      <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor="character-name">
        Nome
      </label>
      <input
        id="character-name"
        data-testid="character-name"
        value={value.name}
        onChange={(event) => onChange({ ...value, name: event.target.value })}
        maxLength={60}
        placeholder="Ex.: Luna, Sócrates, Capitão Neblina"
        className="mt-2 h-11 w-full rounded-xl border bg-transparent px-3 outline-none focus:border-foreground/30"
      />
      <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor="character-prompt">
        Prompt livre
      </label>
      <textarea
        id="character-prompt"
        data-testid="character-prompt"
        value={value.prompt}
        onChange={(event) => onChange({ ...value, prompt: event.target.value })}
        maxLength={600}
        rows={4}
        placeholder="Aparência, roupa, idade, personalidade e qualquer detalhe visual…"
        className="mt-2 w-full resize-none rounded-xl border bg-transparent p-3 outline-none focus:border-foreground/30"
      />
      <p className="mt-2 text-xs text-muted-foreground">Pode ser uma pessoa real pelo nome ou um personagem inventado.</p>
      <button
        type="button"
        data-testid="add-character"
        disabled={!valid || busy}
        onClick={onSubmit}
        className="mt-4 flex h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm text-background disabled:opacity-30"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {submitLabel}
      </button>
    </div>
  );
}
