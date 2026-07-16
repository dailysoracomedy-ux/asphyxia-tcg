/**
 * Commit 42 - the cosmetics registry: playmats, card sleeves, deck boxes and
 * flip coins. Pure data, no React - every skin is either a CSS recipe
 * (playmats, deck boxes) or an image + CSS filter recipe (sleeves, coins), so
 * the whole system ships with zero new image assets: sleeves and coins reuse
 * the existing card-back / coin art re-tinted per skin, and playmats are
 * layered CSS gradients tuned to read as printed neoprene mats under the
 * board's existing perspective tilt.
 *
 * Everything is keyed by stable string ids (stored in localStorage via
 * cosmeticsStore), so adding a new skin later is append-only: new entry here,
 * nothing else changes anywhere.
 */

export type CosmeticKind = 'playmat' | 'sleeve' | 'deckbox' | 'coin';

export interface PlaymatSkin {
  id: string;
  name: string;
  blurb: string;
  /** CSS background stack for the mat surface. `null` = "faction default":
   *  keep the board's original per-faction radial gradient. */
  background: string | null;
  /** Accent used for the mat's stitched border line; null = faction border. */
  edge: string | null;
}

export interface SleeveSkin {
  id: string;
  name: string;
  blurb: string;
  /** CSS filter applied over the base card-back art. */
  filter: string;
  /** Sleeve rim color - the thin plastic edge you see around a sleeved card. */
  rim: string;
}

export interface DeckBoxSkin {
  id: string;
  name: string;
  blurb: string;
  /** `null` = classic bare stack (no box) - the original look. */
  body: string | null;
  edge: string;
  /** Emblem tint applied to the coin-front art used as the box's badge. */
  emblemFilter: string;
}

export interface CoinSkin {
  id: string;
  name: string;
  blurb: string;
  /** CSS filter baked into the coin textures (canvas-side, so it also works
   *  inside WebGL where CSS filters can't reach). */
  filter: string;
}

export const COIN_FRONT_SRC = '/images/coin-front.png';
export const COIN_BACK_SRC = '/images/coin-back.png';
export const SLEEVE_BASE_SRC = '/art/card-back.webp';

/* ------------------------------------------------------------------ */
/* Playmats                                                            */
/* ------------------------------------------------------------------ */

/** Shared fine-grid layer - reads as the printed alignment grid on a real mat. */
const MAT_GRID =
  'repeating-linear-gradient(0deg, rgba(255,255,255,0.030) 0 1px, transparent 1px 26px), ' +
  'repeating-linear-gradient(90deg, rgba(255,255,255,0.030) 0 1px, transparent 1px 26px)';

export const PLAYMATS: PlaymatSkin[] = [
  {
    id: 'faction',
    name: 'Faction Standard',
    blurb: 'The stock mat. Your deck’s own colors, nothing else.',
    background: null,
    edge: null,
  },
  {
    id: 'street-static',
    name: 'Street Static',
    blurb: 'Neon Underground back-alley signal wash.',
    background:
      `${MAT_GRID}, ` +
      'radial-gradient(ellipse 90% 70% at 20% 100%, rgba(255,47,208,0.16), transparent 60%), ' +
      'radial-gradient(ellipse 90% 70% at 80% 100%, rgba(57,255,106,0.12), transparent 60%), ' +
      'linear-gradient(165deg, #17041a 0%, #05050a 55%, #041007 100%)',
    edge: '#ff2fd0',
  },
  {
    id: 'acid-rain',
    name: 'Acid Rain',
    blurb: 'Toxic runoff streaking down corrugated steel.',
    background:
      'repeating-linear-gradient(115deg, rgba(57,255,106,0.05) 0 2px, transparent 2px 18px), ' +
      `${MAT_GRID}, ` +
      'radial-gradient(ellipse 120% 80% at 50% 110%, rgba(57,255,106,0.15), transparent 65%), ' +
      'linear-gradient(180deg, #060b06 0%, #04120a 100%)',
    edge: '#39ff6a',
  },
  {
    id: 'chrome-grid',
    name: 'Chrome Grid',
    blurb: 'Dark White clean-room floor. Sterile. Watched.',
    background:
      'repeating-linear-gradient(0deg, rgba(32,224,255,0.05) 0 1px, transparent 1px 34px), ' +
      'repeating-linear-gradient(90deg, rgba(32,224,255,0.05) 0 1px, transparent 1px 34px), ' +
      'radial-gradient(ellipse 100% 75% at 50% 100%, rgba(32,224,255,0.12), transparent 60%), ' +
      'linear-gradient(180deg, #060a0d 0%, #02141a 100%)',
    edge: '#20e0ff',
  },
  {
    id: 'ascendant-circuit',
    name: 'Ascendant Circuit',
    blurb: 'Synth Ascendancy boardroom silicon, still warm.',
    background:
      'radial-gradient(circle at 18% 30%, rgba(162,91,255,0.10) 0 2px, transparent 3px), ' +
      'radial-gradient(circle at 72% 62%, rgba(255,145,48,0.10) 0 2px, transparent 3px), ' +
      `${MAT_GRID}, ` +
      'radial-gradient(ellipse 100% 80% at 50% 110%, rgba(162,91,255,0.16), transparent 62%), ' +
      'linear-gradient(160deg, #120421 0%, #05050a 60%, #170b00 100%)',
    edge: '#a25bff',
  },
  {
    id: 'blood-signal',
    name: 'Blood Signal',
    blurb: 'Emergency broadcast red. Somebody’s O2 is about to hit zero.',
    background:
      `${MAT_GRID}, ` +
      'radial-gradient(ellipse 110% 75% at 50% 105%, rgba(248,60,60,0.16), transparent 62%), ' +
      'linear-gradient(180deg, #0d0406 0%, #14060a 100%)',
    edge: '#f83c3c',
  },
  {
    id: 'blackout',
    name: 'Blackout',
    blurb: 'Matte void. Let the cards do the talking.',
    background: `${MAT_GRID}, linear-gradient(180deg, #060608 0%, #030304 100%)`,
    edge: '#3a3a46',
  },
];

