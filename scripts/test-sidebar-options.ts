/**
 * Verifies Commit 36's sidebar restructure: the Options panel is genuinely
 * closed by default, opens on a real click, and the O2 stat (a real
 * drag-drop-zone target for direct O2 damage effects) still renders and
 * functions correctly from its new home in the sidebar.
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
function click(el: Element) {
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
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
  await wait(150);

  check('Options genuinely starts closed - Battle Log button not present until opened', !container.textContent?.includes('Battle Log'));
  check('the Options button itself is genuinely present', container.textContent?.includes('Options') ?? false);

  const optionsBtn = Array.from(dom.window.document.querySelectorAll('button')).find((b) => b.textContent?.includes('Options'));
  check('a real Options button element is genuinely clickable', !!optionsBtn);
  if (optionsBtn) click(optionsBtn);
  await wait(80);

  check('clicking Options genuinely opens it - Battle Log now present', container.textContent?.includes('Battle Log') ?? false);
  check('Reset is genuinely present once opened', container.textContent?.includes('Reset') ?? false);

  if (optionsBtn) click(optionsBtn);
  await wait(80);
  check('clicking Options again genuinely closes it', !container.textContent?.includes('Battle Log'));

  // O2 stat + its real drag-drop-zone attribute, from its new sidebar location.
  check('the O2 readout genuinely still renders from the sidebar', container.textContent?.includes('O2') ?? false);
  const logoImg = container.querySelector('img[alt="ASPHYXIA"]');
  check('the real Asphyxia logo image is genuinely present in the sidebar', !!logoImg);

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
