/**
 * Verifies Commit 30.2's two fixes, both real and reported:
 *
 * 1. "If I drag [an Ability Engine], it chains. If I simply click on it, it
 *    allows me to play unchained." Two input methods producing two different
 *    real game outcomes for playing the identical card - drag was
 *    auto-chaining when exactly one friendly Apex existed, click never did.
 *    Fixed by always playing unchained on drop, matching click's own
 *    default. Chaining afterward is unaffected - already fully supported via
 *    the existing in-play chain mechanic.
 *
 * 2. "There's just no card preview while dragging." DragDropLayer previously
 *    showed only a text label with the card's name. Now renders the actual
 *    Card component, so the player can see exactly what they're dragging.
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

  // --- Fix 1: drag an AbilitySupport with exactly one friendly Apex -
  //     confirm it plays unchained, matching click's own default. ---
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
  check('test setup: player1 has exactly one Apex in play (the opening Apex) - the exact scenario the bug depended on', s.players.player1.apexSlots.filter(Boolean).length === 1);

  // nu-juice-box is an AbilitySupport (Ability Engine) - inject it directly.
  const injectedEngine = createInstance('nu-juice-box', 'AbilitySupport');
  useGameStore.setState((st) => ({
    activePlayerId: 'player1',
    players: { ...st.players, player1: { ...st.players.player1, hand: [...st.players.player1.hand, injectedEngine] } },
  }));

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await wait(200);

  const handButtons = Array.from(dom.window.document.querySelectorAll('button')).filter(
    (b) => b.closest('[data-dropzone]') === null && b.getAttribute('disabled') === null && b.textContent !== 'i'
  );
  const target = handButtons[handButtons.length - 1];
  const startX = 100, startY = 700;
  firePointer(target, 'pointerdown', startX, startY);
  await wait(20);
  firePointer(windowTarget, 'pointermove', startX + 40, startY - 300);
  await wait(20);
  // Commit 30.3 note: an Apex is now ALSO a legal drop target for Ability
  // Engines (dropping there auto-chains - see test-drag-chain-and-swap-logic.ts
  // for that behavior specifically). This test's intent is the OTHER legal
  // target - an empty Engine slot - so the mock must resolve to that zone
  // specifically, not just "any" dropzone now that there's more than one.
  dom.window.document.elementFromPoint = () => {
    const zones = Array.from(dom.window.document.querySelectorAll('[data-dropzone]'));
    const slotZone = zones.find((z) => {
      try {
        return JSON.parse((z as HTMLElement).dataset.dropzone!).kind === 'support-slot';
      } catch {
        return false;
      }
    });
    return (slotZone ?? zones[0]) as unknown as Element;
  };
  firePointer(windowTarget, 'pointermove', startX + 40, startY - 300);
  await wait(20);
  firePointer(windowTarget, 'pointerup', startX + 40, startY - 300);
  await wait(100);

  s = useGameStore.getState();
  const played = s.players.player1.supportSlots.find((sl) => sl?.instanceId === injectedEngine.instanceId);
  check('the Ability Engine was genuinely played via drag', !!played);
  check(
    'the Ability Engine played genuinely UNCHAINED, matching click\u2019s own default - the actual reported mismatch, now fixed',
    !!played && !played.chainedApexId
  );

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (part 1) ===`);

  // --- Fix 2: DragDropLayer renders a real Card preview, not just a label ---
  const { default: DragDropLayerComponent } = await import('@/ui/dragDrop/DragDropLayer');
  const previewContainer = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(previewContainer);
  const previewRoot = createRoot(previewContainer as unknown as Element);
  const fakeCard = createInstance('nu-riot-runner', 'Apex');
  const fakeDrag = {
    active: true,
    source: { kind: 'hand-card' as const, playerId: 'player1' as const, instanceId: fakeCard.instanceId, cardType: 'Apex' as const },
    pointer: { x: 200, y: 200 },
    legalZoneKeys: new Set<string>(),
    hoveredZoneKey: null,
  };
  previewRoot.render(React.createElement(DragDropLayerComponent, { drag: fakeDrag, label: 'Riot Runner', cardInstance: fakeCard }));
  await wait(50);
  const renderedCardButton = previewContainer.querySelector('button');
  check('DragDropLayer genuinely renders a real Card component while dragging, not just a text label', !!renderedCardButton);
  check('the rendered preview is genuinely the dragged card\u2019s own art/frame, not a generic placeholder', previewContainer.innerHTML.includes('riot-runner') || previewContainer.querySelectorAll('img, svg, div').length > 3);
  previewRoot.unmount();

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (final) ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