/* ------------------------------------------------------------------ */
/* Sleeves                                                             */
/* ------------------------------------------------------------------ */

export const SLEEVES: SleeveSkin[] = [
  { id: 'asphyxia', name: 'Asphyxia Classic', blurb: 'The factory back. Unsleeved and proud.', filter: 'none', rim: 'rgba(255,255,255,0.22)' },
  { id: 'toxic', name: 'Toxic Batch', blurb: 'Re-inked in runoff green.', filter: 'hue-rotate(95deg) saturate(1.35)', rim: 'rgba(57,255,106,0.55)' },
  { id: 'cryo', name: 'Cryo Batch', blurb: 'Flash-frozen cyan.', filter: 'hue-rotate(175deg) saturate(1.2)', rim: 'rgba(32,224,255,0.55)' },
  { id: 'royal', name: 'Royal Batch', blurb: 'Deep violet, off-market.', filter: 'hue-rotate(-70deg) saturate(1.25)', rim: 'rgba(162,91,255,0.55)' },
  { id: 'mono', name: 'Monochrome', blurb: 'All signal, no color.', filter: 'grayscale(1) contrast(1.15) brightness(1.05)', rim: 'rgba(244,251,255,0.4)' },
];

/* ------------------------------------------------------------------ */
/* Deck boxes                                                          */
/* ------------------------------------------------------------------ */

export const DECK_BOXES: DeckBoxSkin[] = [
  {
    id: 'bare',
    name: 'No Box',
    blurb: 'Raw stack on the mat, old-school.',
    body: null,
    edge: 'rgba(255,255,255,0.18)',
    emblemFilter: 'none',
  },
  {
    id: 'street-steel',
    name: 'Street Steel',
    blurb: 'Scuffed gunmetal case with a rivet lid.',
    body: 'linear-gradient(180deg, #3a3a44 0%, #23232b 18%, #17171d 100%)',
    edge: '#8b8b9a',
    emblemFilter: 'none',
  },
  {
    id: 'toxic-vault',
    name: 'Toxic Vault',
    blurb: 'Hazard-sealed. Probably fine.',
    body: 'linear-gradient(180deg, #1c3a22 0%, #0d2412 18%, #071408 100%)',
    edge: '#39ff6a',
    emblemFilter: 'hue-rotate(95deg) saturate(1.3)',
  },
  {
    id: 'chrome-case',
    name: 'Chrome Case',
    blurb: 'Dark White evidence locker, requisitioned.',
    body: 'linear-gradient(180deg, #1e3a44 0%, #10222b 18%, #081318 100%)',
    edge: '#20e0ff',
    emblemFilter: 'hue-rotate(175deg) saturate(1.15)',
  },
];

/* ------------------------------------------------------------------ */
/* Coins                                                               */
/* ------------------------------------------------------------------ */

export const COINS: CoinSkin[] = [
  { id: 'rift-standard', name: 'Rift Standard', blurb: 'The coin as struck. Skull and sigil.', filter: 'none' },
  { id: 'toxic-mint', name: 'Toxic Mint', blurb: 'Same die, dirtier metal.', filter: 'hue-rotate(95deg) saturate(1.3)' },
  { id: 'cryo-mint', name: 'Cryo Mint', blurb: 'Struck cold. Stays cold.', filter: 'hue-rotate(175deg) saturate(1.15)' },
  { id: 'ember-mint', name: 'Ember Mint', blurb: 'Pulled from the press still glowing.', filter: 'hue-rotate(-55deg) saturate(1.35)' },
];

/* ------------------------------------------------------------------ */
/* Lookup helpers - always fall back to the first (default) entry so a  */
/* stale/unknown stored id can never break rendering.                   */
/* ------------------------------------------------------------------ */

export function getPlaymat(id: string): PlaymatSkin {
  return PLAYMATS.find((p) => p.id === id) ?? PLAYMATS[0];
}
export function getSleeve(id: string): SleeveSkin {
  return SLEEVES.find((s) => s.id === id) ?? SLEEVES[0];
}
export function getDeckBox(id: string): DeckBoxSkin {
  return DECK_BOXES.find((d) => d.id === id) ?? DECK_BOXES[0];
}
export function getCoin(id: string): CoinSkin {
  return COINS.find((c) => c.id === id) ?? COINS[0];
}
