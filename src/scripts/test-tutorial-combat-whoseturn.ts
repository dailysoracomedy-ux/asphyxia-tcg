/**
 * Verifies Commit 29.11's fix for a real, reported softlock at the finishing
 * blow step - screenshot showed Turn 5, Main Phase, with the panel already
 * stuck on "Click Riot Runner to attack" (a combat-only step), with no way to
 * re-enter Combat Phase.
 *
 * Root cause: every "enter Combat" step's autoAdvanceWhen checked only
 * `phase === 'Combat'`, never whose turn it actually was. The opponent enters
 * their own Combat Phase every turn too - so the condition could become true
 * during the *opponent's* combat, wrongly auto-advancing the tutorial step
 * ahead of schedule. Once the opponent's turn ended and the game genuinely fell
 * back to Main Phase for the player's real turn, the tutorial was already
 * pointed at a combat-only step with no way back into Combat.
 *
 * Two fixes verified: the corrected condition itself, and a general safety net
 * (any combat-only step syncs back to the nearest "enter Combat" gate if the
 * game ever falls back to Main Phase) that protects against this entire class
 * of bug even if a future scripted step has a similar gap.
 */
import { TUTORIAL_STEPS } from '../tutorial/tutorialSteps';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

// --- The corrected condition itself ---
const combatEntrySteps = TUTORIAL_STEPS.filter((s) => s.requiredAction.type === 'advancePhase' && (s.requiredAction as { phase: string }).phase === 'Combat');
check('there are exactly the three expected "enter Combat" gates in the script', combatEntrySteps.length === 3);

for (const step of combatEntrySteps) {
  const duringOpponentCombat = { phase: 'Combat', activePlayerId: 'player2' } as never;
  const duringOwnCombat = { phase: 'Combat', activePlayerId: 'player1' } as never;
  check(`"${step.id}" does NOT satisfy its condition during the opponent's own Combat Phase (the actual bug)`, step.autoAdvanceWhen!(duringOpponentCombat) === false);
  check(`"${step.id}" DOES satisfy its condition during the player's own Combat Phase`, step.autoAdvanceWhen!(duringOwnCombat) === true);
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (part 1) ===`);

// --- The safety-net fallback, verified with a real mounted panel ---
async function behavioralCheck() {
  const { JSDOM } = await import('jsdom');
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
  (global as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
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

  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');
  const { useTutorialStore } = await import('@/store/tutorialStore');

  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 100));

  // Force the exact reported scenario: the tutorial pointed at a combat-only
  // step ("finishing-blow") while the game is genuinely in Main Phase - the
  // real softlock state from the screenshot.
  const finishingBlowIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'finishing-blow');
  useGameStore.setState({ phase: 'Main' });
  useTutorialStore.getState().setStep(finishingBlowIdx);
  await new Promise((r) => setTimeout(r, 300));

  const stepAfterSync = useTutorialStore.getState().step;
  const enterCombatFinalIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'enter-combat-final');
  check(
    'the safety net automatically steps back to the nearest "enter Combat" gate when a combat-only step is active but the game is in Main Phase',
    stepAfterSync === enterCombatFinalIdx
  );
  check('the panel now shows a real, clickable path forward (the Combat Phase button), not the unreachable attack instruction', container.innerHTML.includes('Enter Combat one more time'));

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (final) ===`);
  process.exit(failed > 0 ? 1 : 0);
}

behavioralCheck();
