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
(global as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({ matches: /hover: hover/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {} });
dom.window.matchMedia = (global as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia as typeof dom.window.matchMedia;
dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return { left: 100, top: 600, width: 109, height: 48, right: 209, bottom: 648, x: 100, y: 600, toJSON: () => ({}) } as DOMRect; };
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

  const slots = [...dom.window.document.querySelectorAll('[data-hand-card-id]')] as HTMLElement[];
  check('the hand genuinely rendered one slot per card', slots.length === cards.length);

  // Commit 50.10 geometry (fluid now, so values are clamp()/calc() strings,
  // not literal px): the slot is PEEK height (its height expression must
  // reference the peek, i.e. contain a 0.5 factor or the peek var), and the
  // visual layer is FULL card height. The visibility invariant that matters
  // is that the visual is TALLER than the slot (so a peek shows and the rest
  // is available to lift), and at rest the visual is NOT pushed downward.
  const firstSlot = slots[0];
  const firstVisual = firstSlot.querySelector('[data-hand-card-visual]') as HTMLElement;
  const firstHitbox = firstSlot.querySelector('[data-hand-card-hitbox]') as HTMLElement;
  // jsdom's CSS parser drops clamp() values entirely, so we can't read the
  // rendered heights back through it. Validate the computed geometry at the
  // source instead: peek must be ~half the full card height, and they must be
  // distinct fluid clamps - this is the invariant that keeps the peek visible
  // and the lift possible (the historical invisibility/sliver bugs were both
  // geometry-value bugs).
  const { handCssVars, HAND_GEOMETRY } = await import('@/lib/responsiveCard');
  const g = handCssVars();
  check('the peek is a distinct clamp from the full card height (peek < card)', g.peekH.startsWith('clamp(') && g.cardH.startsWith('clamp(') && g.peekH !== g.cardH);
  check('the peek maxes at ~half the full card height (proportion preserved)', g.peekH.includes((HAND_GEOMETRY.MAX_H * HAND_GEOMETRY.PEEK_RATIO).toFixed(2)) && g.cardH.includes(String(HAND_GEOMETRY.MAX_H)));
  check('a stable interaction hitbox exists in the slot', !!firstHitbox);
  check('a visual lift layer exists in the slot', !!firstVisual);

  const visuals = slots.map((sl) => sl.querySelector('[data-hand-card-visual]') as HTMLElement);
  check('every card has a visual lift layer', visuals.every((d) => !!d));
  check(
    'at rest (not hovered), the visual is at translateY(0) - NOT pushed down out of the clip window (the historical invisibility bug)',
    visuals.every((d) => d.style.transform === 'translateY(0)' || d.style.transform === '' || /translateY\(0\)/.test(d.style.transform))
  );

  // Hover the first card via its hitbox (pointerover -> React onPointerEnter)
  // and confirm the lift flips to a genuine upward (negative) shift.
  firstHitbox.dispatchEvent(new dom.window.PointerEvent('pointerover', { bubbles: true, cancelable: true }));
  await wait(80);

  const hoveredVisual = firstSlot.querySelector('[data-hand-card-visual]') as HTMLElement;
  const hoveredTransform = hoveredVisual.style.transform;
  check(
    'once hovered, the lift is a genuine upward shift (negative / calc(-1 * ...)), not zero and not downward',
    /-1 \*|translateY\(-/.test(hoveredTransform)
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
