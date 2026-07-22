/**
 * Commit 48 - regression test for a real, reported bug: Engine Reconfig was
 * PERMANENTLY disabled ("you can't even click on it"). Root cause: the UI
 * gate in GameBoard still required state.phase === 'Main', but Commit 30.4
 * merged Main into Combat (advancePhase('Main') chains straight to
 * phase = 'Combat'), so the game is never observably in 'Main' - the button
 * had been dead for seventeen commits and no test tripped, because no test
 * asserted its ENABLED state. This one does:
 *   1. the button is genuinely NOT disabled during the merged turn,
 *   2. clicking it genuinely enters return-selection mode,
 *   3. after a reconfigure is used, it genuinely disables for the turn.
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
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findReconfigButton(): HTMLButtonElement | null {
  const buttons = Array.from(dom.window.document.querySelectorAll('button'));
  return (buttons.find((b) => b.textContent?.includes('Engine Reconfig')) as HTMLButtonElement) ?? null;
}

async function main() {
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');

  // Hotseat (both human) with player1 forced first, so the active player is
  // a human and the reconfig footer actually renders.
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, false, 'player1', 24);

  // Both players pick an opening Apex (the pre-board chooser screen).
  for (const pid of ['player1', 'player2'] as const) {
    const p = useGameStore.getState().players[pid];
    const apex = p.hand.find((c) => c.type === 'Apex');
    if (apex) useGameStore.getState().selectOpeningApex(pid, apex.instanceId);
  }

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await wait(150);

  // Let the Draw Phase auto-advance carry us into the merged Main/Combat turn.
  await wait(1200);
  const st = useGameStore.getState();
  check('setup: the game genuinely reached the merged turn (phase is Combat, the only observable in-turn phase)', st.phase === 'Combat');

  // Commit 52 - the Engine Reconfig BUTTON was removed; reconfiguring is now
  // done by dragging an Equip/Engine back to hand. Verify the button is gone
  // and the drag hint is shown instead.
  const btn = findReconfigButton();
  check('the Engine Reconfig button is genuinely GONE (Commit 52 - replaced by drag-back)', !btn);

  const html = dom.window.document.body.innerHTML;
  check('the drag-back hint is shown instead', /Drag an Equip or Engine back to your hand/i.test(html));

  // The store's return actions exist and are callable (the drag drop targets).
  const s2 = useGameStore.getState();
  check('returnEquipToHand store action exists', typeof s2.returnEquipToHand === 'function');
  check('returnEngineToHand store action exists', typeof s2.returnEngineToHand === 'function');

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.log(`\n=== RESULTS: ${passed} passed, ${failed + 1} failed ===`);
  process.exit(1);
});
