/** Fields copied from a core response. A missing cost stays null and is never stored as zero. */

const MODEL = /^[A-Za-z0-9._:-]{1,80}$/;
const PROVIDER = /^[A-Za-z0-9._:-]{1,40}$/;

export function readToken(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Explicit integer cents, including 0 when the core sends 0. Anything else, including a missing field, stays null. */
export function readReportedMinor(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function readModel(value: unknown): string | null {
  return typeof value === "string" && MODEL.test(value) ? value : null;
}

export function readProvider(value: unknown): string | null {
  return typeof value === "string" && PROVIDER.test(value) ? value : null;
}
