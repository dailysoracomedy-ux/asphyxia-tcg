import type { Faction } from '@/types/game';

/**
 * Commit 30.3 - real background music, replacing the earlier empty-playlist
 * scaffolding. One shared theme track (Menu, Tutorial, and AI vs AI all use
 * this - see MusicController.tsx's own reasoning for why those three never
 * crossfade between each other), and one track per faction, used only during
 * a real battle (Vs AI or Hotseat), keyed off player1's selected faction.
 */
export const THEME_TRACK_SRC = '/audio/music/theme.m4a';

export const FACTION_TRACK_SRC: Record<Faction, string> = {
  'Neon Underground': '/audio/music/neon-underground.m4a',
  'Dark White': '/audio/music/dark-white.m4a',
  'Synth Ascendancy': '/audio/music/synth-ascendancy.m4a',
};
