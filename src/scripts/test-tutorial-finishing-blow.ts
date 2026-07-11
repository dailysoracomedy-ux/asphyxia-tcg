/**
 * Verifies Commit 29.10's three fixes, all stemming from one root-cause finding:
 *
 * 1. The actual root cause behind several reported problems: pure explanation
 *    (ack) steps never paused the underlying game - only the tutorial panel's
 *    own display waited for the player. The AI driver kept running in the
 *    background the whole time the player was still reading, so by the time
 *    they clicked Continue, the opponent could already be several actions into
 *    their next turn. This is what was actually behind "I can't attack to
 *    finish the game" - the scripted sequence's assumptions about opponent
 *    state were being invalidated by background AI action before the player
 *    ever got a chance to act on them.
 *
 * 2. Apex Recovery showing an unnecessary Continue button (a real, reported
 *    bug) and describing the rule abstractly rather than what actually
 *    happened - both fixed by making it a genuine auto-advancing step with
 *    dynamic, state-aware text.
 *
 * 3. A completely missing finishing sequence - the tutorial had no steps
 *    guiding the player to actually win, and no guarantee the numbers would
 *    ever line up for a lethal blow. Fixed with a real, guaranteed-lethal
 *    combat sequence using actual game math (Mob Charge + Plasma Edge vs a
 *    real 300-DEF Apex), not a scripted/fabricated outcome.
 */
import { useGameStore, tutorialEnsureFinishingBlow } from '../store/gameStore';
import { useShowcaseStore } from '../store/showcaseStore';
import { TUTORIAL_STEPS } from '../tutorial/tutorialSteps';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

// --- Fix 2: apex-recovery is no longer an ack step ---
const recoveryStep = TUTORIAL_STEPS.find((s) => s.id === 'apex-recovery')!;
check('apex-recovery is no longer an "ack" step (the actual fix for the reported unnecessary Continue button)', recoveryStep.requiredAction.type !== 'ack');
check('apex-recovery still has a real autoAdvanceWhen condition tied to the Apex actually appearing', typeof recoveryStep.autoAdvanceWhen === 'function');

// --- Fix 3: the finishing sequence exists and uses real, verified math ---
const finishStep = TUTORIAL_STEPS.find((s) => s.id === 'finishing-blow-choose')!;
check('the finishing blow requires a specific, verified-strong attack (Mob Charge), not "any"', finishStep.requiredAction.type === 'chooseAttack' && (finishStep.requiredAction as { attackId: string }).attackId === 'mob-charge');

useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
tutorialEnsureFinishingBlow();
let s = useGameStore.getState();
check('the finishing-blow guarantee sets the opponent to a low, real O2 value', s.players.player2.o2 === 2);
check('the finishing-blow guarantee places a real, named Apex (Pale Executioner, 300 DEF) as the target', s.players.player2.apexSlots[0]?.defId === 'dw-pale-executioner');

// Now actually verify the attack real players would make (Mob Charge, no other
// bonuses assumed) is genuinely lethal against this exact setup - proving the
// guarantee's own math claim, not just trusting the comment.
useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
s = useGameStore.getState();
if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
s = useGameStore.getState();
if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
s = useGameStore.getState();
s.playApexCard(s.players.player1.hand.find((c) => c.defId === 'nu-street-beast')!.instanceId);
s = useGameStore.getState();
s.playSupportCard(s.players.player1.hand.find((c) => c.defId === 'nu-dead-battery')!.instanceId);
s = useGameStore.getState();
// Simulate reaching the finishing-blow moment: Riot Runner with Plasma Edge
// equipped (matching the real script's earlier steps), Dead Battery for Sync.
useGameStore.setState((st) => {
  const riotRunner = { instanceId: 'test-riot-runner', defId: 'nu-riot-runner', type: 'Apex' as const, equip: { instanceId: 'test-plasma-edge', defId: 'nu-plasma-edge', type: 'Equip' as const } };
  return { players: { ...st.players, player1: { ...st.players.player1, apexSlots: [riotRunner, null] } } };
});
tutorialEnsureFinishingBlow();
s = useGameStore.getState();
s.advancePhase('Combat');
s = useGameStore.getState();
const attacker = s.players.player1.apexSlots.find(Boolean)!;
const target = s.players.player2.apexSlots.find(Boolean)!;
s.declareAttack(attacker.instanceId, 'mob-charge', target.instanceId);
s = useGameStore.getState();
check('the scripted finishing blow genuinely ends the match - status is gameover', s.status === 'gameover');
check('player1 (the human) is the actual winner, not the opponent', s.winnerId === 'player1');

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (part 1) ===`);

// --- Fix 1: the AI driver actually pauses during explanation steps ---
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

  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 100));

  const ackStepIndex = TUTORIAL_STEPS.findIndex((s) => s.id === 'momentum-reward');
  useTutorialStore.getState().setStep(ackStepIndex);
  await new Promise((r) => setTimeout(r, 400));
  check('the Showcase pause mechanism is actually active while an explanation step is showing', useShowcaseStore.getState().paused === true);

  const actionStepIndex = TUTORIAL_STEPS.findIndex((s) => s.id === 'play-engine');
  useTutorialStore.getState().setStep(actionStepIndex);
  await new Promise((r) => setTimeout(r, 400));
  check('the pause is released once the tutorial moves to a real action step', useShowcaseStore.getState().paused === false);

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (final) ===`);
  process.exit(failed > 0 ? 1 : 0);
}

behavioralCheck();
