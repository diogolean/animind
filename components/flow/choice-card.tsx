"use client";

import { cn } from "cn";

interface ChoiceCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  title: string;
  description: string;
  badge?: string;
}

export function ChoiceCard({ active, title, description, badge, className, ...props }: ChoiceCardProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "rounded-2xl border p-4 text-left transition-colors",
        active
          ? "border-[var(--accent-brand)] bg-[color-mix(in_oklab,var(--accent-brand)_8%,transparent)]"
          : "border-border hover:border-foreground/25",
        className,
      )}
      {...props}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="font-medium">{title}</span>
        {badge ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{badge}</span> : null}
      </span>
      <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{description}</span>
    </button>
  );
}
