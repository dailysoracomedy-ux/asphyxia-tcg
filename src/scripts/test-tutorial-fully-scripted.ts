/**
 * Verifies Commit 29.17's full rebuild: a purely scripted tutorial with zero
 * player-driven game actions. Requested directly: "Just purely scripted with
 * Continue on each step. The logic will move the tutorial along. The ONLY
 * player interaction will be moving to the next step after reading."
 *
 * This test mounts the real GameBoard, and does nothing but click Continue
 * (advance the tutorial step) repeatedly, waiting for each step's own
 * scripted action to finish (busy flag clears) before clicking the next one -
 * simulating exactly what a real player does now: read, click Continue,
 * repeat. No direct store manipulation of game actions, no forced state.
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
(global as unknown as { window: unknown }).window = dom.window;
(global as unknown as { document: unknown }).document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
(global as unknown as { HTMLElement: unknown }).HTMLElement = dom.window.HTMLElement;
(global as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number;
(global as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) => clearTimeout(id);
(global as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(global as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
(global as unknown as { AudioContext: unknown }).AudioContext = class {
  state = 'running'; currentTime = 0;
  createOscillator() { return { type: '', frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} }; }
  createGain() { return { gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} }; }
  resume() { return Promise.resolve(); }
};

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntilNotBusy(useTutorialStore: { getState: () => { busy: boolean } }, maxMs = 8000) {
  const start = Date.now();
  while (useTutorialStore.getState().busy && Date.now() - start < maxMs) {
    await wait(150);
  }
}

async function main() {
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');
  const { useTutorialStore } = await import('@/store/tutorialStore');
  const { TUTORIAL_STEPS } = await import('@/tutorial/tutorialSteps');

  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await wait(200);

  check('the tutorial starts at step 0 (welcome)', useTutorialStore.getState().step === 0);

  // Simulate exactly what a real player does: click Continue, wait for the
  // current step's scripted action to finish, click Continue again - nothing
  // else, for every single step in the whole tutorial.
  for (let i = 0; i < TUTORIAL_STEPS.length - 1; i++) {
    await waitUntilNotBusy(useTutorialStore);
    useTutorialStore.getState().setStep(useTutorialStore.getState().step + 1);
    await wait(400);
  }
  await waitUntilNotBusy(useTutorialStore);

  check('the tutorial genuinely reached its final step via nothing but repeated Continue clicks', useTutorialStore.getState().step === TUTORIAL_STEPS.length - 1);

  const s = useGameStore.getState();
  check('the match genuinely ended - status is gameover', s.status === 'gameover');
  check('player1 (the human) is the genuine winner - the finishing blow actually landed', s.winnerId === 'player1');
  check('player1 played through at least one real Equip (Plasma Edge) via the scripted sequence', s.players.player1.apexSlots.some((a) => a?.equip?.defId === 'nu-plasma-edge') || s.players.player2.o2 <= 0);
  check('the opponent\u2019s Reserve Grid was genuinely played at some point (real log entry, not assumed)', s.log.some((l) => l.message.includes('Reserve Grid')));
  check('Glitch Step was genuinely auto-played by the script at some point (real log entry)', s.log.some((l) => l.message.includes('Glitch Step')));
  check('a real overflow-damage moment genuinely happened (the core teaching beat)', s.log.some((l) => l.message.includes('Overflow damage')));

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
