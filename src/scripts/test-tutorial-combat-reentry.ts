/**
 * Verifies Commit 29.8's two fixes:
 *
 * 1. A real missing step: the sequence went from playing a Special straight to
 *    expecting an attacker selection, with no step in between actually gating
 *    "re-enter Combat Phase" - so the Combat Phase button itself was blocked by
 *    the tutorial's own gate (didn't match the active step's required action),
 *    even though that step's own text said "Enter Combat." Reported directly,
 *    with a screenshot showing the exact stuck state: Main Phase, Combat Phase
 *    button visibly disabled, Step 13 asking for an attack that was impossible
 *    to reach.
 *
 * 2. No step ever auto-advances on its own anymore - every transition requires
 *    an explicit Continue click, even after a step's condition becomes true.
 *    Previously a 1.4s timer fired automatically; reported directly as "sped
 *    through" without giving the player control over the pace.
 */
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { useGameStore } from '../store/gameStore';
import { tutorialActionMatches } from '../tutorial/tutorialGate';
import { TUTORIAL_STEPS } from '../tutorial/tutorialSteps';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

// --- Fix 1: the missing combat-re-entry step exists and is correctly gated ---
const specialIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'play-special');
const nextStep = TUTORIAL_STEPS[specialIdx + 1];
check('a real step now exists immediately after "play a Special" (not skipping straight to attacker selection)', !!nextStep);
check('that step is specifically "enter Combat Phase again", the actual missing gate', nextStep?.id === 'enter-combat-again');
check(
  "that step's required action is actually advancePhase Combat, not selectAttacker (the literal bug: text said 'Enter Combat' but the gate expected something else)",
  nextStep?.requiredAction.type === 'advancePhase'
);
check(
  'clicking the Combat Phase button at that exact step now genuinely matches and is allowed (this was blocked before)',
  nextStep!.requiredAction.type === 'advancePhase' &&
    tutorialActionMatches({ type: 'advancePhase', phase: 'Combat' }, nextStep!.requiredAction)
);
const buffedAttackStep = TUTORIAL_STEPS.find((s) => s.id === 'buffed-attack');
check(
  "the buffed-attack step's own text no longer claims to also handle entering Combat (that's the new step's job now)",
  !(typeof buffedAttackStep!.text === 'string' ? buffedAttackStep!.text : '').toLowerCase().includes('enter combat')
);

// --- Fix 2: no step advances without an explicit Continue click ---
useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
let s = useGameStore.getState();
if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
s = useGameStore.getState();
if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
s = useGameStore.getState();

// Play Street-Beast - Step 2's (index 1) autoAdvanceWhen condition becomes true
// the instant this succeeds. Confirm the underlying condition really is
// satisfied, but that nothing in this file (or TutorialPanel itself) ever
// advances the step index without a click - there is no timer left to fire.
s.playApexCard(s.players.player1.hand.find((c) => c.defId === 'nu-street-beast')!.instanceId);
s = useGameStore.getState();
const playApexStep = TUTORIAL_STEPS.find((step) => step.id === 'play-apex')!;
check("play-apex's own condition genuinely becomes true once Street-Beast is played (test setup sanity check)", playApexStep.autoAdvanceWhen!(s) === true);

// Wait past where the old 1.4s timer would have fired, then confirm no
// mechanism anywhere advances a step on its own - this is a structural
// property of the rewritten panel (no setTimeout-based step advance exists in
// it at all anymore), verified here by confirming the panel's source doesn't
// contain the old auto-advance timer pattern.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const panelSource = fs.readFileSync(join(__dirname, '../components/TutorialPanel.tsx'), 'utf-8');
check(
  'the panel source no longer contains any timer that advances the step on its own (structural check, not just behavioral)',
  !/setTimeout\(\(\) => setStep\(step \+ 1\)/.test(panelSource)
);
check('the panel source still computes conditionMet as a plain derived value, not stored/effect-driven state', panelSource.includes('const conditionMet ='));

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (part 1) ===`);

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
  const { default: GameBoard } = await import('@/components/GameBoard');
  const { useTutorialStore } = await import('@/store/tutorialStore');

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 100));

  useTutorialStore.getState().setStep(1); // play-apex - already satisfied above
  await new Promise((r) => setTimeout(r, 100));
  const stepRightAfter = useTutorialStore.getState().step;
  check('Continue button appears once the condition is genuinely met', container.innerHTML.includes('>Continue<'));

  // Wait well past where the old 1.4s auto-advance timer would have fired.
  await new Promise((r) => setTimeout(r, 2000));
  const stepAfterWaiting = useTutorialStore.getState().step;
  check(
    'the step index genuinely never changed on its own during that wait - real behavioral confirmation, not just reading the source',
    stepAfterWaiting === stepRightAfter
  );

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (final) ===`);
  process.exit(failed > 0 ? 1 : 0);
}

behavioralCheck();
