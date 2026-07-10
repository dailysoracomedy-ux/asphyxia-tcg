'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useTutorialStore } from '@/store/tutorialStore';
import { TUTORIAL_STEPS } from '@/tutorial/tutorialSteps';

/**
 * Commit 29.1 rewrite: a locked, focused guidance panel, replacing 29's small
 * bottom-right floating panel with an optional Next button on every step (which,
 * reported correctly, gave "free reign... without even knowing the first thing to
 * do" - a player could just click Next repeatedly and skip past the actual
 * teaching). Now centered and prominent, and Next only appears on the passive
 * "read this and continue" steps (welcome, momentum-reward explanation, apex-
 * recovery explanation) - every action step only advances when the real required
 * action actually happens, enforced by GameBoard.tsx's blockedByTutorial() gate
 * on the input side and this panel's own autoAdvanceWhen watch on the state side.
 */
export default function TutorialPanel() {
  const state = useGameStore();
  const step = useTutorialStore((s) => s.step);
  const setStep = useTutorialStore((s) => s.setStep);

  useEffect(() => {
    if (state.turnNumber <= 1 && state.status === 'selectingOpeningApex') setStep(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = TUTORIAL_STEPS[step];
  useEffect(() => {
    if (!current?.autoAdvanceWhen) return;
    if (current.autoAdvanceWhen(state) && step < TUTORIAL_STEPS.length - 1) {
      const t = setTimeout(() => setStep(step + 1), 1400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, step]);

  if (!current) return null;
  const isPassiveStep = current.requiredAction.type === 'ack';

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
      <div className="text-[12px] text-white/80 leading-relaxed mb-3">{current.text}</div>

      {!isPassiveStep && (
        <div className="text-[10px] text-yellow-300/80 italic mb-2">
          &#9679; Follow the instruction above - other actions are locked during this step.
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setStep(0)}
          className="px-2 py-1 rounded border border-white/15 text-[10px] text-white/50 hover:bg-white/10"
        >
          Restart
        </button>
        {isPassiveStep && (
          <button
            type="button"
            onClick={() => setStep(Math.min(TUTORIAL_STEPS.length - 1, step + 1))}
            className="px-3 py-1.5 rounded border border-emerald-400/60 text-[11px] font-bold text-emerald-300 hover:bg-emerald-400/10"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
