/**
 * Commit 42 - the cosmetics registry: playmats, card sleeves, and flip
 * coins. Pure data, no React.
 *
 * Commit 50.4 - real hand-painted art replaces the original CSS-only recipes
 * (procedural gradients for playmats, filter/overlay tints for sleeves and
 * coins). Every playmat and sleeve is now either a genuine image or an
 * explicit "use the default" sentinel (`'faction'` / `'none'`); every coin
 * skin replaces only its FRONT face - tails always stays the shared default
 * back (COIN_BACK_SRC), since that's the only face new coin art was
 * provided for. Everything is still keyed by stable string ids (stored in
 * localStorage via cosmeticsStore), so adding another skin later is still
 * append-only: drop the file in static2/cosmetics/<kind>/, add one entry
 * here, nothing else changes.
 */

export type CosmeticKind = 'playmat' | 'sleeve' | 'coin';

export interface PlaymatSkin {
  id: string;
  name: string;
  blurb: string;
  /** `null` = the 'faction' default: the board's own dynamic per-faction
   *  radial gradient (no art - this is the only entry without a real image,
   *  and it's intentional: it's the "just use my deck's colors" option). */
  image: string | null;
  /** Accent used for the mat's stitched border line; null = faction border. */
  edge: string | null;
}

export interface SleeveSkin {
  id: string;
  name: string;
  blurb: string;
  /** `null` = the 'none' default: the original printed card back
   *  (SLEEVE_BASE_SRC), unmodified. Every other entry REPLACES the back
   *  entirely with its own art - no filter/overlay tinting anymore. */
  image: string | null;
  /** Sleeve rim color - the thin plastic edge you see around a sleeved card. */
  rim: string;
}

export interface CoinSkin {
  id: string;
  name: string;
  blurb: string;
  /** `null` = the 'rift-standard' default front (COIN_FRONT_SRC). Every
   *  other entry replaces ONLY the front/heads face - tails is always the
   *  shared default back (COIN_BACK_SRC) for every skin, since that's the
   *  only face new coin art was provided for. */
  frontImage: string | null;
}

export const COIN_FRONT_SRC = '/images/coin-front.png';
export const COIN_BACK_SRC = '/images/coin-back.png';
export const SLEEVE_BASE_SRC = '/art/card-back.webp';

/* ------------------------------------------------------------------ */
/* Playmats                                                            */
/* ------------------------------------------------------------------ */

export const PLAYMATS: PlaymatSkin[] = [
  { id: 'faction', name: 'Faction Standard', blurb: 'The stock mat. Your deck’s own colors, nothing else.', image: null, edge: null },
  { id: 'cracked-ground', name: 'Cracked Ground', blurb: 'Scorched earth, split wide open.', image: '/cosmetics/playmats/cracked-ground.webp', edge: '#ff9b4a' },
  { id: 'digital-bleed', name: 'Digital Bleed', blurb: 'The signal is dying and taking the picture with it.', image: '/cosmetics/playmats/digital-bleed.webp', edge: '#20e0ff' },
  { id: 'old-gods', name: 'Old Gods', blurb: 'Something was worshipped here, once.', image: '/cosmetics/playmats/old-gods.webp', edge: '#c084fc' },
  { id: 'dark-white-arena', name: 'White Room', blurb: 'Dark White’s clean-room floor. Sterile. Watched.', image: '/cosmetics/playmats/dark-white-arena.webp', edge: '#20e0ff' },
  { id: 'dark-white-arena-2', name: 'White Room II', blurb: 'A different wing of the same facility.', image: '/cosmetics/playmats/dark-white-arena-2.webp', edge: '#a6e8ff' },
  { id: 'neon-underground-alley', name: 'Underground Alley', blurb: 'Neon Underground back-alley signal wash.', image: '/cosmetics/playmats/neon-underground-alley.webp', edge: '#ff2fd0' },
  { id: 'neon-underground-alley-2', name: 'Underground Alley II', blurb: 'Deeper in, further from the light.', image: '/cosmetics/playmats/neon-underground-alley-2.webp', edge: '#ff6ad5' },
  { id: 'ascendant-spire', name: 'Ascendant Spire', blurb: 'Synth Ascendancy boardroom silicon, still warm.', image: '/cosmetics/playmats/ascendant-spire.webp', edge: '#a25bff' },
  { id: 'ascendant-spire-2', name: 'Ascendant Spire II', blurb: 'Higher up the tower.', image: '/cosmetics/playmats/ascendant-spire-2.webp', edge: '#c9a5ff' },
];

/* ------------------------------------------------------------------ */
/* Sleeves                                                             */
/* ------------------------------------------------------------------ */

