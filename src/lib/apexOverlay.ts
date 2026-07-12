import type { GameState } from '@/types/game';
import { getEffectiveDef, getPreviewAttackDamage } from '@/game/rules';

/**
 * Shared percentage-based zone map for the Apex overlay template. One config for
 * every Apex card - do not create per-card overrides unless a specific card's art
 * genuinely can't fit this layout (none currently do). Percentages are relative to
 * the card container, so the same numbers work at board/hand/inspect/gallery sizes.
 */
/**
 * Shared percentage-based zone map for the Apex overlay template. One config for
 * every Apex card - do not create per-card overrides unless a specific card's art
 * genuinely can't fit this layout (none currently do). Percentages are relative to
 * the card container, so the same numbers work at board/hand/inspect/gallery sizes.
 *
 * Calibrated against the 12 uploaded card frames (Commit 19 art pass) via pixel
 * measurement of the DEF badge and ATTACKS panel boundaries. Note: the frame's
 * black-panel top edge varies by roughly 3 percentage points across the 12 images
 * (measured 60.9%-64.0%) - these images were generated individually rather than
 * from one pixel-identical template, so treat these numbers as "close and usable,"
 * not exact. Use the Developer gallery's "Show Apex Overlay Zones" toggle to check
 * any given card and nudge further if a specific one looks off.
 */
export const APEX_TEMPLATE_ZONES = {
  def: { left: 48, top: 60.5, width: 16, height: 5.5 },
  attacks: {
    leftZone: { left: 7, width: 66, height: 3.2 },
    valueZone: { left: 77.5, width: 13.5, height: 3.2 },
    rows: [69, 73, 77, 81],
  },
  counters: { left: 68, top: 53, width: 24, height: 6 },
  status: { left: 68, top: 48.5, width: 24, height: 3.5 },
} as const;

export type ValueDeltaState = 'boosted' | 'reduced' | 'normal';

/** Pure comparison - no game-state access, just classifies a live value against its
 *  printed baseline for color purposes (green/red/white). */
export function getValueDeltaState(baseValue: number, currentValue: number): ValueDeltaState {
  if (currentValue > baseValue) return 'boosted';
  if (currentValue < baseValue) return 'reduced';
  return 'normal';
}

/** Thin delegation to the single authoritative DEF calculation (rules.ts) - the same
 *  function combat resolution, previews, and the inspect modal already use. Never
 *  recompute DEF logic here. */
export function getDisplayedDefenseValue(state: GameState, apexInstanceId: string): number {
  return getEffectiveDef(state, apexInstanceId);
}

/** Thin delegation to the single authoritative attack-damage calculation (rules.ts).
 *  Returns null if the attack/apex can't be resolved (e.g. mid-transition state). */
export function getDisplayedAttackValue(state: GameState, apexInstanceId: string, attackId: string, targetInstanceId?: string): number | null {
  const preview = getPreviewAttackDamage(state, apexInstanceId, attackId, targetInstanceId);
  return preview ? preview.modifiedDamage : null;
}
