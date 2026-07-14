/**
 * Verifies the Commit 25 AI-pacing fix: the AI driver must not act while the game
 * is "in ceremony" (an action banner/animation window is still playing), and must
 * resume once it clears. Before this fix, the AI acted on a fixed 600-700ms timer
 * with zero awareness of the (separately, locally-queued) action banner, which
 * could show 2.6s per item - the AI would race several actions ahead of what the
 * banner was still explaining.
 *
 * This is useEffect-driven UI behavior living entirely in GameBoard.tsx, not
 * something a pure store-logic test can observe, so this uses the same jsdom +
 * react-dom/client mount approach the other DOM tests use.
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
// AudioContext doesn't exist in jsdom - stub it so AudioController/sfx.ts don't
// throw (they're already defensive, but this keeps the test's own console clean).
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
  const { useAnimationStore } = await import('@/store/animationStore');
  const { default: GameBoard } = await import('@/components/GameBoard');

  const store = useGameStore.getState();
  store.startNewGame('Dark White', 'Neon Underground', true); // Vs AI
  let s = useGameStore.getState();
  const p1 = s.openingApexSelectionPlayerId!;
  s.selectOpeningApex(p1, s.players[p1].hand.find((c) => c.type === 'Apex')!.instanceId);
  s = useGameStore.getState();
  // In Vs AI, the AI picks its own opening Apex automatically shortly after -
  // give it a moment, then confirm.
  await new Promise((r) => setTimeout(r, 700));
  s = useGameStore.getState();
  if (s.status === 'selectingOpeningApex') {
    const p2 = s.openingApexSelectionPlayerId!;
    s.selectOpeningApex(p2, s.players[p2].hand.find((c) => c.type === 'Apex')!.instanceId);
    s = useGameStore.getState();
  }

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 50));

  // Force it to be the AI's turn in Main phase - the most common moment the AI
  // driver would otherwise act on its own fixed timer.
  useGameStore.setState((st) => ({ ...st, activePlayerId: 'player2', phase: 'Combat', startPhasePending: false }));

  // Artificially hold a ceremony lock open, the same mechanism a real banner-
  // worthy event creates, and confirm the AI does not act while it's held.
  useAnimationStore.getState().markCeremonyBusy(5000);
  const logCountBeforeWait = useGameStore.getState().log.length;
  await new Promise((r) => setTimeout(r, 1200)); // well past the AI's normal 650ms decision timer
  const logCountWhileLocked = useGameStore.getState().log.length;
  check('AI takes no action while a ceremony lock is held (well past its normal decision timer)', logCountWhileLocked === logCountBeforeWait);

  // Let the lock expire naturally and confirm the AI resumes acting afterward.
  await new Promise((r) => setTimeout(r, 4500)); // remaining lock time + AI's own decision delay
  const logCountAfterUnlock = useGameStore.getState().log.length;
  check('AI resumes acting once the ceremony lock clears', logCountAfterUnlock > logCountWhileLocked);

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
