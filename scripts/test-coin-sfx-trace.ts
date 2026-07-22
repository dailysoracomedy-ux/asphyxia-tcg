/**
 * Diagnostic: traces every playSfx() call during a real coin flip to verify
 * the Commit 42 audio contract: coin.flipStart fires at the toss and
 * coin.flipLand at touchdown, with real Audio.play() actually being called.
 * coin.flipLoop is deliberately RETIRED as of Commit 42 - the 3D coin's
 * ~1.1s toss has no room for the old 1.785s spin loop - so this test now
 * asserts the loop genuinely does NOT play, and that land follows start by
 * roughly the toss duration (real sequencing, not simultaneous). In jsdom
 * (no WebGL) this exercises CoinFlip3D's documented fallback path, which
 * shares the exact same sound/timing contract as the WebGL path.
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

// Trace every real Audio() construction and .play() call.
const playLog: { key: string; atMs: number }[] = [];
const constructedSrcs: string[] = [];
const startedAt = Date.now();
dom.window.HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
  playLog.push({ key: this.currentSrc || this.src || '(no src)', atMs: Date.now() - startedAt });
  return Promise.resolve();
};
const OrigAudio = dom.window.Audio;
class TracedAudio extends OrigAudio {
  constructor(src?: string) {
    super();
    if (src) {
      constructedSrcs.push(src);
      this.src = src;
    }
  }
}
(dom.window as unknown as { Audio: unknown }).Audio = TracedAudio;
(global as unknown as { Audio: unknown }).Audio = TracedAudio;

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
function findButtonByText(text: string) {
  return Array.from(dom.window.document.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(text));
}

async function main() {
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { default: NewGameMenu } = await import('@/components/NewGameMenu');

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(NewGameMenu));
  await wait(150);

  const newGameBtn = findButtonByText('New Game');
  if (newGameBtn) click(newGameBtn);
  await wait(80);
  const startBtn = findButtonByText('START');
  if (startBtn) click(startBtn);
  await wait(100);
  const headsBtn = findButtonByText('HEADS');
  if (headsBtn) click(headsBtn);

  await wait(3500);

  console.log('  Constructed Audio() sources containing "coin":', constructedSrcs.filter((s) => s.includes('coin')));
  console.log('  play() calls on coin sources:', playLog.filter((p) => p.key.includes('coin')));

  check('a real Audio() element was genuinely constructed for coin.flipStart', constructedSrcs.some((s) => s.includes('coin.flipStart')));
  check('a real Audio() element was genuinely constructed for coin.flipLand', constructedSrcs.some((s) => s.includes('coin.flipLand')));
  check('play() was genuinely called for coin.flipStart', playLog.some((p) => p.key.includes('coin.flipStart')));
  check('play() was genuinely called for coin.flipLand', playLog.some((p) => p.key.includes('coin.flipLand')));
  check(
    'coin.flipLoop genuinely does NOT play anymore - retired by Commit 42, the 1.1s toss has no room for the 1.785s loop',
    !playLog.some((p) => p.key.includes('coin.flipLoop'))
  );

  const startPlay = playLog.find((p) => p.key.includes('coin.flipStart'));
  const landPlay = playLog.find((p) => p.key.includes('coin.flipLand'));
  if (startPlay && landPlay) {
    const gap = landPlay.atMs - startPlay.atMs;
    console.log(`  Timing: start@${startPlay.atMs}ms, land@${landPlay.atMs}ms (gap ${gap}ms)`);
    check('land played genuinely after start (real sequencing, not simultaneous)', gap > 0);
    check('the start->land gap genuinely matches the ~1.1s toss (900-1600ms window), i.e. the flip really is half the old length', gap >= 900 && gap <= 1600);
  }

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
