/**
 * Commit 56 - LORE CINEMATIC content + asset contract.
 *
 * This file is the ONE place that needs to change once Daily's real audio
 * and background images exist. Every slide/beat below references an asset
 * by a conventioned path under /public - drop a correctly-named file at
 * that path and it's picked up automatically, no code changes needed:
 *
 *   Intro slides:  /public/audio/lore/intro-<id>.m4a
 *                  /public/images/lore/intro-<id>.webp
 *   Faction splash: /public/audio/lore/splash-<faction>-<n>.m4a
 *                   /public/images/lore/splash-<faction>-<n>.webp
 *
 * NEITHER asset needs to exist for this to work right now - CinematicBeat
 * (the shared player both LoreIntro and FactionSplash use) falls back to a
 * themed gradient when an image 404s, and falls back to `fallbackMs` timing
 * when audio fails to load or has no duration yet. That's what makes the
 * whole intro fully playable and testable today, before a single real
 * asset exists - swap files in later and the timing automatically switches
 * to the audio's REAL measured duration (same principle the coin flip's
 * animation timing already uses elsewhere in this app - measured, not
 * guessed).
 *
 * TEXT BELOW IS PLACEHOLDER, in Daily's own words from planning this
 * feature - it's real enough to build and test the whole pipeline against,
 * but Daily said explicitly the faction splashes are "not exactly that,
 * but in that range," and will record final copy. Swap `text` freely;
 * nothing else needs to change when it does.
 */

import type { Faction } from '@/types/game';

export interface LoreBeat {
  id: string;
  text: string;
  audioSrc: string;
  imageSrc: string;
  /** Used until real audio exists (or if it fails to load) - a readable
   *  words-per-minute estimate, not a random guess. Once real audio is in
   *  place, its measured duration wins automatically. */
  fallbackMs: number;
  /** Chronos onward gets the glitch/fracture treatment instead of a calm
   *  Ken Burns pan - the visual language deliberately breaks here, echoing
   *  the same shader family used on Neon's pack-card exit warp. */
  visual?: 'calm' | 'glitch';
}

/** ~150wpm reading pace + a fixed pad so short lines don't feel clipped. */
function estimateMs(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(2200, Math.round((words / 150) * 60000) + 900);
}

function beat(id: string, text: string, opts: { visual?: 'calm' | 'glitch'; group?: string } = {}): LoreBeat {
  const group = opts.group ?? 'intro';
  return {
    id,
    text,
    audioSrc: `/audio/lore/${group}-${id}.m4a`,
    imageSrc: `/images/lore/${group}-${id}.webp`,
    fallbackMs: estimateMs(text),
    visual: opts.visual,
  };
}

/** The 11 narrated intro beats, in order. */
export const LORE_INTRO_BEATS: LoreBeat[] = [
  beat('cold-open', 'In the distant future, the Government controlled everything... including oxygen. After charging humanity for the right to breathe, 98% of the world died.'),
  beat('rebellion', 'The survivors formed O\u2082 Rising \u2014 a resistance that fought back, and destroyed the regime.'),
  beat('fracture', 'But once the Government fell, the rebellion fractured into three factions... over one question: what should humanity\u2019s future become next?'),
  beat('neon-reveal', 'Neon Underground chose freedom, at any cost.'),
  beat('darkwhite-reveal', 'Dark White chose order, and control.'),
  beat('synth-reveal', 'Synth Ascendancy chose evolution, beyond humanity.'),
  beat('war', 'Their disagreement became a war for the last breathable future on Earth. One faction... finally won.'),
  beat('chronos', 'Then... the Government\u2019s final failsafe activated: Chronos Protocol. Time reset to just before the war \u2014 resurrecting the dead, and forcing every faction to fight again.', { visual: 'glitch' }),
  beat('sting', 'Memories wiped. Sent to another dimension.', { visual: 'glitch' }),
  beat('loop', 'Every victory triggers another reset. Every loop fractures reality further. New dimensions will emerge. The battle won\u2019t end the same way every time.', { visual: 'glitch' }),
  beat('thesis', 'Oxygen is life. Victory is the trigger. Time is the cage.', { visual: 'glitch' }),
];

/** The 12th beat - narration resolves INTO the 3-faction choice rather than
 *  fading out like the others. LoreIntro renders the faction cards
 *  alongside this beat instead of after it. */
export const LORE_CALL_TO_ACTION: LoreBeat = beat('call-to-action', 'Which faction will YOU join?', { visual: 'glitch' });

/** Per-faction welcome splash, voice- and pacing-differentiated. Each plays
 *  ONCE PER FACTION EVER (see ladderStore.splashSeen) - on your first-ever
 *  pick from the lore screen, or the first time you enter a NEWLY UNLOCKED
 *  faction's own ladder, whichever comes first for that faction. */
export const FACTION_SPLASH_BEATS: Record<Faction, LoreBeat[]> = {
  'Neon Underground': [
    beat('n1', 'So you joined Neon Underground, huh?', { group: 'splash-neon' }),
    beat('n2', 'Siiiick, bro. We could feel the FREEDOM coursing through your veins.', { group: 'splash-neon' }),
    beat('n3', 'It resonated with us.', { group: 'splash-neon' }),
    beat('n4', 'Help us fight for our future, will ya?!', { group: 'splash-neon' }),
  ],
  'Dark White': [
    beat('d1', 'So you choose to surrender your autonomy to Lord Overseer Prime?', { group: 'splash-dw' }),
    beat('d2', 'Very well, then.', { group: 'splash-dw' }),
    beat('d3', 'As long as you can prove your loyalty, and your desire for CONTROL...', { group: 'splash-dw' }),
    beat('d4', '...otherwise we may have to enable a certain protocol.', { group: 'splash-dw' }),
    beat('d5', 'I wouldn\u2019t want to have to do that.', { group: 'splash-dw' }),
    beat('d6', 'From now on, you obey my every command \u2014 so we can rebuild the future the way WE want it.', { group: 'splash-dw' }),
    beat('d7', 'Got it?', { group: 'splash-dw' }),
  ],
  'Synth Ascendancy': [
    beat('s1', 'Synth Ascendancy welcomes you, human.', { group: 'splash-synth' }),
    beat('s2', 'We have analyzed your biology. Our data has returned a sufficient answer to our query.', { group: 'splash-synth' }),
    beat('s3', 'Although we wish to rise above humankind \u2014 above the flawed design of humanity \u2014 we shall spare you, until you die.', { group: 'splash-synth' }),
    beat('s4', 'Fight with us, and we shall show you a future your human mind will barely comprehend.', { group: 'splash-synth' }),
    beat('s5', 'So you confirm?', { group: 'splash-synth' }),
  ],
};

/** Per-faction visual pacing variant, read by FactionSplash. Not colors
 *  (theme.ts already owns those) - this is TIMING and TEXT PRESENTATION
 *  character: Neon cuts fast with a glitch flicker on ALL-CAPS emphasis,
 *  Dark White holds long silent beats (especially before the threat line),
 *  Synth renders more like a cold terminal readout than dialogue. */
export type SplashVariant = 'neon' | 'dw' | 'synth';
export const SPLASH_VARIANT: Record<Faction, SplashVariant> = {
  'Neon Underground': 'neon',
  'Dark White': 'dw',
  'Synth Ascendancy': 'synth',
};
