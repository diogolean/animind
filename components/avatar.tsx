/* eslint-disable @next/next/no-img-element */
import type { Character } from "@/lib/contract";
import { cn } from "cn";

/** Open-eyes still, same rule as the core's scene: blink lids never show, the socket is only a
 *  clip mask, and with movable eyes (white + iris + socket) the baked "eyes" layer is replaced. */
function hiddenEyeLayers(layers: { name: string }[]): Set<string> {
  const names = new Set(layers.map((l) => l.name));
  const hidden = new Set(["eyes_closed", "eyes_half", "eye_socket"]);
  if (names.has("eye_white") && names.has("iris") && names.has("eye_socket")) hidden.add("eyes");
  return hidden;
}

/** Neutral stand-in until the core delivers the rig: a silhouette over a soft skeleton shimmer. */
export function Avatar({ character, loading, className }: { character?: Character | null; loading?: boolean; className?: string }) {
  const front = character?.views.front;
  const ready = character && character.status === "ready";
  return (
    <div className={cn("relative aspect-[4/5] overflow-hidden rounded-2xl bg-muted", (loading || !ready) && "skeleton", className)}>
      {character?.photo ? (
        <img src={character.photo.url} alt={character.name} className="size-full object-cover" />
      ) : ready && front && front.layers.length ? (
        <div className="relative size-full">
          {[...front.layers, ...(front.visemes.X ? [front.visemes.X] : [])]
            .filter((l) => !hiddenEyeLayers(front.layers).has(l.name))
            .sort((a, b) => a.z - b.z)
            .map((l, i) => (
              <img
                key={i}
                src={l.url}
                alt=""
                className="absolute"
                style={{ left: `${(l.x / front.canvas.w) * 100}%`, top: `${(l.y / front.canvas.h) * 100}%`, width: `${(l.w / front.canvas.w) * 100}%`, height: `${(l.h / front.canvas.h) * 100}%` }}
              />
            ))}
        </div>
      ) : (
        <svg viewBox="0 0 100 125" className="absolute inset-0 size-full text-foreground/10" aria-hidden>
          <circle cx="50" cy="52" r="21" fill="currentColor" />
          <path d="M14 125c0-26 16-41 36-41s36 15 36 41z" fill="currentColor" />
        </svg>
      )}
    </div>
  );
}
