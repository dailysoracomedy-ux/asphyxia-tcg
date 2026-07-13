import { create } from 'zustand';

/** Presentation-only tutorial UI state - separate from gameStore.ts since none
 *  of this is something save/load or the AI ever needs to know about.
 *
 *  Commit 31 - the tutorial's third major pivot. Commit 29.17 deliberately
 *  removed all real player interaction (a fully-scripted, Continue-only
 *  tutorial) specifically to eliminate a whole class of softlock/desync bugs.
 *  This commit deliberately reverses that, per direct request: the tutorial
 *  should feel like "the real game with training wheels on," which means
 *  real drag-and-drop, a real response window, a real Rift choice, and the
 *  real attack selector - not a slideshow of the game playing itself.
 *
 *  The guardrail this time isn't "remove all interaction," it's "narrow
 *  every interaction to exactly the one correct action for this step" -
 *  see tutorialSteps.ts's GuidedAction type and GameBoard.tsx's tutorialGate
 *  function, which is the single place every gated interaction point checks
 *  through, so there's one source of truth for "is this allowed right now"
 *  rather than the gating logic drifting across many call sites. */
interface TutorialStoreState {
  step: number;
  setStep: (step: number) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  /** Brief, friendly rejection text shown when the player interacts with the
   *  wrong card/zone/choice during a guided step - auto-clears itself after
   *  a few seconds (see GameBoard.tsx's helper-message effect), never
   *  blocks or pauses anything on its own. */
  helperMessage: string | null;
  setHelperMessage: (msg: string | null) => void;
  /** True while the "Learn the Essentials" intro slideshow is showing, before
   *  the actual tutorial match board exists at all. Distinct from `busy` -
   *  slideshow steps use their own Continue-driven navigation, not the
   *  guided-match step list. */
  slideshowActive: boolean;
  setSlideshowActive: (active: boolean) => void;
  slideIndex: number;
  setSlideIndex: (i: number) => void;
}

export const useTutorialStore = create<TutorialStoreState>((set) => ({
  step: 0,
  setStep: (step) => set({ step }),
  busy: false,
  setBusy: (busy) => set({ busy }),
  helperMessage: null,
  setHelperMessage: (helperMessage) => set({ helperMessage }),
  slideshowActive: true,
  setSlideshowActive: (slideshowActive) => set({ slideshowActive }),
  slideIndex: 0,
  setSlideIndex: (slideIndex) => set({ slideIndex }),
}));
