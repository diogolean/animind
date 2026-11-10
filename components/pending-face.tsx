/** The same 4/5 face box used when a view or a state has no art yet. */
export function PendingFace({ label, testId }: { label: string; testId?: string }) {
  return (
    <div
      data-testid={testId ?? "pending-face"}
      data-template="face"
      data-state="pending"
      data-ground="black"
      className="flex aspect-[4/5] w-full items-center justify-center bg-black"
    >
      <span className="px-3 text-center text-sm text-white/70">{label}</span>
    </div>
  );
}
