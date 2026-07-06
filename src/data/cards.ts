import type { CardDef } from '@/types/game';
import { NEON_CARDS } from './cards.neon';
import { DARK_WHITE_CARDS } from './cards.darkwhite';
import { SYNTH_CARDS } from './cards.synth';

export const ALL_CARDS: CardDef[] = [...NEON_CARDS, ...DARK_WHITE_CARDS, ...SYNTH_CARDS];

export const CARD_MAP: Record<string, CardDef> = Object.fromEntries(ALL_CARDS.map((c) => [c.id, c]));

export function getCardDef(defId: string): CardDef {
  const def = CARD_MAP[defId];
  if (!def) throw new Error(`Unknown card definition id: ${defId}`);
  return def;
}

export * from './cards.neon';
export * from './cards.darkwhite';
export * from './cards.synth';
