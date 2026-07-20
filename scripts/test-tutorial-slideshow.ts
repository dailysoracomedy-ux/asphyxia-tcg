/**
 * Verifies Commit 31's Part 1: the "Learn the Essentials" intro slideshow
 * appears before the tutorial match board, walks through all nine card-type/
 * concept slides via real Continue clicks, and correctly hands off into the
 * match board on the final slide's "Start Tutorial Match" button.
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
  const { useTutorialStore } = await import('@/store/tutorialStore');

  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  useTutorialStore.getState().setSlideshowActive(true);
  useTutorialStore.getState().setSlideIndex(0);

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await wait(150);

  check('the slideshow genuinely renders before the match board', container.innerHTML.includes('Learn the Essentials'));
  check('the match board is genuinely NOT visible while the slideshow is up', !container.innerHTML.includes('Learn To Play'));

  // Commit 53 - the single "O2, Momentum & Rift Space" slide became four
  // dedicated concept slides (O2, Momentum, Rift Space, The Void) - the
  // game's core concepts each get taught properly now, including the Void /
  // Void Recycle, which the slideshow previously never mentioned at all.
  const expectedTitles = [
    'Apex',
    'Engine',
    'Battery Engine',
    'Ability Engine',
    'Equip',
    'Special',
    'React',
    'O2 \u2014 Your Life',
    'Momentum \u2014 Your Clutch Fuel',
    'Rift Space',
    'The Void',
  ];
  for (const title of expectedTitles) {
    check(`slide genuinely shows "${title}"`, container.innerHTML.includes(title));
    const btn = Array.from(dom.window.document.querySelectorAll('button')).find((b) => b.textContent === 'Continue');
    if (btn) click(btn);
    await wait(80);
  }

  check('the final slide genuinely shows the "Start Tutorial Match" button, not Continue', container.innerHTML.includes('Start Tutorial Match'));
  const startBtn = Array.from(dom.window.document.querySelectorAll('button')).find((b) => b.textContent === 'Start Tutorial Match');
  check('the Start Tutorial Match button is genuinely present and clickable', !!startBtn);
  if (startBtn) click(startBtn);
  await wait(150);

  check('clicking Start Tutorial Match genuinely dismisses the slideshow', !container.innerHTML.includes('Learn the Essentials'));
  check('the real match board genuinely appears after the slideshow', container.innerHTML.includes('Learn To Play'));
  check('the guided match genuinely starts at step 0', useTutorialStore.getState().step === 0 || container.innerHTML.includes('Step 1'));

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
