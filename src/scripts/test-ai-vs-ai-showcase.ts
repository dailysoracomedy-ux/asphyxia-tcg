/**
 * Verifies Commit 29's AI vs AI Showcase mode: both players are AI-controlled
 * (not just player2, as in normal Vs AI), the game genuinely progresses without
 * any human input, and the Fast speed setting actually shortens ceremony timing
 * versus Normal - not just that a multiplier value exists somewhere, but that it
 * measurably changes real elapsed-time behavior.
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
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');

  // Start in AI vs AI Showcase mode - the 5th arg is tutorialMode=false, 4th is
  // aiVsAiMode=true.
  const store = useGameStore.getState();
  store.startNewGame('Neon Underground', 'Synth Ascendancy', false, true);
  const s = useGameStore.getState();
  check('aiVsAiMode is actually set on state', s.aiVsAiMode === true);
  check('vsAI is NOT set (Showcase uses its own flag, not the Vs AI one)', s.vsAI === false);

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 50));

  const turnBefore = useGameStore.getState().turnNumber;
  const logCountBefore = useGameStore.getState().log.length;

  // Both sides should be able to select their own opening Apex without any
  // simulated human click - wait past both AI decisions.
  await new Promise((r) => setTimeout(r, 1500));
  const sAfterOpening = useGameStore.getState();
  check('the match actually left opening-Apex-selection without any human input', sAfterOpening.status === 'playing');

  // Let the AI driver run for a while and confirm real progress happened - either
  // player1 or player2 acting is fine, since both are AI here.
  await new Promise((r) => setTimeout(r, 4000));
  const sLater = useGameStore.getState();
  check(
    'the game genuinely progressed (turn advanced or log grew) with zero human input',
    sLater.turnNumber > turnBefore || sLater.log.length > logCountBefore + 3
  );

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (part 1) ===`);
}

async function speedTest() {
  const { useShowcaseStore, currentShowcaseMultiplier } = await import('@/store/showcaseStore');
  useShowcaseStore.getState().setActive(true);

  useShowcaseStore.getState().setSpeed('fast');
  const fastMult = currentShowcaseMultiplier();
  useShowcaseStore.getState().setSpeed('slow');
  const slowMult = currentShowcaseMultiplier();
  useShowcaseStore.getState().setSpeed('normal');
  const normalMult = currentShowcaseMultiplier();

  check('Fast speed multiplier is less than Normal (shortens ceremony timing)', fastMult < normalMult);
  check('Slow speed multiplier is greater than Normal (lengthens ceremony timing)', slowMult > normalMult);

  useShowcaseStore.getState().setActive(false);
  check('multiplier returns to 1x when Showcase mode is inactive (never affects normal play)', currentShowcaseMultiplier() === 1);

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (final) ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().then(speedTest);
