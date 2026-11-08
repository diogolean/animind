"use client";

/* eslint-disable @next/next/no-img-element */
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/components/locale";
import type { CharacterPreview } from "@/lib/contract";
import { fill } from "@/lib/i18n";

function StickFigure({ preview }: { preview: CharacterPreview }) {
  const { t } = useI18n();
  return (
    <svg viewBox="0 0 160 220" className="h-52 w-40 overflow-visible" aria-label={fill(t("previewOf"), { name: preview.name })}>
      <defs>
        <filter id={`glow-${preview.id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <ellipse cx="80" cy="207" rx="52" ry="8" fill="black" opacity=".28" />
      <circle cx="80" cy="65" r="40" fill={preview.accent} opacity=".16" filter={`url(#glow-${preview.id})`} />
      <g fill="none" stroke={preview.accent} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="80" cy="62" r="34" strokeWidth="6" fill="#101114" />
        <path d="M80 97v56M80 116l-37 31M80 116l37 31M80 152l-28 49M80 152l28 49" strokeWidth="7" />
        <g className="animind-stick-eyes" strokeWidth="4">
          <path d="M65 56h3M92 56h3" />
        </g>
        <path className="animind-stick-mouth" d="M68 74q12 8 24 0" strokeWidth="4" />
        <ellipse className="animind-stick-mouth-open" cx="80" cy="77" rx="9" ry="7" strokeWidth="3" fill={preview.accent} fillOpacity=".18" />
      </g>
    </svg>
  );
}

function Cutout({ preview }: { preview: CharacterPreview }) {
  const { t } = useI18n();
  const view = preview.cutout;
  if (!view || view.layers.length === 0) {
    if (!preview.imageUrl) return null;
    return <img data-testid="stream-cutout" src={preview.imageUrl} alt={preview.name} className="h-52 w-40 object-contain" />;
  }
  const { w, h } = view.canvas;
  const mouth = view.visemes.X;
  const parts = [...view.layers, ...(mouth ? [mouth] : [])].sort((a, b) => a.z - b.z);
  return (
    <div data-testid="stream-cutout" className="relative h-52" style={{ aspectRatio: `${w} / ${h}` }} aria-label={fill(t("cutoutOf"), { name: preview.name })}>
      {parts.map((layer) => (
        <img
          key={`${layer.name}-${layer.url}`}
          src={layer.url}
          alt=""
          className="absolute max-w-none"
          style={{
            left: `${(layer.x / w) * 100}%`,
            top: `${(layer.y / h) * 100}%`,
            width: `${(layer.w / w) * 100}%`,
            height: `${(layer.h / h) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

function CorePreview({ preview }: { preview: CharacterPreview }) {
  if (preview.source === "core") {
    const cutout = <Cutout preview={preview} />;
    if (cutout) return cutout;
  }
  if (preview.source === "loading" || preview.source === "local") return <StickFigure preview={preview} />;
  const idle = preview.frames?.idle ?? preview.imageUrl;
  if (!idle) return <StickFigure preview={preview} />;
  return (
    <div className="relative h-52 w-40">
      <img src={idle} alt={preview.name} className="size-full object-contain" />
      {preview.frames?.blink ? <img src={preview.frames.blink} alt="" className="animind-preview-blink absolute inset-0 size-full object-contain" /> : null}
      {preview.frames?.mouthOpen ? <img src={preview.frames.mouthOpen} alt="" className="animind-preview-mouth absolute inset-0 size-full object-contain" /> : null}
    </div>
  );
}

function sourceLabel(preview: CharacterPreview, t: (key: "sourceGenerating" | "sourceLocal" | "sourceCutout") => string) {
  if (preview.source === "loading") return t("sourceGenerating");
  if (preview.source === "local") return t("sourceLocal");
  return t("sourceCutout");
}

export function ProgressivePreview({
  previews,
  scenario,
  status,
}: {
  previews: CharacterPreview[];
  scenario: string | null;
  status: string;
}) {
  const { t } = useI18n();
  return (
    <motion.section
      data-testid="preview-stream"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-7 overflow-hidden rounded-[2rem] border border-white/8 bg-[#0d0e11]"
    >
      <div className="relative min-h-80 overflow-hidden px-6 pt-8">
        <motion.div
          data-testid="stream-scenario"
          data-ready={scenario ? "true" : "false"}
          initial={false}
          animate={{ opacity: scenario ? 1 : 0.18, scale: scenario ? 1 : 1.04 }}
          className="absolute inset-0"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(62,104,190,.3),transparent_53%)]" />
          <div className="absolute inset-x-[8%] bottom-0 h-32 rounded-t-[50%] border-t border-white/10 bg-white/[0.025]" />
          <div className="absolute top-6 left-1/2 h-32 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/10 to-transparent" />
        </motion.div>

        <div className="relative flex min-h-60 items-end justify-center gap-3 sm:gap-10">
          {previews.map((preview) => (
            <motion.div
              key={`${preview.index}-${preview.source}`}
              data-testid={`stream-character-${preview.index}`}
              data-source={preview.source}
              initial={{ opacity: 0, y: 26, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 170, damping: 18 }}
              className="flex max-w-44 flex-col items-center"
            >
              <CorePreview preview={preview} />
              <span className="mt-1 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs font-medium backdrop-blur">
                {preview.name}
              </span>
              <span data-testid={`stream-badge-${preview.index}`} className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {sourceLabel(preview, t)}
              </span>
              {preview.note ? <span className="mt-1 line-clamp-2 max-w-40 text-center text-[10px] text-amber-500/90">{preview.note}</span> : null}
            </motion.div>
          ))}
        </div>
      </div>
      <div className="relative flex items-center justify-between gap-3 border-t border-white/8 px-5 py-3 text-xs text-muted-foreground">
        <span data-testid="job-status" className="flex min-w-0 items-center gap-2"><Loader2 className="size-3.5 shrink-0 animate-spin" /><span className="truncate">{status || t("statusPreparing")}</span></span>
        {scenario ? <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="shrink-0 text-foreground/70">{scenario}</motion.span> : null}
      </div>
    </motion.section>
  );
}
