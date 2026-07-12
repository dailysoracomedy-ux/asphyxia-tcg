'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useTutorialStore } from '@/store/tutorialStore';
import { TUTORIAL_STEPS } from '@/tutorial/tutorialSteps';

/**
 * Commit 29.17 - a drastically simplified panel matching the tutorial's second
 * pivot: purely scripted, zero player-driven game actions anywhere. Every step
 * shows the same three things - a title, an explanation of what the code just
 * did (or is about to do), and a Continue button - because there is nothing
 * left to gate, highlight, or wait on except the scripted action's own async
 * completion (tracked by `busy` in tutorialStore.ts, set by
 * tutorialRunFullyScriptedTurn/tutorialRunScriptedOpponentTurn in
 * gameStore.ts). No requiredAction types, no highlight targets, no watch-step
 * timeout fallback, no phase-safety-net - none of it has anything left to do,
 * since there's no player click for any of that machinery to react to anymore.
 */
// Module-level, not component state or a ref - deliberately survives a
// component remount, which a ref or useState would not. onEnter must never
// fire twice for the same step: several steps chain multiple async
// sub-sequences together (see tutorialSteps.ts's 'opponent-turn-2'), and a
// double-fire would start two competing copies of the same chain, racing each
// other over the same pending response.
let lastOnEnterStep = -1;

export default function TutorialPanel() {
  const state = useGameStore();
  const step = useTutorialStore((s) => s.step);
  const setStep = useTutorialStore((s) => s.setStep);
  const busy = useTutorialStore((s) => s.busy);

  useEffect(() => {
    if (state.turnNumber <= 1 && state.status === 'selectingOpeningApex') {
      lastOnEnterStep = -1;
      useTutorialStore.getState().setBusy(false);
      setStep(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = TUTORIAL_STEPS[step];

  useEffect(() => {
    if (lastOnEnterStep === step) return;
    lastOnEnterStep = step;
    current?.onEnter?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (!current) return null;
  const resolvedText = typeof current.text === 'function' ? current.text(state) : current.text;
  const isLastStep = step >= TUTORIAL_STEPS.length - 1;

  return (
    <div className="fixed top-1/2 left-3 -translate-y-1/2 z-40 w-80 max-w-[calc(100vw-24px)] rounded-lg border-2 border-emerald-400/60 bg-[#05050af5] p-4 shadow-[0_0_30px_rgba(52,211,153,0.3)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-emerald-300/80 font-bold">
          Learn To Play &middot; Step {step + 1} / {TUTORIAL_STEPS.length}
        </span>
        <button
          type="button"
          onClick={() => useGameStore.getState().resetToMenu()}
          className="text-[10px] text-white/40 hover:text-white/70 underline"
        >
          Exit
        </button>
      </div>

      <div className="text-base font-bold text-emerald-200 mb-1.5">{current.title}</div>
      <div className="text-[12px] text-white/80 leading-relaxed mb-3">{resolvedText}</div>

      {busy && (
        <div className="text-[10px] text-cyan-300/80 italic mb-2 animate-pulse">&#9679; Playing this out...</div>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            // Restart means a genuinely fresh tutorial match, not just resetting
            // the step counter back to 0 while every actual game state change so
            // far stays exactly as it was. Also explicitly clears `busy` -
            // real, reported bug: if Restart was clicked while a scripted
            // sequence's own setTimeout chain was still in flight, that stale
            // chain could still be the last thing to touch `busy`, leaving
            // Continue stuck disabled ("Playing this out...") against a match
            // that had, in fact, already restarted clean.
            useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
            lastOnEnterStep = -1;
            useTutorialStore.getState().setBusy(false);
            setStep(0);
          }}
          className="px-2 py-1 rounded border border-white/15 text-[10px] text-white/50 hover:bg-white/10"
        >
          Restart
        </button>
        {!isLastStep && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setStep(step + 1)}
            className={`px-3 py-1.5 rounded border text-[11px] font-bold ${
              busy
                ? 'border-white/10 text-white/30 cursor-not-allowed'
                : 'border-emerald-400/60 text-emerald-300 hover:bg-emerald-400/10 animate-pulse'
            }`}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
