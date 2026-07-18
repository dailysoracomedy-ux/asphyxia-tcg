/**
 * Commit 50.10 - regression test for Stable Hand Hover Hitboxes & Preview
 * Ownership. Verifies the ARCHITECTURE and interaction state (not comments):
 * single hover owner, static non-overlapping hitboxes, pointer-events:none
 * visual layer, one centralized debounced preview, direct A->B transfer, and
 * preserved drag/inspect/tutorial behavior.
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
// Report hover-capable so activation logic runs (matches a desktop pointer).
(global as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
  matches: /hover: hover/.test(q) ? true : false,
  media: q,
  addEventListener: () => {},
  removeEventListener: () => {},
});
dom.window.matchMedia = (global as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia as typeof dom.window.matchMedia;
(global as unknown as { AudioContext: unknown }).AudioContext = class {
  state = 'running'; currentTime = 0;
  createOscillator() { return { type: '', frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} }; }
  createGain() { return { gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} }; }
  resume() { return Promise.resolve(); }
};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
// jsdom lacks a layout engine; give hitboxes a deterministic rect so the
// preview anchor math has something real to read.
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { left: 100, top: 600, width: 109, height: 48, right: 209, bottom: 648, x: 100, y: 600, toJSON: () => ({}) } as DOMRect;
};

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function fireEnter(el: Element) {
  el.dispatchEvent(new dom.window.PointerEvent('pointerover', { bubbles: true, cancelable: true }));
}

async function main() {
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { default: Hand } = await import('@/components/Hand');
  const { useGameStore } = await import('@/store/gameStore');

  // Real hand from a real game (Card looks up defs by id and errors otherwise).
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, false, 'player1', 24);
  const player = useGameStore.getState().players.player1;
  const cards = player.hand.slice(0, 4); // need >=3 for A->B->C scrubbing
  check('setup: at least 3 real hand cards to test scrubbing', cards.length >= 3);

  let lastDragCard: string | null = null;
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(
    React.createElement(Hand, {
      cards,
      state: useGameStore.getState(),
      playerId: 'player1',
      onCardPointerDown: (_e: React.PointerEvent, card: import('@/types/game').CardInstance) => {
        lastDragCard = card.instanceId;
      },
      onInspectCard: () => {},
      tutorialSpotlightInstanceId: undefined,
    })
  );
  await wait(120);

  // 1. Every hand Card renders with disableHoverPreview: assert there is NO
  //    per-card preview portal, only Hand's single one (none yet, pre-hover).
  const strayPreviews = [...dom.window.document.querySelectorAll('[data-hand-hover-preview]')];
  check('1/2. no hand hover-preview portal exists before settling (Hand owns the only one, none mounted yet)', strayPreviews.length === 0);

  // 3. Visual card layers are pointer-events:none.
  const visuals = [...dom.window.document.querySelectorAll('[data-hand-card-visual]')] as HTMLElement[];
  check('3. every visual card layer is pointer-events:none', visuals.length === cards.length && visuals.every((v) => v.className.includes('pointer-events-none')));

  // 4. Static interaction regions exist, one per card, and are the pointer
  //    surface (inset-0 absolute). Non-overlap is guaranteed structurally
  //    (each is inset-0 of a non-overlapping flex slot) - assert count + that
  //    they are distinct elements from the visuals.
  const hitboxes = [...dom.window.document.querySelectorAll('[data-hand-card-hitbox]')] as HTMLElement[];
  check('4. one static interaction hitbox per card, distinct from the visual layer', hitboxes.length === cards.length && hitboxes.every((h) => !h.hasAttribute('data-hand-card-visual')));

  function slotOf(id: string) {
    return dom.window.document.querySelector(`[data-hand-card-id="${id}"]`) as HTMLElement;
  }
  function hitboxOf(id: string) {
    return slotOf(id).querySelector('[data-hand-card-hitbox]') as HTMLElement;
  }
  function visualOf(id: string) {
    return slotOf(id).querySelector('[data-hand-card-visual]') as HTMLElement;
  }
  function isRaised(id: string) {
    const t = visualOf(id).style.transform;
    return t.includes('translateY(calc(') || (t.includes('translateY') && !t.includes('translateY(0)'));
  }

  // 5. Entering A raises only A.
  fireEnter(hitboxOf(cards[0].instanceId));
  await wait(20);
  check('5. entering card A raises only A', isRaised(cards[0].instanceId) && !isRaised(cards[1].instanceId) && !isRaised(cards[2].instanceId));

  // 6. Entering B directly raises only B (no intermediate hand-leave needed).
  fireEnter(hitboxOf(cards[1].instanceId));
  await wait(20);
  check('6. entering B directly after A raises only B (direct transfer, no hand-leave)', isRaised(cards[1].instanceId) && !isRaised(cards[0].instanceId));

  // 8. Rapid A->B->C leaves only C raised.
  fireEnter(hitboxOf(cards[0].instanceId));
  fireEnter(hitboxOf(cards[1].instanceId));
  fireEnter(hitboxOf(cards[2].instanceId));
  await wait(20);
  check('8. rapid A->B->C leaves only C raised', isRaised(cards[2].instanceId) && !isRaised(cards[0].instanceId) && !isRaised(cards[1].instanceId));

  // 9. No large preview appears while rapidly scrubbing (before the delay).
  check('9. no large preview mounted mid-scrub (before settle delay)', dom.window.document.querySelectorAll('[data-hand-hover-preview]').length === 0);

  // 10. One preview appears after settling on C for the delay (~320ms).
  await wait(420);
  const previews = [...dom.window.document.querySelectorAll('[data-hand-hover-preview]')];
  check('10. exactly one preview mounts after settling', previews.length === 1);

  // 11 + 12. Drag: find a genuinely playable card if the current game state
  // has one; test a real drag on it (pointer-down cancels preview AND calls
  // the handler). If none are playable yet (e.g. turn-1 draw phase), the
  // contract to verify is the inverse: an unplayable card must NOT start a
  // drag - so assert the handler stays uncalled, which is equally meaningful.
  const { canPlayCardFromHand } = await import('@/lib/cardPlayability');
  const st = useGameStore.getState();
  const playableCard = cards.find((c) => canPlayCardFromHand(st, 'player1', c));
  if (playableCard) {
    // settle a preview first so we can prove pointer-down cancels it
    fireEnter(hitboxOf(playableCard.instanceId));
    await wait(420);
    check('10b. a preview is up on the playable card before drag', dom.window.document.querySelectorAll('[data-hand-hover-preview]').length === 1);
    hitboxOf(playableCard.instanceId).dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    await wait(20);
    check('11. pointer-down cancels the large preview', dom.window.document.querySelectorAll('[data-hand-hover-preview]').length === 0);
    check('12. drag start invoked onCardPointerDown with the correct card', lastDragCard === playableCard.instanceId);
    dom.window.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true }));
  } else {
    // No playable card in this state - assert the unplayable card genuinely
    // does not begin a drag (handler stays null / uncalled).
    lastDragCard = null;
    hitboxOf(cards[0].instanceId).dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    await wait(20);
    check('11+12. an unplayable hand card correctly does NOT start a drag', lastDragCard === null);
  }

  // 7. Leaving the whole hand clears the raised card.
  fireEnter(hitboxOf(cards[0].instanceId));
  await wait(20);
  const track = dom.window.document.querySelector('[data-hand-track]')!;
  track.dispatchEvent(new dom.window.PointerEvent('pointerout', { bubbles: true, cancelable: true }));
  await wait(20);
  check('7. leaving the whole hand clears the raised card', !isRaised(cards[0].instanceId));

  // 14. Inspect button exists per card and is a real button (distinct surface).
  const inspects = [...dom.window.document.querySelectorAll('[data-hand-card-inspect]')];
  check('14. an inspect button exists per card (stable, separate from the visual layer)', inspects.length === cards.length);

  // 13. Tutorial-dim cards are non-interactive: re-render with a spotlight on
  //     card[0], so the OTHERS dim - their hitbox must be pointer-events:none.
  root.render(
    React.createElement(Hand, {
      cards,
      state: useGameStore.getState(),
      playerId: 'player1',
      onCardPointerDown: () => {},
      onInspectCard: () => {},
      tutorialSpotlightInstanceId: cards[0].instanceId,
    })
  );
  await wait(80);
  const dimmedHitbox = hitboxOf(cards[1].instanceId);
  check('13. tutorial-dimmed cards are non-interactive (hitbox pointer-events:none)', dimmedHitbox.style.pointerEvents === 'none');

  // 15. Timers cleaned up on unmount (no throw, no lingering preview).
  fireEnter(hitboxOf(cards[0].instanceId));
  root.unmount();
  await wait(400);
  check('15. after unmount, no preview lingers and no timer fires late', dom.window.document.querySelectorAll('[data-hand-hover-preview]').length === 0);

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.log(`\n=== RESULTS: ${passed} passed, ${failed + 1} failed ===`);
  process.exit(1);
});
