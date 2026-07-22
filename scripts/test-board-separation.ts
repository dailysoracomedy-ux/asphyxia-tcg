/**
 * Verifies Commit 41.10's structural fix: Player 1's board is no longer a
 * flex child sharing the same flexible/shrinking region as the opponent
 * board + prompt area. It's now a separate, shrink-0 sibling that always
 * sits directly after that region - structurally impossible for the two
 * boards to overlap each other, regardless of how tall the opponent's
 * content (equip flaps, AI vs AI Showcase bar, etc) ever gets.
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

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 150));

  // Find the two DECK labels - each board has exactly one. Their nearest
  // shared "flex-1 min-h-0" ancestor tells us whether they're still in the
  // same flexible region or genuinely separated now.
  const deckLabels = Array.from(dom.window.document.querySelectorAll('span')).filter((el) => /^DECK \d+$/.test(el.textContent ?? ''));
  check('both Deck labels are genuinely present (one per board)', deckLabels.length === 2);

  function findFlexOneAncestor(el: Element | null): Element | null {
    while (el) {
      const cls = (el as HTMLElement).getAttribute('class') ?? '';
      if (cls.includes('flex-1') && cls.includes('min-h-0')) return el;
      el = el.parentElement;
    }
    return null;
  }

  if (deckLabels.length === 2) {
    const oppFlexAncestor = findFlexOneAncestor(deckLabels[0].parentElement);
    const ownFlexAncestor = findFlexOneAncestor(deckLabels[1].parentElement);
    check(
      'Player 1\u2019s board genuinely does NOT share the same flex-1 ancestor as the opponent board anymore - the actual structural fix',
      oppFlexAncestor !== ownFlexAncestor
    );
  }

  // Own board's own wrapper should carry shrink-0 now.
  const endTurnBtn = Array.from(dom.window.document.querySelectorAll('button')).find((b) => b.textContent === 'End Turn');
  const ownBoardWrapper = endTurnBtn?.closest('.shrink-0');
  check('Player 1\u2019s board wrapper is genuinely shrink-0 now (a fixed sibling, not a flexible/shrinking region)', !!ownBoardWrapper);

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
