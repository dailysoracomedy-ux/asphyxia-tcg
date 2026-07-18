/**
 * Verifies Commit 30's drag-and-drop actually engages through the REAL
 * rendered DOM, not just the pure logic layer (test-drag-drop-logic.ts
 * already covers that). This is the test that should have existed before
 * shipping - it would have caught the actual reported bug directly: Card.tsx
 * has multiple render branches (a fallback branch, and the art-based branch
 * via ApexCardRenderer/GenericArtCard used once a card has real art mapped,
 * true for nearly every card), and onPointerDown was only wired onto the
 * fallback branch - meaning drag never started for any real gameplay card,
 * and every interaction silently fell through to the old click flow.
 *
 * Uses an Engine card with all 3 Support slots empty specifically because a
 * single click there can NEVER auto-play (canPlayCardFromHand's own click
 * flow in GameBoard.tsx only auto-plays when exactly one legal slot exists -
 * with 3 open, a plain click enters 'supportReady' selection mode instead,
 * requiring a second click on a specific slot). So if a single pointer
 * sequence (down, move past threshold, move over a specific slot, up) still
 * results in the card actually being played, that can only have happened via
 * real drag resolution - not a false positive from the click fallback, which
 * is exactly the trap the first version of this test fell into (confirmed
 * directly: it still passed even with the bug deliberately reintroduced,
 * because the single-empty-Apex-slot scenario it used couldn't distinguish
 * drag succeeding from click's own auto-play doing the same thing).
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
(global as unknown as { window: unknown }).window = dom.window;
(global as unknown as { document: unknown }).document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
(global as unknown as { HTMLElement: unknown }).HTMLElement = dom.window.HTMLElement;
(global as unknown as { PointerEvent: unknown }).PointerEvent = dom.window.PointerEvent ?? dom.window.MouseEvent;
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

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const windowTarget = dom.window as unknown as Window;

function firePointer(target: Element | Window, type: string, x: number, y: number) {
  const ev = new dom.window.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 });
  target.dispatchEvent(ev);
}

async function main() {
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');
  const { createInstance } = await import('@/data/decks');

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
  // Deterministic: a known Engine card, guaranteed 3 empty Support slots
  // (fresh game state, nothing played there yet), player1 definitely active.
  const injectedEngine = createInstance('nu-dead-battery', 'BatterySupport');
  useGameStore.setState((st) => ({
    activePlayerId: 'player1',
    players: { ...st.players, player1: { ...st.players.player1, hand: [...st.players.player1.hand, injectedEngine] } },
  }));
  s = useGameStore.getState();
  check('test setup: all 3 Support slots are genuinely empty - a plain click could never auto-play here', s.players.player1.supportSlots.every((sl) => sl === null));

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await wait(200);

  // Commit 50.10 - the hand card's drag/interaction surface is now a stable
  // hitbox div (data-hand-card-hitbox) overlaying the card, not the card's
  // own <button>. In a real browser this hitbox sits above the card face, so
  // the pointer lands on it; fire the drag there. It's the last hand card
  // (the injected Engine was appended last).
  const handHitboxes = Array.from(dom.window.document.querySelectorAll('[data-hand-card-hitbox]')).filter(
    (b) => b.closest('[data-dropzone]') === null && (b as HTMLElement).style.pointerEvents !== 'none'
  );
  check('test setup: at least one enabled hand card hitbox rendered', handHitboxes.length > 0);
  const target = handHitboxes[handHitboxes.length - 1];

  const startX = 100, startY = 700;
  firePointer(target, 'pointerdown', startX, startY);
  await wait(20);
  firePointer(windowTarget, 'pointermove', startX + 40, startY - 300);
  await wait(20);
  dom.window.document.elementFromPoint = () => {
    const zoneEl = dom.window.document.querySelector(`[data-dropzone]`);
    return zoneEl as unknown as Element;
  };
  firePointer(windowTarget, 'pointermove', startX + 40, startY - 300);
  await wait(20);
  firePointer(windowTarget, 'pointerup', startX + 40, startY - 300);
  await wait(100);

  s = useGameStore.getState();
  const engineOnBoard = s.players.player1.supportSlots.some((sl) => sl?.instanceId === injectedEngine.instanceId);
  check(
    'a single genuine drag sequence played the Engine directly - impossible via the click fallback with 3 open slots, so this can only be real drag resolution',
    engineOnBoard
  );

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
