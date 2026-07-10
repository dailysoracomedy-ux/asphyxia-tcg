import { create } from 'zustand';

/**
 * AI vs AI Showcase mode settings (Commit 29) - speed multiplier and pause state.
 * Deliberately a separate, tiny store rather than folded into gameStore.ts: this
 * is UI/presentation-only, has zero effect outside Showcase mode, and keeping it
 * separate means simulate.ts and every store-logic test can go on never knowing
 * it exists.
 *
 * The multiplier is read by animationStore.ts (to scale ceremony/animation
 * durations) and by GameBoard.tsx's AI driver (to scale its own decision
 * timers) - both read it fresh via getState() rather than as a hook dependency
 * in most spots, since it only needs to affect *how long things take*, not
 * trigger extra re-renders on its own.
 */
export type ShowcaseSpeed = 'slow' | 'normal' | 'fast';

const SPEED_MULTIPLIER: Record<ShowcaseSpeed, number> = {
  slow: 1.75,
  normal: 1,
  fast: 0.5,
};

interface ShowcaseStoreState {
  active: boolean;
  speed: ShowcaseSpeed;
  paused: boolean;
  setSpeed: (speed: ShowcaseSpeed) => void;
  togglePaused: () => void;
  setActive: (active: boolean) => void;
}

export const useShowcaseStore = create<ShowcaseStoreState>((set) => ({
  active: false,
  speed: 'normal',
  paused: false,
  setSpeed: (speed) => set({ speed }),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  setActive: (active) => set({ active, paused: false }),
}));

/** Current multiplier - 1 whenever Showcase mode isn't active, so every duration
 *  calculation elsewhere can just multiply by this unconditionally without an
 *  extra "are we even in showcase mode" branch of its own. */
export function currentShowcaseMultiplier(): number {
  const s = useShowcaseStore.getState();
  return s.active ? SPEED_MULTIPLIER[s.speed] : 1;
}
