/**
 * Base-image lookup for Apex cards, keyed by card id (matches CARD_MAP keys in
 * data/cards.ts). Cards with no entry here fall back to the existing generated
 * faction-colored layout in Card.tsx - art is opt-in per card, never required.
 *
 * To add art for a card: drop the image in /public/art/apex/ and add an entry here.
 * Recommended source resolution: at least 600x840 (portrait, ~5:7 ratio) so it holds
 * up at the largest render size (the 'lg' inspect/gallery view).
 */
export const CARD_ART: Record<string, string> = {
  'nu-street-beast': '/art/apex/nu-street-beast.png',
  'nu-static-jack': '/art/apex/nu-static-jack.png',
  'nu-alley-wraith': '/art/apex/nu-alley-wraith.png',
  'nu-riot-runner': '/art/apex/nu-riot-runner.png',
  'dw-overseer-prime': '/art/apex/dw-overseer-prime.png',
  'dw-enforcer-v4': '/art/apex/dw-enforcer-v4.png',
  'dw-glass-warden': '/art/apex/dw-glass-warden.png',
  'dw-pale-executioner': '/art/apex/dw-pale-executioner.png',
  'sa-model-00-crown': '/art/apex/sa-model-00-crown.png',
  'sa-chrome-seraph': '/art/apex/sa-chrome-seraph.png',
  'sa-virex': '/art/apex/sa-virex.png',
  'sa-halcyon-maw': '/art/apex/sa-halcyon-maw.png',
};

export function getCardArt(defId: string): string | undefined {
  return CARD_ART[defId];
}
