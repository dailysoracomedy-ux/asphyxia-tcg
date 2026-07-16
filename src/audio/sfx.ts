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
  // Commit 41.8 - a voice line layered on top of the existing negate SFX
  // whenever a React successfully negates something. File not supplied yet -
  // playSfx already fails safely (try/catch, and a missing audio file just
  // never fires its play promise) so this is safe to wire up ahead of the
  // asset arriving, with zero risk to the existing card.negatePlay sound.
  | 'voice.negated'
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
  | 'match.defeat'
  // Coin flip (Commit 34.3)
  | 'coin.flipStart'
  | 'coin.flipLoop'
  | 'coin.flipLand'
  // Commit 43 - the synthesized impact layer (scripts/generate-impact-sfx.py).
  // These are never triggered directly by game events; they play as LAYERS
  // under existing keys via SFX_LAYERS below, adding physical weight the
  // original one-shot samples don't carry on their own.
  | 'combat.whoosh'
  | 'combat.subBoom'
  | 'vfx.shatter';

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
  'voice.negated': '/audio/sfx/voice.negated.m4a',

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

  // Commit 34.3 - exact real durations (measured directly, not guessed):
  // flipStart 0.755s, flipLoop 1.785s, flipLand 2.280s (trimmed from a
  // 4s source file that had 1.8s of trailing silence padding). The coin
  // flip's own animation timing in NewGameMenu.tsx is built around these
  // real numbers so the visual spin never runs longer than its sound.
  'coin.flipStart': '/audio/sfx/coin.flipStart.m4a',
  'coin.flipLoop': '/audio/sfx/coin.flipLoop.m4a',
  'coin.flipLand': '/audio/sfx/coin.flipLand.m4a',

  'combat.whoosh': '/audio/sfx/combat.whoosh.m4a',
  'combat.subBoom': '/audio/sfx/combat.subBoom.m4a',
  'vfx.shatter': '/audio/sfx/vfx.shatter.m4a',
};

/**
 * Commit 43 - sounds that automatically ride along when their parent key
 * plays, at an optional delay. This is what turns "a hit sample" into "an
 * impact": the whoosh syncs to the lunge animation's wind-up, the subBoom
 * gives heavy hits and destroys a chest-thump the samples lack, and the
 * shatter matches the destroy animation's glitch-tear. Layers never trigger
 * their own layers (enforced in playSfx) - this stays a flat, one-level map
 * by construction, not by hoping nobody adds a cycle.
 */
const SFX_LAYERS: Partial<Record<SfxKey, { key: SfxKey; delayMs: number }[]>> = {
  'combat.attackDeclare': [{ key: 'combat.whoosh', delayMs: 110 }],
  'combat.heavyHit': [{ key: 'combat.subBoom', delayMs: 0 }],
  'combat.destroy': [
    { key: 'vfx.shatter', delayMs: 0 },
    { key: 'combat.subBoom', delayMs: 40 },
  ],
  'combat.directO2': [{ key: 'combat.subBoom', delayMs: 30 }],
};

/**
 * Commit 42 - per-key playback tuning. `vary` is random playbackRate jitter
 * (+/- that fraction, pitch shifting with it via preservesPitch=false) so
 * rapid repeats of the same event - a flurry of hits, a three-card draw -
 * read as distinct physical moments instead of the same sample stuttering.
 * `gain` scales the key under the global SFX volume (hover ticks fire
 * constantly and were mixed too hot relative to one-shot events).
 * Keys not listed play exactly as before - vary 0, gain 1.
 */
const SFX_TUNING: Partial<Record<SfxKey, { vary?: number; gain?: number }>> = {
  'ui.hover': { gain: 0.5, vary: 0.03 },
  'ui.click': { vary: 0.04 },

  'card.draw': { vary: 0.07 },
  'card.enginePlay': { vary: 0.05 },
  'card.equipAttach': { vary: 0.05 },
  'card.equipSwap': { vary: 0.05 },
  'card.specialPlay': { vary: 0.04 },
  'card.reactPlay': { vary: 0.04 },

  'combat.hit': { vary: 0.08 },
  'combat.heavyHit': { vary: 0.05 },
  'combat.destroy': { vary: 0.05 },
  'combat.attackDeclare': { vary: 0.04 },

  'resource.momentumGain': { vary: 0.06 },
  'resource.momentumSpend': { vary: 0.05 },
  'resource.o2Loss': { vary: 0.04 },

  'engine.trigger': { vary: 0.05 },

  'combat.whoosh': { vary: 0.09, gain: 0.75 },
  'combat.subBoom': { vary: 0.06, gain: 0.95 },
  'vfx.shatter': { vary: 0.07, gain: 0.8 },
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

export function playSfx(key: SfxKey, isLayer = false) {
  try {
    const { sfxMuted, sfxVolume } = useAudioStore.getState();
    if (sfxMuted || sfxVolume <= 0) return;
    // Fire this key's layers (Commit 43). isLayer guards against chains: a
    // layer plays exactly itself, never its own layers.
    if (!isLayer) {
      const layers = SFX_LAYERS[key];
      if (layers) {
        for (const layer of layers) {
          if (layer.delayMs > 0) setTimeout(() => playSfx(layer.key, true), layer.delayMs);
          else playSfx(layer.key, true);
        }
      }
    }
    const pool = getPool(key);
    const i = poolCursor.get(key) ?? 0;
    const el = pool[i];
    poolCursor.set(key, (i + 1) % pool.length);
    el.currentTime = 0;
    const tune = SFX_TUNING[key];
    el.volume = Math.max(0, Math.min(1, sfxVolume * (tune?.gain ?? 1)));
    const vary = tune?.vary ?? 0;
    if (vary > 0) {
      // Let the pitch follow the rate - that's the point of the jitter.
      // preservesPitch is widely supported; guarded anyway since this whole
      // function promises to never throw into game logic.
      try {
        (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
      } catch {}
      el.playbackRate = 1 + (Math.random() * 2 - 1) * vary;
    } else {
      el.playbackRate = 1;
    }
    el.play().catch(() => {});
  } catch {
    // Audio is enhancement-only - never let a playback failure affect anything else.
  }
}
