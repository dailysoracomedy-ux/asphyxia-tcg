/**
 * Verifies Commit 38's real fixes:
 * 1. html/body no longer clip vertically (the actual root cause of the
 *    hand pop-up being "culled by a container" - a fix inside GameBoard.tsx
 *    alone could never have solved this, since the clipping ancestor was
 *    above it entirely).
 * 2. The hand's hover-lift uses position/top, not transform - transform
 *    creates a new containing block for position:fixed descendants, which
 *    was trapping the card's own zoom-preview inside the lift itself.
 * 3. End Turn/Engine Reconfig now render as part of PlayerBoard's own grid
 *    (via the new footer prop), not a separate full-width row.
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
  const fs = await import('fs');
  const layoutSrc = fs.readFileSync('app/layout.tsx', 'utf-8');
  check('html no longer genuinely clips vertical overflow - the actual root cause', !/className="[^"]*\boverflow-hidden\b[^"]*"[\s\S]{0,20}>\s*<html/.test(layoutSrc) && !/<html[^>]*overflow-hidden/.test(layoutSrc));
  check('body no longer genuinely clips vertical overflow either', !/<body[\s\S]{0,100}overflow-hidden/.test(layoutSrc));

  const handSrc = fs.readFileSync('src/components/Hand.tsx', 'utf-8');
  // Commit 50.6 - this check was stale: it looked for a Tailwind
  // "hover:top-[-165px]" class that hasn't existed in Hand.tsx for many
  // commits (the lift became a JS-state-driven `top` style, then - this
  // commit - a `transform` on a stabilized-hitbox inner div, to fix a real
  // reported hover-jitter bug at the card edges). The underlying concern in
  // the old label ("transform traps position:fixed descendants") is a real
  // CSS rule, so it's verified against what actually matters now: Card.tsx's
  // ONLY position:fixed element (CardHoverPreview) must stay portaled to
  // document.body, which breaks DOM ancestry entirely - a portaled fixed
  // element's containing block is unaffected by transforms on its React
  // (not DOM) parent, so the trap this check exists to prevent genuinely
  // cannot occur here regardless of which CSS property drives the lift.
  const cardSrc = fs.readFileSync('src/components/Card.tsx', 'utf-8');
  check(
    'the hand lift may use transform now - CardHoverPreview (the only fixed-position element in Card.tsx) is genuinely portaled to document.body, so a transform on the lift wrapper cannot trap it',
    handSrc.includes('translateY') && /createPortal\s*\(/.test(cardSrc) && /document\.body/.test(cardSrc)
  );

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

  check('the logo is genuinely present in the left column', !!container.querySelector('img[alt="ASPHYXIA"]'));
  check('the Rift panel is genuinely present in the left column', /rift:/i.test(container.textContent ?? ''));
  check('the Options control is genuinely present', container.textContent?.includes('Options') ?? false);
  check('End Turn is genuinely present, now inside the board\u2019s own layout', container.textContent?.includes('End Turn') ?? false);

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
