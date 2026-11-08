import type { CharacterView } from "./contract";
import type { EyeBox } from "./eye-rig";

export interface StageFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Framing = "body" | "close";

/** A full-body frame exists only when a torso or a full plate is already in the view. */
export function hasFullBody(view: CharacterView): boolean {
  const head = view.layers.find((layer) => layer.name === "head");
  const lower = view.layers.find((layer) => layer.name === "torso" || layer.name === "body");
  if (!lower) return false;
  if (!head) return lower.w >= view.canvas.w * 0.9 && lower.h >= view.canvas.h * 0.9;
  return lower.y + lower.h > head.y + head.h;
}

export function fullBodyFrame(view: CharacterView): StageFrame {
  return { x: 0, y: 0, w: view.canvas.w, h: view.canvas.h };
}

/**
 * Close crop. A head layer wins. A recovered plate uses the eye pair so the crop
 * stays on the painted head and does not invent a limb.
 */
export function closeFrame(view: CharacterView, eyes?: EyeBox[]): StageFrame {
  const head = view.layers.find((layer) => layer.name === "head");
  if (head) {
    const padX = Math.round(head.w * 0.06);
    const padY = Math.round(head.h * 0.06);
    const x = Math.max(0, head.x - padX);
    const y = Math.max(0, head.y - padY);
    return {
      x,
      y,
      w: Math.min(view.canvas.w - x, head.w + padX * 2),
      h: Math.min(view.canvas.h - y, head.h + padY * 2),
    };
  }
  if (eyes?.length) {
    const minX = Math.min(...eyes.map((box) => box.x));
    const maxX = Math.max(...eyes.map((box) => box.x + box.w));
    const minY = Math.min(...eyes.map((box) => box.y));
    const maxY = Math.max(...eyes.map((box) => box.y + box.h));
    const span = Math.max(1, maxX - minX);
    const cx = (minX + maxX) / 2;
    const eyeY = (minY + maxY) / 2;
    const w = Math.min(view.canvas.w, Math.round(span * 1.7));
    const h = Math.min(view.canvas.h, Math.round(span * 2.5));
    const x = clamp(Math.round(cx - w / 2), 0, view.canvas.w - w);
    const y = clamp(Math.round(eyeY - span * 1.5), 0, view.canvas.h - h);
    return { x, y, w, h };
  }
  return fullBodyFrame(view);
}

export function stageFrame(view: CharacterView, framing: Framing, eyes?: EyeBox[]): StageFrame {
  if (framing === "body" && hasFullBody(view)) return fullBodyFrame(view);
  return closeFrame(view, eyes);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
