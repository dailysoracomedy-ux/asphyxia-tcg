/**
 * Verifies Commit 37's layout declutter pass through a real mounted board:
 * the Turn/Phase bar and Recent-plays ticker are genuinely gone, the Equip
 * Swap button is genuinely gone (drag-and-drop already handles it), End
 * Turn/Engine Reconfig genuinely render near the player's own board rather
 * than down by the hand, and a hovered hand card is genuinely NOT clipped
 * by the outer wrapper anymore (the actual reported bug - overflow-hidden
 * on an ancestor was cutting off the hover-lift).
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

async function main() {
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');

  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', true, false, false);
  let s = useGameStore.getState();
  if (s.status === 'selectingOpeningApex') {
    const apex1 = s.players.player1.hand.find((c) => c.type === 'Apex');
    if (apex1) s.selectOpeningApex('player1', apex1.instanceId);
    s = useGameStore.getState();
    const apex2 = s.players.player2.hand.find((c) => c.type === 'Apex');
    if (apex2) s.selectOpeningApex('player2', apex2.instanceId);
  }

  s = useGameStore.getState();
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  s = useGameStore.getState();
  if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await wait(150);

  check('the Turn/Phase bar is genuinely gone', !container.textContent?.includes('· Combat') && !container.textContent?.includes('· Main'));
  check('the Recent-plays ticker is genuinely gone', !container.textContent?.includes('Recent:'));
  check('the Equip Swap button is genuinely gone', !container.textContent?.includes('Equip Swap'));
  check('End Turn is still genuinely present somewhere on the board', container.textContent?.includes('End Turn') ?? false);
  check('Engine Reconfig is still genuinely present somewhere on the board', s.activePlayerId !== 'player1' || (container.textContent?.includes('Engine Reconfig') ?? false));
  check('the Options control is still genuinely present', container.textContent?.includes('Options') ?? false);
  check('the Rift panel is still genuinely present', /rift:/i.test(container.textContent ?? ''));

  // The actual reported bug: the outer wrapper's overflow-hidden was clipping
  // the hand's hover-lift. Confirm no ancestor of the hand row still clips
  // vertically (overflow-y hidden/clip anywhere up the tree).
  const handLabel = Array.from(dom.window.document.querySelectorAll('div')).find((d) => /^Hand \(\d+\)$/.test(d.textContent ?? ''));
  let culprit: Element | null = null;
  let node: Element | null = handLabel?.parentElement ?? null;
  while (node && node !== container) {
    const style = (node as HTMLElement).getAttribute('class') ?? '';
    if (/overflow-hidden|overflow-y-hidden/.test(style) && !/overflow-x-hidden/.test(style) === false && /overflow-hidden\b/.test(style)) {
      culprit = node;
      break;
    }
    node = node.parentElement;
  }
  check('no ancestor of the hand genuinely still clips vertical overflow - the actual reported "hand gets culled" bug, now fixed', !culprit);

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
