"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/locale";
import type { Viseme } from "@/lib/contract";
import { envelopeFromChannel, envelopeVisemes } from "@/lib/pack-voice";

/** Plays audio the pack already has and reports the viseme. It does not render a video. */
export function PackVoice({
  urls,
  mouths,
  onViseme,
}: {
  urls: string[];
  mouths: boolean;
  onViseme: (viseme: Viseme | null) => void;
}) {
  const { t } = useI18n();
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState<Viseme>("X");
  const stopRef = useRef<(() => void) | null>(null);
  const onVisemeRef = useRef(onViseme);
  useEffect(() => {
    onVisemeRef.current = onViseme;
  });
  useEffect(() => {
    return () => {
      stopRef.current?.();
      stopRef.current = null;
      onVisemeRef.current(null);
    };
  }, []);

  function stop() {
    stopRef.current?.();
    stopRef.current = null;
    setPlaying(false);
    setShown("X");
    onViseme(null);
  }

  async function play() {
    stopRef.current?.();
    setFailed(false);
    setPlaying(true);
    let context: AudioContext | null = null;
    let frame = 0;
    let source: AudioBufferSourceNode | null = null;
    const halt = () => {
      if (frame) cancelAnimationFrame(frame);
      source?.stop();
      void context?.close();
      context = null;
      source = null;
    };
    stopRef.current = halt;
    try {
      let buffer: AudioBuffer | null = null;
      for (const url of urls) {
        const response = await fetch(url);
        if (!response.ok) continue;
        const bytes = await response.arrayBuffer();
        context = new AudioContext();
        try {
          buffer = await context.decodeAudioData(bytes.slice(0));
          break;
        } catch {
          await context.close();
          context = null;
        }
      }
      if (!buffer || !context) {
        setFailed(true);
        setPlaying(false);
        setShown("X");
        onViseme(null);
        return;
      }
      const visemes = envelopeVisemes(envelopeFromChannel(buffer.getChannelData(0), buffer.sampleRate));
      await context.resume();
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const origin = context.currentTime;
      const wall = performance.now();
      source.start();
      source.onended = () => {
        if (stopRef.current !== halt) return;
        halt();
        stopRef.current = null;
        setPlaying(false);
        setShown("X");
        onViseme(null);
      };
      const tick = () => {
        const heard = context ? context.currentTime - origin : 0;
        const elapsed = heard > 0.02 ? heard : (performance.now() - wall) / 1000;
        const index = Math.min(visemes.length - 1, Math.max(0, Math.floor(elapsed * 100)));
        const next = visemes[index] ?? "X";
        setShown(next);
        onViseme(next === "X" ? null : next);
        if (elapsed < buffer.duration) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    } catch {
      halt();
      stopRef.current = null;
      setFailed(true);
      setPlaying(false);
      setShown("X");
      onViseme(null);
    }
  }

  if (!urls.length) return <p data-testid="pack-voice-missing" className="mt-3 max-w-md text-sm leading-relaxed text-white/80">{t("packVoiceMissing")}</p>;
  if (!mouths) return <p data-testid="pack-mouth-missing" className="mt-3 max-w-md text-sm leading-relaxed text-white/80">{t("packMouthMissing")}</p>;

  return (
    <div data-testid="pack-voice" className="mt-3 max-w-md">
      <button
        type="button"
        data-testid="pack-voice-play"
        className="inline-flex min-h-11 items-center rounded-full border border-white/45 px-4 text-sm text-white"
        onClick={() => { if (playing) stop(); else void play(); }}
      >
        {playing ? t("packVoiceStop") : t("packVoicePlay")}
      </button>
      <p data-testid="pack-viseme" className="sr-only">{shown}</p>
      <p className="mt-2 text-sm leading-relaxed text-white/80">{t("packVoiceNote")}</p>
      {failed ? <p data-testid="pack-voice-failed" className="mt-2 text-sm text-white/80">{t("packVoiceFailed")}</p> : null}
    </div>
  );
}
