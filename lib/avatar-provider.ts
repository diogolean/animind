/**
 * The factory copy under products/aiwake/animator/factory exposes
 * generate_character_image, create_puppet, and generate_view.
 * It does not expose generate_avatar. This app does not call the others.
 * Paid avatar calls are not authorized.
 */
export const AVATAR_PAID_CALLS_AUTHORIZED = false;

export function avatarProviderSupport(): { available: false; functionName: null; lookedFor: "generate_avatar" } {
  return { available: false, functionName: null, lookedFor: "generate_avatar" };
}
