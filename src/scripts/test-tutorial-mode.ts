/**
 * Verifies Commit 29's Learn To Play tutorial mode: the fixed Neon Underground vs
 * Dark White matchup is actually enforced regardless of what factions were passed
 * in, player1's scripted opening hand genuinely contains the card types the
 * tutorial script references (an Engine and an Equip, so steps 3-4 aren't stuck
 * waiting on a draw that might not come for several turns), and the tutorial panel
 * actually renders and can advance - not just that step data exists somewhere.
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

  // Deliberately pass DIFFERENT factions than the tutorial should actually use -
  // confirms the fixed matchup is really enforced, not just the default choice.
  const store = useGameStore.getState();
  store.startNewGame('Synth Ascendancy', 'Synth Ascendancy', false, false, true);
  const s = useGameStore.getState();

  check('tutorialMode is actually set on state', s.tutorialMode === true);
  check('the matchup is forced to Neon Underground vs Dark White regardless of what was passed in', s.players.player1.faction === 'Neon Underground' && s.players.player2.faction === 'Dark White');
  check('vsAI is forced on (tutorial is always played against the AI)', s.vsAI === true);

  const hand = s.players.player1.hand;
  check('the scripted opening hand actually contains an Apex (needed for opening selection)', hand.some((c) => c.type === 'Apex'));
  check('the scripted opening hand actually contains an Engine (Battery or Ability Support)', hand.some((c) => c.type === 'BatterySupport' || c.type === 'AbilitySupport'));
  check('the scripted opening hand actually contains an Equip (Smog Jacket)', hand.some((c) => c.type === 'Equip'));

  const { useTutorialStore } = await import('@/store/tutorialStore');
  // Commit 31 - the intro slideshow renders first now, by design, and blocks
  // the match board until dismissed. Skip past it here since this test is
  // specifically about the match-board panel, not the slideshow itself
  // (which has its own coverage - see test-tutorial-slideshow.ts).
  useTutorialStore.getState().setSlideshowActive(false);

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 80));

  const html1 = container.innerHTML;
  check('the tutorial panel actually renders during opening Apex selection', html1.includes('Learn To Play') && html1.includes('Step 1'));

  useTutorialStore.getState().setStep(3);
  await new Promise((r) => setTimeout(r, 150));
  const html2 = container.innerHTML;
  check('the panel actually reflects a step change (not stuck rendering step 1 forever)', html2.includes('Step 4'));

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
