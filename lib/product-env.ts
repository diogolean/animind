/**
 * Product-branded environment variables.
 *
 * Canonical names are ANIMINDLY_*. ANIMIND_* is still read when the new name
 * is unset or blank, so a Vercel project can be renamed after this deploy.
 * A blank value is the same as unset.
 */
export function productEnv(suffix: string): string | undefined {
  const next = present(`ANIMINDLY_${suffix}`);
  if (next !== undefined) return next;
  return present(`ANIMIND_${suffix}`);
}

function present(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return undefined;
  return value;
}
