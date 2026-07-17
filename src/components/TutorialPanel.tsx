'use client';

import { useEffect } from 'react';
import { playSfx } from '@/audio/sfx';
import { useGameStore } from '@/store/gameStore';
import { useTutorialStore } from '@/store/tutorialStore';
import { TUTORIAL_STEPS } from '@/tutorial/tutorialSteps';

/**
 * Commit 31 - rebuilt for the guided-match architecture. A step now shows one
 * of two things: a Continue button (pure-explanation steps, `guided` absent -
 * e.g. "your opponent is about to attack"), or a live "waiting for your
 * action" indicator (guided steps - e.g. "drag the highlighted Apex") with NO
 * Continue button at all, since per spec a real gameplay action should never
 * be skippable via Continue. Auto-advance happens at the real action's own
 * success point (GameBoard.tsx's tutorialAdvance / ResponseModal.tsx's
 * inline advance calls), not here - this panel is purely a display of
 * whatever step is currently active, never a driver of it.
 */
let lastOnEnterStep = -1;

export default function TutorialPanel() {
  const state = useGameStore();
  const step = useTutorialStore((s) => s.step);
  const setStep = useTutorialStore((s) => s.setStep);
  const helperMessage = useTutorialStore((s) => s.helperMessage);

  useEffect(() => {
    if (state.turnNumber <= 1 && state.status === 'selectingOpeningApex') {
      lastOnEnterStep = -1;
      useTutorialStore.getState().setBusy(false);
      useTutorialStore.getState().setHelperMessage(null);
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

  // Helper messages are transient - clear themselves a couple seconds after
  // whatever set them, so a wrong-action message doesn't linger forever.
  useEffect(() => {
    if (!helperMessage) return;
    const t = setTimeout(() => useTutorialStore.getState().setHelperMessage(null), 2800);
    return () => clearTimeout(t);
  }, [helperMessage]);

  if (!current) return null;
  const resolvedText = typeof current.text === 'function' ? current.text(state) : current.text;
  const isLastStep = step >= TUTORIAL_STEPS.length - 1;
  const isGuided = !!current.guided;

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

      {helperMessage && (
        <div className="text-[11px] text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded px-2 py-1.5 mb-3">
          {helperMessage}
        </div>
      )}

      {isGuided && !helperMessage && (
        <div className="text-[10px] text-emerald-300/70 italic mb-2 animate-pulse">&#9679; Follow the glowing highlight</div>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
            lastOnEnterStep = -1;
            useTutorialStore.getState().setBusy(false);
            useTutorialStore.getState().setHelperMessage(null);
            useTutorialStore.getState().setSlideshowActive(true);
            useTutorialStore.getState().setSlideIndex(0);
            setStep(0);
          }}
          className="px-2 py-1 rounded border border-white/15 text-[10px] text-white/50 hover:bg-white/10"
        >
          Restart
        </button>
        {!isGuided && !isLastStep && (
          <button
            type="button"
            onClick={() => {
              playSfx('ui.confirm');
              setStep(step + 1);
            }}
            // Commit 47 - hand-made CONTINUE art (label baked in, sr-only for a11y).
            className="btn-art w-[180px] h-[44px] rounded animate-pulse hover:shadow-[0_0_14px_rgba(52,211,153,0.5)]"
            style={{ backgroundImage: 'url(/ui/continue-button.webp)' }}
          >
            <span className="sr-only">Continue</span>
          </button>
        )}
      </div>
    </div>
  );
}
