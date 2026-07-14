/**
 * Reusable SFX framework (Commit 25). Commit 32 - swapped the synthesized
 * placeholder tones for the real sound set, one real file per key
 * (public/audio/sfx/{key}.m4a - converted from the supplied source files to
 * compact AAC/m4a, ~790KB total for all 25), exactly the drop-in swap the
 * original NOTE at the bottom of this file anticipated - the public API
 * (playSfx(key)) and every call site elsewhere in the app needed zero
 * changes.
 *
 * Safety, all handled here so no caller needs to think about it:
 * - every playback wrapped in try/catch; a failure here can never throw into
 *   game logic, matching the same defensive pattern gameStore.ts's emitVfx uses
 * - respects useAudioStore's mute/volume settings, read fresh on every call
 * - does nothing at all outside a browser (Node/simulate.ts/tests never trigger
 *   this path in the first place, since it's only ever invoked from a mounted
 *   React component's effect, never from gameStore.ts or rules.ts directly)
 * - a small pool of Audio elements per key (not just one), so a fast run of
 *   the same event (several hits in quick succession, for instance) overlaps
 *   naturally instead of the second play cutting the first one off
 */
import { useAudioStore } from '@/store/audioStore';

export type SfxKey =
  // UI
  | 'ui.click'
  | 'ui.hover'
  | 'ui.invalid'
  | 'ui.confirm'
  // Card
  | 'card.draw'
  | 'card.apexPlay'
  | 'card.enginePlay'
  | 'card.equipAttach'
  | 'card.equipSwap'
  | 'card.specialPlay'
  | 'card.reactPlay'
  | 'card.negatePlay'
  // Combat
  | 'combat.attackDeclare'
  | 'combat.hit'
  | 'combat.heavyHit'
  | 'combat.directO2'
  | 'combat.overflow'
  | 'combat.destroy'
  // Resources
  | 'resource.o2Loss'
  | 'resource.momentumGain'
  | 'resource.momentumSpend'
  // Mechanics
  | 'engine.trigger'
  | 'rift.trigger'
  // End
  | 'match.victory'
  | 'match.defeat';

const SFX_SRC: Record<SfxKey, string> = {
  'ui.click': '/audio/sfx/ui.click.m4a',
  'ui.hover': '/audio/sfx/ui.hover.m4a',
  'ui.invalid': '/audio/sfx/ui.invalid.m4a',
  'ui.confirm': '/audio/sfx/ui.confirm.m4a',

  'card.draw': '/audio/sfx/card.draw.m4a',
  'card.apexPlay': '/audio/sfx/card.apexPlay.m4a',
  'card.enginePlay': '/audio/sfx/card.enginePlay.m4a',
  'card.equipAttach': '/audio/sfx/card.equipAttach.m4a',
  'card.equipSwap': '/audio/sfx/card.equipSwap.m4a',
  'card.specialPlay': '/audio/sfx/card.specialPlay.m4a',
  'card.reactPlay': '/audio/sfx/card.reactPlay.m4a',
  'card.negatePlay': '/audio/sfx/card.negatePlay.m4a',

  'combat.attackDeclare': '/audio/sfx/combat.attackDeclare.m4a',
  'combat.hit': '/audio/sfx/combat.hit.m4a',
  'combat.heavyHit': '/audio/sfx/combat.heavyHit.m4a',
  'combat.directO2': '/audio/sfx/combat.directO2.m4a',
  'combat.overflow': '/audio/sfx/combat.overflow.m4a',
  'combat.destroy': '/audio/sfx/combat.destroy.m4a',

  'resource.o2Loss': '/audio/sfx/resource.o2Loss.m4a',
  'resource.momentumGain': '/audio/sfx/resource.momentumGain.m4a',
  'resource.momentumSpend': '/audio/sfx/resource.momentumSpend.m4a',

  'engine.trigger': '/audio/sfx/engine.trigger.m4a',
  'rift.trigger': '/audio/sfx/rift.trigger.m4a',

  'match.victory': '/audio/sfx/match.victory.m4a',
  'match.defeat': '/audio/sfx/match.defeat.m4a',
};

const POOL_SIZE = 3;
const pools = new Map<SfxKey, HTMLAudioElement[]>();
const poolCursor = new Map<SfxKey, number>();

function getPool(key: SfxKey): HTMLAudioElement[] {
  let pool = pools.get(key);
  if (!pool) {
    pool = Array.from({ length: POOL_SIZE }, () => {
      const el = new Audio(SFX_SRC[key]);
      el.preload = 'auto';
      return el;
    });
    pools.set(key, pool);
    poolCursor.set(key, 0);
  }
  return pool;
}

export function playSfx(key: SfxKey) {
  try {
    const { sfxMuted, sfxVolume } = useAudioStore.getState();
    if (sfxMuted || sfxVolume <= 0) return;
    const pool = getPool(key);
    const i = poolCursor.get(key) ?? 0;
    const el = pool[i];
    poolCursor.set(key, (i + 1) % pool.length);
    el.currentTime = 0;
    el.volume = Math.max(0, Math.min(1, sfxVolume));
    el.play().catch(() => {});
  } catch {
    // Audio is enhancement-only - never let a playback failure affect anything else.
  }
}
