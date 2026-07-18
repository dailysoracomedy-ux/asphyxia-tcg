/**
 * Commit 50.7 - regression test for a real, reported, severe bug: "I can't
 * see my hand anymore." Root cause: Commit 50.6's fix for hover-jitter moved
 * the hand-card lift from a `top` style to a `transform: translateY()`, but
 * the two transform values were swapped - the RESTING (not-hovered) state
 * pushed the card DOWN by the tuck offset (translateY(+97px)) instead of
 * leaving it at its natural position, shoving every card entirely out of
 * the visible clip window. The HOVERED state applied no shift at all
 * instead of lifting up. Net effect: hand cards were 100% invisible at rest.
 *
 * No existing test caught this, because every prior Hand test checks DOM
 * presence/structure, not the actual computed direction of the transform
 * that determines whether content lands inside or outside the parent's
 * clip window. This test checks that directly: at rest, translateY must be
 * zero (content sits at its natural, visible position); on hover, translateY
 * must be NEGATIVE (shifts up, out of the way of the clip, never positive
 * (which would push it further into/past the clip boundary).
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

function parseTranslateY(transform: string): number | null {
  const m = transform.match(/translateY\((-?[\d.]+)px\)/);
  return m ? parseFloat(m[1]) : transform.includes('translateY(0)') ? 0 : null;
}

async function main() {
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { default: Hand } = await import('@/components/Hand');
  const { useGameStore } = await import('@/store/gameStore');

  // Real card instances from a real game, not fabricated ones - Card.tsx
  // looks up full card defs by defId and errors on anything invented.
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, false, 'player1', 24);
  const cards = useGameStore.getState().players.player1.hand;

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(Hand, { cards }));
  await wait(150);

  const outerWrappers = [...dom.window.document.querySelectorAll('.vfx-draw-in')];
  check('the hand genuinely rendered one wrapper per card', outerWrappers.length === cards.length);

  // Geometry invariants (the actual bug across 50.6/50.7 was vertical
  // geometry, not transform sign): the OUTER hitbox must be PEEK height so
  // it occupies the same row space the known-good single card did - if it's
  // full card height (194) instead, the row misaligns and the hand clips to
  // a sliver. The INNER lift box must be FULL card height so its top peek
  // shows and it has something to lift.
  const firstOuterEl = outerWrappers[0] as HTMLElement;
  const firstInnerEl = firstOuterEl.querySelector('div[style*="translateY"]') as HTMLElement;
  check('the outer hitbox is genuinely PEEK height (97px), matching the clip window - not full card height (which misaligns the row into a sliver)', firstOuterEl.style.height === '97px');
  check('the inner lift box is genuinely FULL card height (194px)', firstInnerEl.style.height === '194px');

  const innerDivs = outerWrappers.map((w) => w.querySelector('div[style*="translateY"]'));
  check('every card genuinely has a translateY-driven inner lift element', innerDivs.every((d) => !!d));

  const restY = innerDivs.map((d) => parseTranslateY((d as HTMLElement).style.transform));
  check(
    'at rest (not hovered), translateY is genuinely 0 - NOT a positive push that would shove the card below the visible clip window (the actual reported bug: hand cards were invisible)',
    restY.every((y) => y === 0)
  );

  // Hover the first card and check its lift flips to a genuine upward (negative) shift.
  const firstOuter = outerWrappers[0] as HTMLElement;
  // Commit 50.8 - hover now lives on the inset trigger pad (the last absolute
  // child, with no translateY), not the outer wrapper. Find it and confirm
  // it's genuinely inset from the edges (left offset > 0), which is what
  // creates the anti-jitter dead gutter between overlapping cards.
  const triggerPad = [...firstOuter.querySelectorAll('div')].find(
    (d) => (d as HTMLElement).style.left && (d as HTMLElement).style.left !== '0px' && !(d as HTMLElement).style.transform
  ) as HTMLElement | undefined;
  check('the inset hover trigger pad genuinely exists and is inset from the card edges (creates the anti-jitter gutter)', !!triggerPad && parseFloat(triggerPad.style.left) > 0);
  // React synthesizes onMouseEnter from native 'mouseover' (bubbling).
  const enterEvent = new dom.window.MouseEvent('mouseover', { bubbles: true, cancelable: true });
  (triggerPad ?? firstOuter).dispatchEvent(enterEvent);
  await wait(80);

  const hoveredInner = firstOuter.querySelector('div[style*="translateY"]') as HTMLElement;
  const hoveredY = parseTranslateY(hoveredInner.style.transform);
  check(
    'once hovered, translateY is genuinely NEGATIVE (shifts up, out of the clip) - not zero (no lift) and not positive (pushes further into the clip)',
    hoveredY !== null && hoveredY < 0
  );

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.log(`\n=== RESULTS: ${passed} passed, ${failed + 1} failed ===`);
  process.exit(1);
});
