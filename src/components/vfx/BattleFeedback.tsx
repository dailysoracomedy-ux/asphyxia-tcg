'use client';

/**
 * Commit 43 - whole-screen battle feedback, two pieces:
 *
 * 1. useScreenShakeClass() - returns 'vfx-screen-shake' for ~340ms whenever a
 *    shake-worthy event lands (a destroy, a heavy hit, direct O2 damage, or
 *    overflow). GameBoard puts it on its root. Consecutive events re-trigger
 *    cleanly: the class is dropped for one frame before re-adding, which is
 *    what actually restarts a CSS animation.
 *
 * 2. <O2Vignette /> - a fixed, pointer-transparent red vignette breath across
 *    the whole screen whenever anyone takes direct O2 damage. Keyed per event
 *    so rapid O2 hits each pulse.
 *
 * Both read the same animationStore stream everything else uses - zero new
 * game-store knowledge, zero effect on headless runs (never mounted there).
 * Reduced-motion handling lives in the CSS classes themselves.
 */

import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAnimationStore, type VisualEvent } from '@/store/animationStore';

const HEAVY_HIT_THRESHOLD = 500; // matches AudioController's own threshold

function isShakeWorthy(e: VisualEvent): boolean {
  if (e.type === 'CARD_DESTROYED' || e.type === 'O2_DAMAGE' || e.type === 'OVERFLOW_DAMAGE') return true;
  if (e.type === 'CARD_HIT' && e.label) {
    const dmg = Math.abs(parseInt(e.label, 10)) || 0;
    return dmg >= HEAVY_HIT_THRESHOLD;
  }
  return false;
}

export function useScreenShakeClass(): string {
  const latestShakeId = useAnimationStore(
    useShallow((s) => {
      for (let i = s.events.length - 1; i >= 0; i--) {
        if (isShakeWorthy(s.events[i])) return s.events[i].id;
      }
      return null;
    })
  );
  const [shaking, setShaking] = useState(false);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (!latestShakeId || latestShakeId === seen.current) return;
    seen.current = latestShakeId;
    // Drop the class for one frame first - re-adding the same class in the
    // same frame would NOT restart the animation on back-to-back events.
    setShaking(false);
    const raf = requestAnimationFrame(() => setShaking(true));
    const t = setTimeout(() => setShaking(false), 380);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [latestShakeId]);

  return shaking ? 'vfx-screen-shake' : '';
}

export function O2Vignette() {
  const o2Events = useAnimationStore(useShallow((s) => s.events.filter((e) => e.type === 'O2_DAMAGE')));
  if (o2Events.length === 0) return null;
  // Key on the newest event so each O2 hit restarts the breath.
  const latest = o2Events[o2Events.length - 1];
  return <div key={latest.id} className="vfx-o2-vignette" aria-hidden />;
}
