/** The homepage idea stays in this browser. It is never put in a URL, header, or analytics event. */

const KEY = "animindly-draft";
const MAX = 1200;

export type LocalDraft = { prompt: string; format: "16:9" | "9:16" };

export function saveDraft(prompt: string, format: string): void {
  if (typeof window === "undefined") return;
  const next: LocalDraft = {
    prompt: prompt.slice(0, MAX),
    format: format === "9:16" ? "9:16" : "16:9",
  };
  window.localStorage.setItem(KEY, JSON.stringify({ v: 1, ...next }));
}

export function loadDraft(): LocalDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; prompt?: unknown; format?: unknown };
    if (parsed.v !== 1 || typeof parsed.prompt !== "string") return null;
    return { prompt: parsed.prompt.slice(0, MAX), format: parsed.format === "9:16" ? "9:16" : "16:9" };
  } catch {
    return null;
  }
}
