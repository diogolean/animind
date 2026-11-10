/** Classes on the real view, gaze, framing, and scenery buttons. */
export function controlClass(pressed: boolean): string {
  const motion = "transition duration-200 ease-out motion-reduce:transition-none motion-reduce:active:scale-100";
  const focus = "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
  const press = "active:scale-95 active:bg-white/20";
  const hover = pressed ? "" : "[@media(hover:hover)]:hover:border-white/70 [@media(hover:hover)]:hover:bg-white/10";
  const tone = pressed ? "border-white bg-white text-black" : "border-white/15 bg-transparent text-white";
  return `inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${motion} ${focus} ${press} ${hover} ${tone}`;
}
