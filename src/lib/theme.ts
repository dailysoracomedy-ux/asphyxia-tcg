import type { Faction } from '@/types/game';

export interface FactionTheme {
  primary: string;
  secondary: string;
  bg: string;
  border: string;
  glow: string;
  text: string;
}

export const FACTION_THEMES: Record<Faction, FactionTheme> = {
  'Neon Underground': {
    primary: '#ff2fd0', // magenta
    secondary: '#39ff6a', // toxic green
    bg: 'linear-gradient(155deg, #240022 0%, #0a1408 100%)',
    border: '#ff2fd0',
    glow: 'glow-magenta',
    text: '#ffd6f7',
  },
  'Dark White': {
    primary: '#20e0ff', // cyan
    secondary: '#f4fbff', // white
    bg: 'linear-gradient(155deg, #001b22 0%, #10171c 100%)',
    border: '#20e0ff',
    glow: 'glow-cyan',
    text: '#e7fbff',
  },
  'Synth Ascendancy': {
    primary: '#a25bff', // purple
    secondary: '#ff9130', // orange
    bg: 'linear-gradient(155deg, #1c0630 0%, #200e00 100%)',
    border: '#a25bff',
    glow: '',
    text: '#ecd9ff',
  },
};

export function factionTheme(faction: Faction): FactionTheme {
  return FACTION_THEMES[faction];
}

// ASPHYXIA's 5 card types for display purposes: Apex, Engine, Equip, Special, React.
// "Engine" and "React" are umbrella labels - AbilitySupport/BatterySupport and
// cancel-style Reacts (NEGATE tag) still behave differently internally, but players
// only need to think in terms of 5 types. See the CardType doc comment in types/game.ts.
export function getCardTypeLabel(def: { type: string; tags?: string[] }): string {
  switch (def.type) {
    case 'Apex':
      return 'APEX';
    case 'AbilitySupport':
      return 'ENGINE — ABILITY';
    case 'BatterySupport':
      return 'ENGINE — BATTERY';
    case 'Equip':
      return 'EQUIP';
    case 'Special':
      return 'SPECIAL';
    case 'Reaction':
      return def.tags?.includes('NEGATE') ? 'REACT — NEGATE' : 'REACT';
    default:
      return def.type.toUpperCase();
  }
}
