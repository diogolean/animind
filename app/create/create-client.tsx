"use client";
import { useMemo, useSyncExternalStore } from "react";
import type { CharacterSource } from "@/lib/contract";
import { Studio } from "@/components/studio";

const noop = () => () => {};

export function CreateClient({ q, portrait, upload }: { q: string; portrait: string; upload: boolean }) {
  const stored = useSyncExternalStore(noop, () => (upload ? sessionStorage.getItem("animind:upload-confirmed") : null), () => null);
  const source = useMemo<CharacterSource | null>(() => {
    if (portrait) return { kind: "catalog", portraitId: portrait };
    if (upload) {
      if (!stored) return null;
      const u = JSON.parse(stored) as { name: string; data: string };
      return { kind: "upload", imageDataUrl: u.data, name: u.name, rightsConfirmed: true };
    }
    return q.trim() ? { kind: "prompt", prompt: q } : null;
  }, [q, portrait, upload, stored]);
  return <Studio source={source} />;
}
