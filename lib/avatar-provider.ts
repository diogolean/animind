/**
 * The factory exposes generate_character_image, create_puppet, and generate_view.
 * It does not expose generate_avatar. The core draft's HTTP facade records a
 * job without spending. This app proxies that facade and does not call the
 * factory functions. Paid avatar calls are not authorized.
 */
export const AVATAR_PAID_CALLS_AUTHORIZED = false;

export function avatarProviderSupport(): { available: false; functionName: null; lookedFor: "generate_avatar" } {
  return { available: false, functionName: null, lookedFor: "generate_avatar" };
}
