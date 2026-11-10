"use client";

import { sanitizeEvent } from "./analytics";

type Handler = (name: string, params: Record<string, string>) => void;

let handler: Handler | null = null;

export function setAnalyticsHandler(next: Handler | null): void {
  handler = next;
}

export function track(name: string, params: Record<string, string>): void {
  const clean = sanitizeEvent(name, params);
  if (!clean || !handler) return;
  handler(clean.name, clean.params);
}
