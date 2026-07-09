/**
 * Base-image lookup, keyed by card id (matches CARD_MAP keys in data/cards.ts).
 * Cards with no entry here fall back to the existing generated faction-colored
 * layout in Card.tsx - art is opt-in per card, never required. Covers every card
 * type now (Apex, Engine, Equip, Special, React) - Apex cards get the full dynamic
 * DEF/attack overlay (ApexCardRenderer); everything else just shows its art with no
 * overlay, since only Apex stats change live (Engine chain/lock status is the one
 * exception - handled separately as a small badge, not a full overlay template).
 *
 * Two image sets, two aspect ratios - both intentional, not a mistake to reconcile:
 * Apex art is 600x900 (2:3), the rest is 1500x2100 (5:7). ART_ASPECT_RATIO below
 * picks the right one per card so containers always match their actual art with
 * zero crop, the same fix Commit 19.1 applied to Apex specifically.
 */
export const CARD_ART: Record<string, string> = {
  // Apex
  'nu-street-beast': '/art/apex/nu-street-beast.webp',
  'nu-static-jack': '/art/apex/nu-static-jack.webp',
  'nu-alley-wraith': '/art/apex/nu-alley-wraith.webp',
  'nu-riot-runner': '/art/apex/nu-riot-runner.webp',
  'dw-overseer-prime': '/art/apex/dw-overseer-prime.webp',
  'dw-enforcer-v4': '/art/apex/dw-enforcer-v4.webp',
  'dw-glass-warden': '/art/apex/dw-glass-warden.webp',
  'dw-pale-executioner': '/art/apex/dw-pale-executioner.webp',
  'sa-model-00-crown': '/art/apex/sa-model-00-crown.webp',
  'sa-chrome-seraph': '/art/apex/sa-chrome-seraph.webp',
  'sa-virex': '/art/apex/sa-virex.webp',
  'sa-halcyon-maw': '/art/apex/sa-halcyon-maw.webp',

  // Neon Underground - Engine / Equip / Special / React
  'nu-juice-box': '/art/cards/nu-juice-box.webp',
  'nu-spark-plug': '/art/cards/nu-spark-plug.webp',
  'nu-dead-battery': '/art/cards/nu-dead-battery.webp',
  'nu-black-market-cell': '/art/cards/nu-black-market-cell.webp',
  'nu-plasma-edge': '/art/cards/nu-plasma-edge.webp',
  'nu-smog-jacket': '/art/cards/nu-smog-jacket.webp',
  'nu-overclock': '/art/cards/nu-overclock.webp',
  'nu-data-thief': '/art/cards/nu-data-thief.webp',
  'nu-no-gods': '/art/cards/nu-no-gods.webp',
  'nu-glitch-step': '/art/cards/nu-glitch-step.webp',
  'nu-feedback-loop': '/art/cards/nu-feedback-loop.webp',

  // Dark White
  'dw-oxygen-siphon': '/art/cards/dw-oxygen-siphon.webp',
  'dw-gatekeeper-drone': '/art/cards/dw-gatekeeper-drone.webp',
  'dw-blank-directive': '/art/cards/dw-blank-directive.webp',
  'dw-reserve-grid': '/art/cards/dw-reserve-grid.webp',
  'dw-monomolecular-blade': '/art/cards/dw-monomolecular-blade.webp',
  'dw-sterile-mantle': '/art/cards/dw-sterile-mantle.webp',
  'dw-system-scan': '/art/cards/dw-system-scan.webp',
  'dw-choke-protocol': '/art/cards/dw-choke-protocol.webp',
  'dw-verdict-protocol': '/art/cards/dw-verdict-protocol.webp',
  'dw-emergency-authority': '/art/cards/dw-emergency-authority.webp',
  'dw-absolute-refusal': '/art/cards/dw-absolute-refusal.webp',

  // Synth Ascendancy
  'sa-logic-bloom': '/art/cards/sa-logic-bloom.webp',
  'sa-drone-choir': '/art/cards/sa-drone-choir.webp',
  'sa-blank-core': '/art/cards/sa-blank-core.webp',
  'sa-emergency-shell': '/art/cards/sa-emergency-shell.webp',
  'sa-chrome-halo': '/art/cards/sa-chrome-halo.webp',
  'sa-pattern-blade': '/art/cards/sa-pattern-blade.webp',
  'sa-compile-sequence': '/art/cards/sa-compile-sequence.webp',
  'sa-upgrade-path': '/art/cards/sa-upgrade-path.webp',
  'sa-ascension-complete': '/art/cards/sa-ascension-complete.webp',
  'sa-backup-consciousness': '/art/cards/sa-backup-consciousness.webp',
  'sa-logic-denial': '/art/cards/sa-logic-denial.webp',
};

/** Apex art is 600x900 (2:3); every other card type's art is 1500x2100 (5:7).
 *  Both are real, intentional source sizes - this just tells the renderer which
 *  ratio to use so containers always match the actual art with zero crop. */
export function getArtAspectRatio(cardType: string): number {
  if (cardType === 'Apex') return 600 / 900;
  return 1500 / 2100;
}

/** How much of an Equip card's own art (from the bottom) is shown as the compact
 *  "attached flap" under its equipped Apex on the board - the equip art was
 *  designed with this bottom strip as its own visual tab (see the physical card
 *  reference), so this crops straight into that existing design rather than
 *  needing separate flap-only art. Tunable in one place if it needs nudging once
 *  seen rendered for real. */
export const EQUIP_FLAP_CROP_RATIO = 0.16;

export function getCardArt(defId: string): string | undefined {
  return CARD_ART[defId];
}