export const SLEEVES: SleeveSkin[] = [
  { id: 'none', name: 'None', blurb: 'The factory back. Unsleeved and proud.', image: null, rim: 'rgba(255,255,255,0.22)' },
  { id: 'riot', name: 'Riot', blurb: 'Asphyxia house art - a street about to blow.', image: '/cosmetics/sleeves/riot.webp', rim: 'rgba(255,47,208,0.55)' },
  { id: 'timewarp', name: 'Timewarp', blurb: 'Asphyxia house art - the moment before impact.', image: '/cosmetics/sleeves/timewarp.webp', rim: 'rgba(32,224,255,0.55)' },
  { id: 'last-breath', name: 'Last Breath', blurb: 'Asphyxia house art - down to the wire.', image: '/cosmetics/sleeves/last-breath.webp', rim: 'rgba(162,91,255,0.55)' },
  { id: 'skulls', name: 'Skulls', blurb: 'Asphyxia house art - the classic, dressed up.', image: '/cosmetics/sleeves/skulls.webp', rim: 'rgba(244,251,255,0.4)' },
  { id: 'dark-white-1', name: 'Dark White I', blurb: 'Faction art, Dark White.', image: '/cosmetics/sleeves/dark-white-1.webp', rim: 'rgba(32,224,255,0.5)' },
  { id: 'dark-white-2', name: 'Dark White II', blurb: 'Faction art, Dark White.', image: '/cosmetics/sleeves/dark-white-2.webp', rim: 'rgba(166,232,255,0.5)' },
  { id: 'neon-underground-1', name: 'Neon Underground I', blurb: 'Faction art, Neon Underground.', image: '/cosmetics/sleeves/neon-underground-1.webp', rim: 'rgba(255,47,208,0.55)' },
  { id: 'neon-underground-2', name: 'Neon Underground II', blurb: 'Faction art, Neon Underground.', image: '/cosmetics/sleeves/neon-underground-2.webp', rim: 'rgba(255,106,213,0.55)' },
  { id: 'synth-ascendancy-1', name: 'Synth Ascendancy I', blurb: 'Faction art, Synth Ascendancy.', image: '/cosmetics/sleeves/synth-ascendancy-1.webp', rim: 'rgba(162,91,255,0.55)' },
  { id: 'synth-ascendancy-2', name: 'Synth Ascendancy II', blurb: 'Faction art, Synth Ascendancy.', image: '/cosmetics/sleeves/synth-ascendancy-2.webp', rim: 'rgba(201,165,255,0.55)' },
];

/* ------------------------------------------------------------------ */
/* Coins - front-face-only skins; tails is always COIN_BACK_SRC.       */
/* ------------------------------------------------------------------ */

export const COINS: CoinSkin[] = [
  { id: 'rift-standard', name: 'Rift Standard', blurb: 'The coin as struck. Skull and sigil.', frontImage: null },
  { id: 'dark-white-1', name: 'Dark White I', blurb: 'Faction mint, Dark White.', frontImage: '/cosmetics/coins/dark-white-1.webp' },
  { id: 'dark-white-2', name: 'Dark White II', blurb: 'Faction mint, Dark White.', frontImage: '/cosmetics/coins/dark-white-2.webp' },
  { id: 'neon-underground-1', name: 'Neon Underground I', blurb: 'Faction mint, Neon Underground.', frontImage: '/cosmetics/coins/neon-underground-1.webp' },
  { id: 'neon-underground-2', name: 'Neon Underground II', blurb: 'Faction mint, Neon Underground.', frontImage: '/cosmetics/coins/neon-underground-2.webp' },
  { id: 'synth-ascendancy-1', name: 'Synth Ascendancy I', blurb: 'Faction mint, Synth Ascendancy.', frontImage: '/cosmetics/coins/synth-ascendancy-1.webp' },
  { id: 'synth-ascendancy-2', name: 'Synth Ascendancy II', blurb: 'Faction mint, Synth Ascendancy.', frontImage: '/cosmetics/coins/synth-ascendancy-2.webp' },
  { id: 'frozen', name: 'Frozen', blurb: 'Struck cold. Stays cold.', frontImage: '/cosmetics/coins/frozen.webp' },
  { id: 'overdrive', name: 'Overdrive', blurb: 'Pulled from the press still glowing.', frontImage: '/cosmetics/coins/overdrive.webp' },
  { id: 'toxic-gas', name: 'Toxic Gas', blurb: 'Same die, dirtier metal.', frontImage: '/cosmetics/coins/toxic-gas.webp' },
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
export function getCoin(id: string): CoinSkin {
  return COINS.find((c) => c.id === id) ?? COINS[0];
}
