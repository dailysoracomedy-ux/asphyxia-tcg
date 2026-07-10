import { create } from 'zustand';

/** Just the current step index + open/closed - separate from gameStore.ts since
 *  this is presentation-only UI state, not something save/load or the AI ever
 *  needs to know about. Reset happens naturally whenever a new tutorial match
 *  starts (see TutorialPanel's mount effect). */
interface TutorialStoreState {
  step: number;
  setStep: (step: number) => void;
}

export const useTutorialStore = create<TutorialStoreState>((set) => ({
  step: 0,
  setStep: (step) => set({ step }),
}));
