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
 * Commit 29.9 rework - two more real, reported problems, and a design
 * reconciliation between them. 29.8 removed all auto-advance timers entirely in
 * response to "the tutorial sped through" - but that meant even simple action
 * steps (play this exact card, already fully validated) now demanded an extra
 * click just to move on, which is its own kind of friction the tutorial
 * shouldn't have. The actual complaint in 29.8 was about the *old* mechanism -
 * a flat 1.4s timer on every step regardless of type, racing ahead of whatever
 * the player was still reading. The fix here is narrower and specific to what
 * this commit calls for: action steps (play a card, choose an attack, declare a
 * target - anything with a concrete, already-validated action) auto-advance on
 * their own after a brief, purely visual pause (SHORT_ADVANCE_DELAY_MS) once
 * their condition is met - no Continue button, nothing to click. Pure
 * explanation-only steps (ack type - no action to perform, more to actually
 * read) still require an explicit Continue, since there's no action for the
 * game to detect completion of. The player's own pace only matters where
 * there's something to read; where there's only something to click, the game
 * gets out of the way.
 */
const SHORT_ADVANCE_DELAY_MS = 450;

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
 * Commit 29.7: the Civil War/Human Error Rift choices open a response window for
 * the player that blocks all further phase advancement until resolved -
 * completely normal, correct behavior. But the tutorial had no awareness of it,
 * silently showing stale step text while an unexplained popup blocked
 * everything. Watches for it reactively and overrides the panel's content the
 * instant it's relevant, since exactly when (or whether) it triggers depends on
 * combat that already happened, not a fixed point in the sequence.
 *
 * Commit 29.8: a real missing step (see tutorialSteps.ts, 'enter-combat-again')
 * and the removal of the old flat 1.4s auto-advance timer.
 *
 * Commit 29.9: see SHORT_ADVANCE_DELAY_MS above for the auto-advance design.
 * Also fixes a real, confirmed bug in the React/Glitch Step step - traced
 * directly (not assumed) to Momentum sometimes legitimately being 0 by that
 * point, depending on which Rift bonus the player freely chose earlier, which
 * meant Glitch Step was never eligible and the response window never opened at
 * all. See tutorialEnsureReactReady() in gameStore.ts for the actual fix.
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
  const isPassiveStep = current?.requiredAction.type === 'ack';

  // Commit 29.9 - state-safety guarantees (the actual fix for the reported
  // Glitch Step timing bug) fire here, once, the instant the step becomes
  // active - before the opponent's next turn (and its scripted-ish attack) ever
  // starts, not after something's already gone wrong.
  useEffect(() => {
    current?.onEnter?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Purely a derived value, computed fresh every render - never a stored/effect-
  // driven flag, and specifically never anything that advances the step on its
  // own by itself. What DOES advance the step, for action steps specifically,
  // is the short, fixed-delay effect right below - deliberately not the same
  // mechanism 29.8 removed (that one fired regardless of step type, with a
  // longer delay, and gave a Continue button no purpose once it fired anyway).
  const conditionMet = !!current?.autoAdvanceWhen && current.autoAdvanceWhen(state);

  useEffect(() => {
    if (isPassiveStep || !conditionMet || step >= TUTORIAL_STEPS.length - 1) return;
    const t = setTimeout(() => setStep(step + 1), SHORT_ADVANCE_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionMet, isPassiveStep, step]);

  // A pending Rift choice belonging to the player overrides everything else -
  // it's genuinely blocking the game regardless of what step the tutorial
  // thinks it's on, so the guidance has to reflect what's actually happening
  // right now, not what was scripted to happen next.
  const pendingRiftChoice = state.pendingResponseQueue.find(
    (item) => (item.stage === 'civilWarChoice' || item.stage === 'humanErrorChoice') && item.playerId === 'player1'
  );

  if (!current) return null;
  const resolvedText = typeof current.text === 'function' ? current.text(state) : current.text;
  // Live sub-status for "watch" steps - just the most recent real log line,
  // computed directly during render (not stored/reactive state) so there's no
  // effect-based reset needed when the step changes.
  const liveLine = isWatchStep ? state.log[state.log.length - 1]?.message ?? null : null;
  // Continue only ever shows for the true explanation-only steps now - action
  // steps advance on their own via the short-delay effect above, matching "no
  // Continue button on gameplay-action steps."
  const canContinue = !pendingRiftChoice && isPassiveStep;

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

      {pendingRiftChoice ? (
        <>
          <div className="text-base font-bold text-fuchsia-300 mb-1.5">A Rift Choice appeared!</div>
          <div className="text-[12px] text-white/80 leading-relaxed mb-3">
            The Rift Space just opened a popup asking you to choose between +1 Momentum or a damage bonus for your next
            attack. This can happen any time you fall behind on O2 - make your pick in that popup to continue. Your
            tutorial step will pick back up right where it left off once you&rsquo;ve chosen.
          </div>
        </>
      ) : (
        <>
          <div className="text-base font-bold text-emerald-200 mb-1.5">{current.title}</div>
          <div className="text-[12px] text-white/80 leading-relaxed mb-3">{resolvedText}</div>
        </>
      )}

      {!pendingRiftChoice && isWatchStep && (
        <div className="mb-3 px-2 py-1.5 rounded border border-white/10 bg-black/30 text-[11px] text-cyan-200 min-h-[28px] flex items-center">
          {liveLine ?? 'Waiting for the opponent...'}
        </div>
      )}

      {!pendingRiftChoice && conditionMet && !isPassiveStep && (
        <div className="text-[11px] text-emerald-300/90 font-bold mb-2">&#10003; Nice - moving on...</div>
      )}
      {!pendingRiftChoice && !conditionMet && !isPassiveStep && (
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
        {canContinue && (
          <button
            type="button"
            onClick={() => setStep(Math.min(TUTORIAL_STEPS.length - 1, step + 1))}
            className="px-3 py-1.5 rounded border border-emerald-400/60 text-[11px] font-bold text-emerald-300 hover:bg-emerald-400/10 animate-pulse"
          >
            Continue
          </button>
        )}
        {/* Only while genuinely still waiting on the opponent - once conditionMet
            flips true, the short-delay auto-advance effect takes over instead.
            Keyed by step, so remounting on every step change gives this its own
            fresh timer with no effect-based reset needed for the parent. */}
        {isWatchStep && !pendingRiftChoice && !conditionMet && (
          <WatchStepFallback key={step} state={state} onContinue={() => setStep(Math.min(TUTORIAL_STEPS.length - 1, step + 1))} />
        )}
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
