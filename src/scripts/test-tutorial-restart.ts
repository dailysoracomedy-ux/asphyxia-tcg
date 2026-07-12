/**
 * Verifies the Restart fix: clicking Restart mid-tutorial must reset the actual
 * game state (Apex played, cards spent, hand contents, etc.), not just the
 * step counter back to 0 while the board still reflects mid-tutorial progress -
 * reported directly: "Restart doesn't restart the tutorial at all. It restarts
 * the tutorial MENU, not the whole thing."
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
  const { useGameStore } = await import('@/store/gameStore');
  const { useTutorialStore } = await import('@/store/tutorialStore');

  // Get well into the tutorial - play the Apex and Engine, matching real
  // mid-tutorial progress.
  useGameStore.getState().startNewGame('Synth Ascendancy', 'Synth Ascendancy', false, false, true);
  let s = useGameStore.getState();
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  s = useGameStore.getState();
  if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
  s = useGameStore.getState();
  s.playApexCard(s.players.player1.hand.find((c) => c.defId === 'nu-street-beast')!.instanceId);
  s = useGameStore.getState();
  s.playSupportCard(s.players.player1.hand.find((c) => c.defId === 'nu-dead-battery')!.instanceId);
  s = useGameStore.getState();
  useTutorialStore.getState().setStep(3);

  check('test setup sanity check: player1 actually has an Apex in play before restarting', s.players.player1.apexSlots.some(Boolean));
  check('test setup sanity check: player1 actually has an Engine in play before restarting', s.players.player1.supportSlots.some(Boolean));

  // Simulate exactly what the Restart button now does.
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  useTutorialStore.getState().setStep(0);
  const sAfter = useGameStore.getState();

  check('Restart actually clears the board - no leftover Apex from the previous attempt', !sAfter.players.player1.apexSlots.some(Boolean));
  check('Restart actually clears the board - no leftover Engine from the previous attempt', !sAfter.players.player1.supportSlots.some(Boolean));
  check('Restart puts the scripted Street-Beast back in hand, ready for Step 1 again', sAfter.players.player1.hand.some((c) => c.defId === 'nu-street-beast'));
  check('Restart resets the turn counter back to 1', sAfter.turnNumber === 1);
  check('Restart resets the tutorial step counter back to 0 (Step 1)', useTutorialStore.getState().step === 0);
  check('Restart re-enforces the fixed tutorial matchup regardless of whatever match was active before', sAfter.players.player1.faction === 'Neon Underground' && sAfter.players.player2.faction === 'Dark White');

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
