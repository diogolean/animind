"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Film, Loader2, Play, RotateCcw } from "lucide-react";
import { motion } from "framer-motion";
import type { RenderResult } from "@/lib/contract";
import { drawFrame, H, loadImages, pickMime, synthTrack, trackFromUrl, VH, VW, W, type Images, type Track } from "@/lib/engine";
import { Button } from "@/components/ui/button";

/** A still that is never the fade-to-black tail: the middle of the last spoken line. */
export function posterMs(r: RenderResult) {
  const last = r.script[r.script.length - 1];
  return last ? (last.startMs + last.endMs) / 2 : r.durationMs / 2;
}

export function Player({ result, audioCtx, fileName }: { result: RenderResult; audioCtx: AudioContext; fileName: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const vertical = result.format === "9:16";
  const [state, setState] = useState<"loading" | "recording" | "ready" | "playing">("loading");
  const [progress, setProgress] = useState(0);
  const [video, setVideo] = useState<{ url: string; ext: string } | null>(null);
  const assets = useRef<{ img: Images; track: Track } | null>(null);
  const raf = useRef(0);

  const run = useCallback(
    (record: boolean) => {
      const a = assets.current;
      const cv = canvas.current;
      if (!a || !cv) return;
      const g = cv.getContext("2d")!;
      cancelAnimationFrame(raf.current);
      const src = audioCtx.createBufferSource();
      src.buffer = a.track.buffer;
      src.connect(audioCtx.destination);
      // The take ends on a fade to black; once it is over, leave a real frame on screen.
      const poster = () => {
        drawFrame(g, result, a.img, a.track, posterMs(result));
        setState("ready");
      };
      let rec: MediaRecorder | null = null;
      const chunks: Blob[] = [];
      if (record && typeof MediaRecorder !== "undefined" && "captureStream" in cv) {
        const dest = audioCtx.createMediaStreamDestination();
        src.connect(dest);
        const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
        const mime = pickMime();
        rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: mime.split(";")[0] });
          setVideo({ url: URL.createObjectURL(blob), ext: mime.includes("mp4") ? "mp4" : "webm" });
          poster();
        };
        rec.start(250);
      }
      setState(record ? "recording" : "playing");
      const t0 = audioCtx.currentTime + 0.05;
      src.start(t0);
      const loop = () => {
        const ms = Math.max(0, (audioCtx.currentTime - t0) * 1000);
        drawFrame(g, result, a.img, a.track, ms);
        setProgress(Math.min(1, ms / result.durationMs));
        if (ms < result.durationMs) raf.current = requestAnimationFrame(loop);
        else if (rec) rec.stop();
        else poster();
      };
      loop();
    },
    [audioCtx, result],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const img = await loadImages(result.characters);
      const track = result.audioUrl ? await trackFromUrl(audioCtx, result.audioUrl, result) : synthTrack(audioCtx, result);
      if (!alive) return;
      assets.current = { img, track };
      drawFrame(canvas.current!.getContext("2d")!, result, img, track, 0);
      await audioCtx.resume().catch(() => {});
      run(true);
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf.current);
    };
  }, [result, audioCtx, run]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <canvas
          data-testid="preview-canvas"
          ref={canvas}
          width={vertical ? VW : W}
          height={vertical ? VH : H}
          className={vertical ? "mx-auto block aspect-[9/16] w-full max-w-xs" : "block aspect-video w-full"}
        />
        {state === "loading" && (
          <div className="absolute inset-0 grid place-items-center bg-black/60 text-sm text-white/80">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
          <div className="h-full bg-[var(--accent-brand)] transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button variant="ghost" size="sm" className="rounded-full" onClick={() => run(false)} disabled={state === "loading" || state === "recording" || state === "playing"}>
          {state === "ready" ? <RotateCcw /> : <Play />} Repetir
        </Button>
        {video ? (
          <a
            data-testid="download"
            href={video.url}
            download={`${fileName}.${video.ext}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            <Download className="size-3.5" /> Baixar
          </a>
        ) : (
          <span data-testid="download-pending" className="inline-flex h-8 items-center gap-1.5 px-4 text-sm text-muted-foreground tabular-nums">
            <Loader2 className="size-3.5 animate-spin" /> {state === "recording" ? `${Math.round(progress * 100)}%` : "Preparando"}
          </span>
        )}
        {result.videoUrl && (
          <a
            data-testid="download-core"
            href={result.videoUrl}
            download={`${fileName}-hd.mp4`}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Film className="size-3.5" /> MP4 do núcleo
          </a>
        )}
      </div>
    </motion.div>
  );
}
