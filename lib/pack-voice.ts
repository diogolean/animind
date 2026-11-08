import type { LibraryDemo } from "./accounts/types";
import type { CharacterView, Layer, Viseme } from "./contract";

/** Same cuts as the studio envelope in `lib/engine.ts`. Silence stays X. */
export function envelopeViseme(level: number): Viseme {
  if (level < 0.08) return "X";
  if (level < 0.2) return "A";
  if (level > 0.65) return "D";
  if (level > 0.4) return "C";
  return "B";
}

export function envelopeVisemes(levels: ArrayLike<number>): Viseme[] {
  const out: Viseme[] = [];
  for (let index = 0; index < levels.length; index += 1) out.push(envelopeViseme(levels[index] ?? 0));
  return out;
}

/** One loudness sample per 10ms, scaled so the loudest hop is 1. */
export function envelopeFromChannel(channel: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.max(1, Math.floor(sampleRate / 100));
  const count = Math.ceil(channel.length / hop);
  const env = new Float32Array(count);
  let max = 1e-6;
  for (let index = 0; index < count; index += 1) {
    let sum = 0;
    const end = Math.min(channel.length, (index + 1) * hop);
    for (let sample = index * hop; sample < end; sample += 1) sum += channel[sample] * channel[sample];
    env[index] = Math.sqrt(sum / hop);
    if (env[index] > max) max = env[index];
  }
  for (let index = 0; index < count; index += 1) env[index] /= max;
  return env;
}

function tagged(demo: LibraryDemo, pattern: RegExp): boolean {
  return pattern.test(demo.id) || pattern.test(demo.label);
}

/**
 * Audio already in the pack. A matching audio file wins. Portuguese with only a
 * demo video uses that file. There is no synthesized stand-in.
 */
export function packVoiceUrls(demos: LibraryDemo[] | undefined, locale: "en" | "pt-BR"): string[] {
  const rows = (demos ?? []).filter((demo): demo is LibraryDemo & { url: string } => Boolean(demo.url) && (demo.kind === "audio" || demo.kind === "video"));
  if (!rows.length) return [];
  const pattern = locale === "pt-BR" ? /(?:^|[^a-z])pt(?:[^a-z]|$)/i : /(?:^|[^a-z])en(?:[^a-z]|$)/i;
  const audio = rows.filter((demo) => demo.kind === "audio");
  const taggedAudio = audio.find((demo) => tagged(demo, pattern));
  const taggedVideo = rows.find((demo) => demo.kind === "video" && tagged(demo, pattern));
  const ordered = [taggedAudio?.url, locale === "pt-BR" ? taggedVideo?.url : undefined, ...audio.map((demo) => demo.url)];
  return [...new Set(ordered.filter((url): url is string => Boolean(url)))];
}

export function viewHasMouth(view: CharacterView | undefined): boolean {
  if (!view) return false;
  return Object.values(view.visemes).some((layer) => Boolean(layer));
}

/** Rest is X. A speaking viseme replaces it. An expression plate still wins. */
export function stageMouth(view: CharacterView, emotion: string, viseme: Viseme | null | undefined): { layer: Layer | undefined; speaking: boolean } {
  const expression = emotion !== "rest" ? view.expressions?.[emotion] : undefined;
  if (expression) return { layer: expression, speaking: false };
  if (viseme && viseme !== "X" && view.visemes[viseme]) return { layer: view.visemes[viseme], speaking: true };
  return { layer: view.visemes.X, speaking: false };
}
