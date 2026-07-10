'use client';

import { useEffect, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useTutorialStore } from '@/store/tutorialStore';
import { TUTORIAL_STEPS } from '@/tutorial/tutorialSteps';
import type { GameState } from '@/types/game';

/** How long a "waitForOpponent" step will wait for its own autoAdvanceWhen
 *  condition before offering a manual way past it (Commit 29.3) - a direct
 *  response to a real report: the condition for one of these steps turned out to
 *  be stricter than intended, and the player was stuck with no way forward at
 *  all. This is the general-purpose fix for that entire class of problem, not
 *  just the one specific condition that was wrong - any future step whose
 *  detection heuristic has a similar gap fails safe instead of soft-locking. */
const WATCH_STEP_TIMEOUT_MS = 9000;

/**
 * Commit 29.1 rewrite: a locked, focused guidance panel, replacing 29's small
 * bottom-right floating panel with an optional Next button on every step (which,
 * reported correctly, gave "free reign... without even knowing the first thing to
 * do" - a player could just click Next repeatedly and skip past the actual
 * teaching). Now centered and prominent, and Next only appears on the passive
 * "read this and continue" steps - every action step only advances when the real
 * required action actually happens, enforced by GameBoard.tsx's
 * blockedByTutorial() gate on the input side and this panel's own
 * autoAdvanceWhen watch on the state side.
 *
 * Commit 29.3: two more fixes from real reports. First, "watch the opponent"
 * steps now surface the live, real Battle Log line as it happens underneath the
 * step's own explanation - directly linking the guidance text to the actual
 * action occurring, rather than one static paragraph the player has to
 * correlate with the board themselves. Second, those same steps get a
 * timeout-based "Continue" fallback (WatchStepFallback below) so a flawed
 * detection condition can never fully strand someone the way it did here.
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
  const isWatchStep = current?.requiredAction.type === 'waitForOpponent';

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
  const resolvedText = typeof current.text === 'function' ? current.text(state) : current.text;
  // Live sub-status for "watch" steps - just the most recent real log line,
  // computed directly during render (not stored/reactive state) so there's no
  // effect-based reset needed when the step changes.
  const liveLine = isWatchStep ? state.log[state.log.length - 1]?.message ?? null : null;

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

      {isWatchStep && (
        <div className="mb-3 px-2 py-1.5 rounded border border-white/10 bg-black/30 text-[11px] text-cyan-200 min-h-[28px] flex items-center">
          {liveLine ?? 'Waiting for the opponent...'}
        </div>
      )}

      {!isPassiveStep && !isWatchStep && (
        <div className="text-[10px] text-yellow-300/80 italic mb-2">
          &#9679; Follow the instruction above - other actions are locked during this step.
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            // Restart means a genuinely fresh tutorial match, not just resetting
            // the step counter back to 0 while every actual game state change so
            // far (Apex played, cards spent, Momentum, O2, hand contents) stays
            // exactly as it was - a real reported bug where "Restart" showed
            // Step 1's text again over a board that still reflected mid-tutorial
            // progress, completely mismatched with what that step expects.
            useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
            setStep(0);
          }}
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
        {/* Keyed by step, so remounting on every step change gives this its own
            fresh timer with no effect-based reset needed for the parent. */}
        {isWatchStep && <WatchStepFallback key={step} state={state} onContinue={() => setStep(Math.min(TUTORIAL_STEPS.length - 1, step + 1))} />}
      </div>
    </div>
  );
}

/** Isolated specifically so its `timedOut` state resets for free on every step
 *  change via the `key={step}` remount above, rather than needing an effect in
 *  the parent that explicitly resets it (which the stricter set-state-in-effect
 *  lint rule flags, correctly, as an anti-pattern - a fresh mount is the
 *  React-idiomatic way to get fresh state, not a manual reset call). */
function WatchStepFallback({ state, onContinue }: { state: GameState; onContinue: () => void }) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), WATCH_STEP_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  if (!timedOut) return null;
  return (
    <button
      type="button"
      onClick={onContinue}
      className="px-3 py-1.5 rounded border border-yellow-400/60 text-[11px] font-bold text-yellow-300 hover:bg-yellow-400/10"
      title={`Taking a while? Log so far: ${state.log.length} entries.`}
    >
      Continue anyway
    </button>
  );
}
