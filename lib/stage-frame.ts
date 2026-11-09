import type { CharacterView } from "./contract";
import type { EyeBox } from "./eye-rig";

export interface StageFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Framing = "body" | "close";

/**
 * One face stage for every character, card, viewer, and sheet cell.
 * The ratios come from the realistic front head, which already contains hair and chin.
 * A plate that cannot grow past its canvas keeps the same aspect and eye line
 * and does not crop the head to force the fill.
 */
export const FACE_TEMPLATE = { aspect: 4 / 5, eyeLine: 0.58, fill: 0.8 } as const;

const HEAD_FROM_EYES = {
  widthOverSpan: 500 / 182,
  heightOverWidth: 558 / 500,
  eyeX: (439 + 91 - 298) / 500,
  eyeY: (632 + 11 - 334) / 558,
};

/** A standing body is a torso that continues below a head. A bust plate is not one. */
export function hasFullBody(view: CharacterView): boolean {
  const head = view.layers.find((layer) => layer.name === "head");
  const lower = view.layers.find((layer) => layer.name === "torso" || layer.name === "body");
  if (!head || !lower) return false;
  return lower.y + lower.h > head.y + head.h;
}

export function fullBodyFrame(view: CharacterView): StageFrame {
  return { x: 0, y: 0, w: view.canvas.w, h: view.canvas.h };
}

/** Close crop. Every view uses the same face template. Missing eyes do not invent a head. */
export function closeFrame(view: CharacterView, eyes?: EyeBox[]): StageFrame {
  const subject = faceSubject(view, eyes);
  if (!subject) return aspectWindow(view.canvas.w, view.canvas.h);
  return placeFace(view.canvas.w, view.canvas.h, subject);
}

/** Canvas that lets a tight head use the same 4/5 frame and eye line as the realistic plates. */
export function placeHeadOnStage(head: { w: number; h: number }): { canvas: { w: number; h: number }; x: number; y: number } {
  let frameW = head.w / FACE_TEMPLATE.fill;
  let frameH = frameW / FACE_TEMPLATE.aspect;
  const minH = head.h / FACE_TEMPLATE.fill;
  if (frameH < minH) {
    frameH = minH;
    frameW = frameH * FACE_TEMPLATE.aspect;
  }
  const eyeOffset = head.h * HEAD_FROM_EYES.eyeY;
  const y = Math.max(0, Math.ceil(frameH * FACE_TEMPLATE.eyeLine - eyeOffset));
  return {
    canvas: {
      w: Math.ceil(Math.max(frameW, head.w)),
      h: Math.ceil(Math.max(frameH, y + head.h)),
    },
    x: Math.max(0, Math.round((Math.ceil(Math.max(frameW, head.w)) - head.w) / 2)),
    y,
  };
}

export function stageFrame(view: CharacterView, framing: Framing, eyes?: EyeBox[]): StageFrame {
  if (framing === "body" && hasFullBody(view)) return fullBodyFrame(view);
  return closeFrame(view, eyes);
}

interface FaceSubject {
  x: number;
  y: number;
  w: number;
  h: number;
  eyeX: number;
  eyeY: number;
}

function faceSubject(view: CharacterView, eyes?: EyeBox[]): FaceSubject | null {
  const head = view.layers.find((layer) => layer.name === "head");
  if (head) {
    const eye = eyeAnchor(view, eyes, head);
    return { x: head.x, y: head.y, w: head.w, h: head.h, eyeX: eye.x, eyeY: eye.y };
  }
  if (!eyes?.length) return null;
  const minX = Math.min(...eyes.map((box) => box.x));
  const maxX = Math.max(...eyes.map((box) => box.x + box.w));
  const minY = Math.min(...eyes.map((box) => box.y));
  const maxY = Math.max(...eyes.map((box) => box.y + box.h));
  const span = Math.max(1, maxX - minX);
  const eyeX = (minX + maxX) / 2;
  const eyeY = (minY + maxY) / 2;
  const w = span * HEAD_FROM_EYES.widthOverSpan;
  const h = w * HEAD_FROM_EYES.heightOverWidth;
  return {
    x: eyeX - w * HEAD_FROM_EYES.eyeX,
    y: eyeY - h * HEAD_FROM_EYES.eyeY,
    w,
    h,
    eyeX,
    eyeY,
  };
}

function eyeAnchor(view: CharacterView, eyes: EyeBox[] | undefined, head: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  if (eyes?.length) {
    const minX = Math.min(...eyes.map((box) => box.x));
    const maxX = Math.max(...eyes.map((box) => box.x + box.w));
    const minY = Math.min(...eyes.map((box) => box.y));
    const maxY = Math.max(...eyes.map((box) => box.y + box.h));
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }
  const layer = view.layers.find((item) => item.name === "eyes" || item.name === "eye_white");
  if (layer) return { x: layer.x + layer.w / 2, y: layer.y + layer.h / 2 };
  return { x: head.x + head.w * 0.5, y: head.y + head.h * HEAD_FROM_EYES.eyeY };
}

function placeFace(canvasW: number, canvasH: number, subject: FaceSubject): StageFrame {
  let frameW = subject.w / FACE_TEMPLATE.fill;
  let frameH = frameW / FACE_TEMPLATE.aspect;
  const minH = subject.h / FACE_TEMPLATE.fill;
  if (frameH < minH) {
    frameH = minH;
    frameW = frameH * FACE_TEMPLATE.aspect;
  }
  if (frameW > canvasW || frameH > canvasH) {
    const fit = Math.min(canvasW / frameW, canvasH / frameH);
    frameW *= fit;
    frameH *= fit;
  }
  let x = subject.x + subject.w / 2 - frameW / 2;
  let y = subject.eyeY - frameH * FACE_TEMPLATE.eyeLine;
  if (y > subject.y) y = subject.y;
  if (y + frameH < subject.y + subject.h) y = subject.y + subject.h - frameH;
  if (x > subject.x) x = subject.x;
  if (x + frameW < subject.x + subject.w) x = subject.x + subject.w - frameW;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + frameW > canvasW) x = Math.max(0, canvasW - frameW);
  if (y + frameH > canvasH) y = Math.max(0, canvasH - frameH);
  const left = Math.max(0, Math.floor(Math.min(x, subject.x)));
  const top = Math.max(0, Math.floor(Math.min(y, subject.y)));
  const right = Math.min(canvasW, Math.ceil(Math.max(x + frameW, subject.x + subject.w)));
  const bottom = Math.min(canvasH, Math.ceil(Math.max(y + frameH, subject.y + subject.h)));
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

function aspectWindow(canvasW: number, canvasH: number): StageFrame {
  let w = canvasW;
  let h = w / FACE_TEMPLATE.aspect;
  if (h > canvasH) {
    h = canvasH;
    w = h * FACE_TEMPLATE.aspect;
  }
  const x = Math.max(0, Math.round((canvasW - w) / 2));
  const y = Math.max(0, Math.round((canvasH - h) / 2));
  return { x, y, w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}
