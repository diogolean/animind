/** A rest viseme drawn on the chin, below the painted mouth, is not composited. */
export function visemeSitsOnMouth(box: { y: number }, eyes: { y: number; h: number }[], plateOriginY = 0): boolean {
  if (!eyes.length) return true;
  const eyeBottom = Math.max(...eyes.map((eye) => plateOriginY + eye.y + eye.h));
  const eyeH = Math.max(...eyes.map((eye) => eye.h));
  return box.y <= eyeBottom + eyeH * 2;
}
