/**
 * Verifies Commit 29.3's tutorial robustness fixes:
 * 1. The "opponent-overflow" step's autoAdvanceWhen no longer requires control to
 *    fully return to player1 - it fires the instant the Apex is actually
 *    destroyed, matching what was reported ("the opponent took the attack and
 *    nothing moved forward" - the destruction had already happened).
 * 2. Tutorial mode activates the same speed-scaling mechanism built for AI vs AI
 *    Showcase, so the opponent's turn is measurably slower/more watchable during
 *    a tutorial match than during a normal match.
 * 3. A "watch the opponent" step that never satisfies its own condition (a stand-
 *    in for any future undetected edge case, not just the one already fixed)
 *    still offers a way forward after a timeout, rather than truly soft-locking.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
(global as unknown as { window: unknown }).window = dom.window;
(global as unknown as { document: unknown }).document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
(global as unknown as { HTMLElement: unknown }).HTMLElement = dom.window.HTMLElement;
(global as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number;
(global as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) => clearTimeout(id);
(global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
(global as unknown as { matchMedia: unknown }).matchMedia = () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
});
(global as unknown as { AudioContext: unknown }).AudioContext = class {
  state = 'running';
  currentTime = 0;
  createOscillator() {
    return { type: '', frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} };
  }
  createGain() {
    return {
      gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: () => {},
    };
  }
  resume() {
    return Promise.resolve();
  }
};

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

async function main() {
  const { TUTORIAL_STEPS } = await import('@/tutorial/tutorialSteps');

  // --- Fix 1: the corrected condition ---
  const overflowStep = TUTORIAL_STEPS.find((s) => s.id === 'opponent-overflow')!;
  const noApex = { players: { player1: { apexSlots: [null, null] } }, activePlayerId: 'player2' } as never;
  check(
    'opponent-overflow advances the instant the Apex is gone, even mid-opponent-turn (the exact reported bug)',
    overflowStep.autoAdvanceWhen!(noApex) === true
  );
  const stillHasApex = { players: { player1: { apexSlots: [{ instanceId: 'x' }, null] } }, activePlayerId: 'player1' } as never;
  check('opponent-overflow correctly does NOT advance while the Apex is still alive', overflowStep.autoAdvanceWhen!(stillHasApex) === false);

  // --- Fix 2: tutorial pacing reuses the Showcase speed mechanism ---
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');
  const { useShowcaseStore, currentShowcaseMultiplier } = await import('@/store/showcaseStore');
  const { TUTORIAL_PACING_MULTIPLIER } = await import('@/tutorial/tutorialSteps');

  check('multiplier is 1x before any tutorial/showcase match starts', currentShowcaseMultiplier() === 1);

  useGameStore.getState().startNewGame('Synth Ascendancy', 'Synth Ascendancy', false, false, true);
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 500));

  check(
    'entering a tutorial match activates the speed-scaling mechanism at the tutorial-specific multiplier',
    currentShowcaseMultiplier() === TUTORIAL_PACING_MULTIPLIER
  );
  check('the tutorial multiplier is meaningfully slower than a normal match (addresses "opponent attacked too fast")', TUTORIAL_PACING_MULTIPLIER > 2);

  root.unmount();
  await new Promise((r) => setTimeout(r, 30));
  check('leaving the tutorial match (unmount) hands the multiplier back to 1x - never leaks into normal play', currentShowcaseMultiplier() === 1);
  useShowcaseStore.getState().setActive(false); // clean slate for the next check

  // --- Fix 3: timeout fallback for watch steps that never satisfy their condition ---
  useGameStore.getState().startNewGame('Synth Ascendancy', 'Synth Ascendancy', false, false, true);
  const root2 = createRoot(container as unknown as Element);
  root2.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 80));

  const { useTutorialStore } = await import('@/store/tutorialStore');
  const watchStepIndex = TUTORIAL_STEPS.findIndex((s) => s.id === 'opponent-overflow');
  // Pause the AI driver (reuses the same Showcase-mode pause gate) and
  // explicitly guarantee player1 still has an Apex, forcing this step's own
  // condition to stay false for the whole wait - simply pausing wasn't enough
  // on its own, since the AI had already destroyed the Apex naturally in the
  // brief real playthrough before the pause took effect, letting the step
  // advance through its own legitimate path before the timeout ever got a
  // chance to matter (a flaw in this test's first draft, not the product).
  useShowcaseStore.getState().togglePaused();
  useGameStore.setState((st) => {
    const p1 = { ...st.players.player1 };
    p1.apexSlots = [{ instanceId: 'forced-test-apex', defId: 'nu-street-beast' } as never, null];
    return { players: { ...st.players, player1: p1 } };
  });
  useTutorialStore.getState().setStep(watchStepIndex);
  await new Promise((r) => setTimeout(r, 100));
  const htmlBeforeTimeout = container.innerHTML;
  check('the watch step is actually showing (test setup sanity check)', htmlBeforeTimeout.includes('Watch: overflow damage'));
  check('no "Continue anyway" fallback shows immediately on a watch step (would defeat waiting for the real thing)', !htmlBeforeTimeout.includes('Continue anyway'));

  await new Promise((r) => setTimeout(r, 9300)); // past WATCH_STEP_TIMEOUT_MS (9000ms)
  const htmlAfterTimeout = container.innerHTML;
  check('a "Continue anyway" fallback appears once a watch step has genuinely been stuck for a while', htmlAfterTimeout.includes('Continue anyway'));

  root2.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
