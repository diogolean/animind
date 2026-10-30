"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Play, RotateCcw } from "lucide-react";
import { motion } from "framer-motion";
import type { RenderResult } from "@/lib/contract";
import { drawFrame, H, loadImages, pickMime, synthTrack, trackFromUrl, W, type Images, type Track } from "@/lib/engine";
import { Button } from "@/components/ui/button";

export function Player({ result, audioCtx, fileName }: { result: RenderResult; audioCtx: AudioContext; fileName: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
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
          setState("ready");
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
        else setState("ready");
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
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_30px_80px_-30px] shadow-violet-500/40">
        <canvas data-testid="preview-canvas" ref={canvas} width={W} height={H} className="block aspect-video w-full" />
        {state === "loading" && (
          <div className="absolute inset-0 grid place-items-center bg-black/60 text-sm text-white/80">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
          <div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => run(false)} disabled={state === "loading" || state === "recording" || state === "playing"}>
          {state === "ready" ? <RotateCcw /> : <Play />} Assistir de novo
        </Button>
        {video ? (
          <a
            data-testid="download"
            href={video.url}
            download={`${fileName}.${video.ext}`}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-violet-500/30 transition hover:brightness-110"
          >
            <Download className="size-4" /> Baixar vídeo
          </a>
        ) : (
          <Button disabled data-testid="download-pending">
            <Loader2 className="animate-spin" /> {state === "recording" ? `Renderizando ${Math.round(progress * 100)}%` : "Preparando"}
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">Renderizado no seu navegador · aviso de paródia gravado no vídeo</span>
      </div>
    </motion.div>
  );
}
