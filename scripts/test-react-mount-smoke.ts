/**
 * Real DOM-mounted render smoke test - catches an entire class of bug that no
 * other test file in this suite can, since every other test drives the Zustand
 * store directly in Node and never once renders React. This exists specifically
 * because Commit 23 shipped a real bug of exactly this kind: an animation-store
 * selector returning a fresh array reference on every call, which React's
 * useSyncExternalStore (what Zustand v5 uses internally) escalates into a
 * "Maximum update depth exceeded" crash - invisible to every store-logic test,
 * only reproducible by actually mounting the component tree. Uses jsdom + real
 * react-dom/client createRoot (not renderToStaticMarkup, which skips effects and
 * would have missed this) so useEffect actually runs, same as a real browser.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
(global as unknown as { window: unknown }).window = dom.window;
(global as unknown as { document: unknown }).document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
(global as unknown as { HTMLElement: unknown }).HTMLElement = dom.window.HTMLElement;
(global as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number;
(global as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) => clearTimeout(id);
(global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
(global as unknown as { matchMedia: unknown }).matchMedia = () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
});

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

  useGameStore.getState().startNewGame('Dark White', 'Neon Underground', false);
  let s = useGameStore.getState();
  const p1 = s.openingApexSelectionPlayerId!;
  s.selectOpeningApex(p1, s.players[p1].hand.find((c) => c.type === 'Apex')!.instanceId);
  s = useGameStore.getState();
  const p2 = s.openingApexSelectionPlayerId!;
  s.selectOpeningApex(p2, s.players[p2].hand.find((c) => c.type === 'Apex')!.instanceId);

  const consoleErrors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { consoleErrors.push(args); };

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);

  let threw: unknown = null;
  try {
    root.render(React.createElement(GameBoard));
    // Flush effects (useEffect, ResizeObserver setup, etc.) - matches real browser timing.
    await new Promise((r) => setTimeout(r, 50));
  } catch (err) {
    threw = err;
  }
  console.error = originalError;

  check('mounting the main board after opening-Apex selection does not throw', threw === null);
  if (threw) console.log('  threw:', threw);

  check('the board actually rendered real content (not blank/null)', container.innerHTML.length > 5000);

  const infiniteLoopWarning = consoleErrors.some((e) =>
    e.some((a) => typeof a === 'string' && (a.includes('Maximum update depth') || a.includes('getSnapshot should be cached')))
  );
  check('no infinite-loop / uncached-getSnapshot warning during mount', !infiniteLoopWarning);
  check('no other unexpected console.error during mount', consoleErrors.length === 0);
  if (consoleErrors.length > 0) {
    console.log(`  (${consoleErrors.length} console.error call(s) seen):`);
    consoleErrors.forEach((e, i) => console.log(`    [${i}]`, ...e));
  }

  // Now advance through a normal turn sequence and confirm re-renders (Draw -> Main,
  // a Combat Phase transition) also mount cleanly - the same class of bug could
  // just as easily show up only after a state transition, not just on first mount.
  console.error = (...args: unknown[]) => { consoleErrors.push(args); };
  s = useGameStore.getState();
  let guard = 0;
  while (s.status === 'playing' && (s.phase === 'Start' || s.startPhasePending) && guard < 10) {
    guard += 1;
    if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
    else s.advancePhase('Main');
    s = useGameStore.getState();
  }
  s.advancePhase('Combat');
  await new Promise((r) => setTimeout(r, 50));
  console.error = originalError;

  check('advancing through Draw -> Main -> Combat phases causes no console.error', consoleErrors.length === 0);
  if (consoleErrors.length > 0) {
    console.log(`  (${consoleErrors.length} console.error call(s) seen after phase advance):`);
    consoleErrors.forEach((e, i) => console.log(`    [${i}]`, ...e));
  }

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
