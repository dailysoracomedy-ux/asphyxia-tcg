import { create } from 'zustand';

/** Just the current step index + open/closed - separate from gameStore.ts since
 *  this is presentation-only UI state, not something save/load or the AI ever
 *  needs to know about. Reset happens naturally whenever a new tutorial match
 *  starts (see TutorialPanel's mount effect).
 *
 *  Commit 29.17 adds `busy`: every tutorial step's scripted action now runs
 *  asynchronously (a setTimeout chain in gameStore.ts, since it may need to
 *  wait for a turn to actually change hands or a phase to actually advance).
 *  Continue needs to stay disabled for that whole span, not just show up the
 *  instant the step's text renders - otherwise the player could click through
 *  to the next step before the current one's action has actually finished. */
interface TutorialStoreState {
  step: number;
  setStep: (step: number) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}

export const useTutorialStore = create<TutorialStoreState>((set) => ({
  step: 0,
  setStep: (step) => set({ step }),
  busy: false,
  setBusy: (busy) => set({ busy }),
}));
