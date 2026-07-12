/**
 * Verifies Commit 30.3's three new tutorial demonstration steps, added per
 * request to show each card type's drag/drop interaction - especially
 * Engine chain/unchain and Equip swap, which aren't covered by the earlier
 * steps in the walkthrough.
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

  const chainIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'engine-chain-demo');
  const unchainIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'engine-unchain-demo');
  const swapIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'equip-swap-demo');
  check('all three new steps genuinely exist in the step list', chainIdx !== -1 && unchainIdx !== -1 && swapIdx !== -1);

  // Advance through every step up to (not including) the chain demo, exactly
  // as a real player clicking Continue would.
  for (let i = 0; i < chainIdx; i++) {
    await waitUntilNotBusy(useTutorialStore);
    useTutorialStore.getState().setStep(useTutorialStore.getState().step + 1);
    await wait(400);
  }
  await waitUntilNotBusy(useTutorialStore);
  await wait(500);
  let s = useGameStore.getState();
  check('the chain demo genuinely played Juice-Box chained to the Apex', s.players.player1.supportSlots.some((sl) => sl?.defId === 'nu-juice-box' && !!sl.chainedApexId));

  useTutorialStore.getState().setStep(unchainIdx);
  await wait(300);
  await waitUntilNotBusy(useTutorialStore);
  s = useGameStore.getState();
  check('the unchain demo genuinely unchained Juice-Box (still on board, no longer chained)', s.players.player1.supportSlots.some((sl) => sl?.defId === 'nu-juice-box' && !sl.chainedApexId));

  useTutorialStore.getState().setStep(swapIdx);
  await wait(300);
  await waitUntilNotBusy(useTutorialStore);
  s = useGameStore.getState();
  const apexWithEquip = s.players.player1.apexSlots.find((a) => a?.equip);
  check('the swap demo genuinely swapped in Smog Jacket', apexWithEquip?.equip?.defId === 'nu-smog-jacket');
  check('the swap demo genuinely returned Plasma Edge to hand, not just discarded it', s.players.player1.hand.some((c) => c.defId === 'nu-plasma-edge'));

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
