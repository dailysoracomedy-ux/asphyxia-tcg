/**
 * Verifies Commit 29.9's two fixes:
 *
 * 1. The actual Glitch Step / React timing bug. Confirmed by direct testing
 *    before writing any fix: the response window for the scripted React step
 *    only opens if Glitch Step is actually eligible, which requires at least 1
 *    Momentum - and Momentum by that point in the tutorial depends on which
 *    free Rift choice the player made a few steps earlier (+1 Momentum vs +100
 *    damage). Picking damage leaves Momentum at 0, Glitch Step becomes
 *    ineligible, no response window opens, and the attack just resolves -
 *    exactly what was reported. This test deliberately forces that exact 0-
 *    Momentum scenario, then confirms the new onEnter guarantee fixes it.
 *
 * 2. Action steps now auto-advance on their own after a short, fixed delay once
 *    their condition is met - no Continue button - while pure explanation-only
 *    steps still require an explicit click. Reconciles 29.8 (which removed all
 *    auto-advance) with this commit's "don't make me click Continue after every
 *    single action."
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
  const { useGameStore, tutorialEnsureReactReady } = await import('@/store/gameStore');

  // --- Fix 1: force the exact 0-Momentum, no-Glitch-Step scenario that caused
  //     the reported bug, then confirm the guarantee actually fixes it. ---
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  useGameStore.setState((st) => ({
    players: {
      ...st.players,
      player1: {
        ...st.players.player1,
        momentum: 0,
        hand: st.players.player1.hand.filter((c) => c.defId !== 'nu-glitch-step'),
      },
    },
  }));
  let s = useGameStore.getState();
  check('test setup: player1 genuinely has 0 Momentum (the exact scenario that broke the React step)', s.players.player1.momentum === 0);
  check('test setup: player1 genuinely has no Glitch Step in hand', !s.players.player1.hand.some((c) => c.defId === 'nu-glitch-step'));

  tutorialEnsureReactReady();
  s = useGameStore.getState();
  check('after the guarantee, player1 has at least 1 Momentum (enough for Glitch Step)', s.players.player1.momentum >= 1);
  check('after the guarantee, Glitch Step is actually in hand', s.players.player1.hand.some((c) => c.defId === 'nu-glitch-step'));

  // Confirm this is a no-op when everything is already fine - shouldn't grant
  // free extra Momentum or duplicate the card if the player already has both.
  useGameStore.setState((st) => ({ players: { ...st.players, player1: { ...st.players.player1, momentum: 3 } } }));
  tutorialEnsureReactReady();
  s = useGameStore.getState();
  check('the guarantee never reduces existing Momentum if the player already has plenty', s.players.player1.momentum === 3);
  check('the guarantee never duplicates Glitch Step if one is already in hand', s.players.player1.hand.filter((c) => c.defId === 'nu-glitch-step').length === 1);

  // Confirm this is a genuine no-op outside tutorial mode.
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, false);
  const beforeNormalMomentum = useGameStore.getState().players.player1.momentum;
  tutorialEnsureReactReady();
  const afterNormalMomentum = useGameStore.getState().players.player1.momentum;
  check('the guarantee is a complete no-op outside tutorial mode - never touches normal play', beforeNormalMomentum === afterNormalMomentum);

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (part 1) ===`);
  await behavioralCheck();
}

async function behavioralCheck() {
  const { useGameStore } = await import('@/store/gameStore');
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { default: GameBoard } = await import('@/components/GameBoard');
  const { useTutorialStore } = await import('@/store/tutorialStore');

  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  let s = useGameStore.getState();
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  s = useGameStore.getState();
  if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
  s = useGameStore.getState();

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 150));

  // --- Fix 2: action steps auto-advance with no Continue button ---
  useTutorialStore.getState().setStep(1); // play-apex
  useGameStore.getState().playApexCard(useGameStore.getState().players.player1.hand.find((c) => c.defId === 'nu-street-beast')!.instanceId);
  await new Promise((r) => setTimeout(r, 100));
  const htmlRightAfter = container.innerHTML;
  check('no Continue button appears on an action step even once its condition is met', !htmlRightAfter.includes('>Continue<'));

  await new Promise((r) => setTimeout(r, 600));
  const stepAfterDelay = useTutorialStore.getState().step;
  check('the action step auto-advances on its own after the short delay - no click required', stepAfterDelay === 2);

  // --- Confirm explanation-only (ack) steps still require a click ---
  useTutorialStore.getState().setStep(0); // welcome - an ack step
  await new Promise((r) => setTimeout(r, 100));
  const htmlOnAckStep = container.innerHTML;
  check('a pure explanation-only step still shows a Continue button', htmlOnAckStep.includes('>Continue<'));
  await new Promise((r) => setTimeout(r, 700));
  const stepAfterWaitingOnAck = useTutorialStore.getState().step;
  check('an explanation-only step genuinely never auto-advances on its own, even after a long wait', stepAfterWaitingOnAck === 0);

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (final) ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
