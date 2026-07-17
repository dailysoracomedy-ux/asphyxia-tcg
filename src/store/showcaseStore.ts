import { create } from 'zustand';

/**
 * AI vs AI Showcase mode settings - speed multiplier and pause state. Deliberately
 * a separate, tiny store rather than folded into gameStore.ts: this is UI/
 * presentation-only, has zero effect outside Showcase mode, and keeping it
 * separate means simulate.ts and every store-logic test can go on never knowing
 * it exists.
 *
 * Commit 29.1: switched from 3 discrete speed buttons to a continuous slider,
 * and raised the default and the slow end significantly - reported as "so fast
 * it's hard to keep up with what's happening" even at the old "Slow" setting
 * (1.75x). Range is now 0.5x (fastest) to 4x (slowest), defaulting to 2x rather
 * than the old 1x "Normal" default, so a fresh Showcase session is noticeably
 * more readable out of the box, before anyone even touches the slider.
 *
 * The multiplier is read by animationStore.ts (to scale ceremony/animation
 * durations) and by GameBoard.tsx's AI driver (to scale its own decision
 * timers) - both read it fresh via getState() rather than as a hook dependency
 * in most spots, since it only needs to affect *how long things take*, not
 * trigger extra re-renders on its own.
 */
export const SHOWCASE_SPEED_MIN = 0.5;
export const SHOWCASE_SPEED_MAX = 4;
export const SHOWCASE_SPEED_DEFAULT = 2;

interface ShowcaseStoreState {
  active: boolean;
  /** Multiplier applied to every ceremony/animation/AI-decision duration - higher
   *  is slower, matching how the old "Slow"/"Fast" labels worked, just continuous
   *  now instead of 3 fixed points. */
  speedMultiplier: number;
  paused: boolean;
  setSpeedMultiplier: (m: number) => void;
  togglePaused: () => void;
  /** Commit 29.10 - direct, idempotent pause control, alongside the existing
   *  toggle. The tutorial's own explanation-step pausing (TutorialPanel.tsx)
   *  needs to set an exact desired value on every step change, not flip
   *  whatever the current value happens to be - toggling here would drift out
   *  of sync the moment two effects fire in an order other than strictly
   *  alternating. */
  setPaused: (paused: boolean) => void;
  setActive: (active: boolean) => void;
}

export const useShowcaseStore = create<ShowcaseStoreState>((set) => ({
  active: false,
  speedMultiplier: SHOWCASE_SPEED_DEFAULT,
  paused: false,
  setSpeedMultiplier: (m) => set({ speedMultiplier: Math.max(SHOWCASE_SPEED_MIN, Math.min(SHOWCASE_SPEED_MAX, m)) }),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  setPaused: (paused) => set({ paused }),
  // Commit 29.10: no longer resets `paused` as a side effect here - that was
  // the actual cause of a real, confirmed race condition. The tutorial's own
  // pause-on-explanation-step logic (TutorialPanel.tsx) also calls setActive
  // indirectly via this same store, and having setActive silently force
  // paused back to false meant it could overwrite a deliberate pause depending
  // on which effect happened to run last - invisible, and exactly the kind of
  // bug that's easy to reintroduce by "helpfully" resetting extra state here
  // again later. Callers that specifically want a fresh, unpaused start (like
  // ShowcaseControls' own mount effect) set that explicitly themselves now.
  setActive: (active) => set({ active }),
}));

/** Current multiplier - 1 whenever Showcase mode isn't active, so every duration
 *  calculation elsewhere can just multiply by this unconditionally without an
 *  extra "are we even in showcase mode" branch of its own. */
export function currentShowcaseMultiplier(): number {
  const s = useShowcaseStore.getState();
  return s.active ? s.speedMultiplier : 1;
}
