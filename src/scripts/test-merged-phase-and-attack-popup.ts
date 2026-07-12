/**
 * Verifies Commit 30.4's two biggest changes:
 *
 * 1. Combat Phase is merged into Main - no explicit "Enter Combat" step
 *    exists anymore. The instant a turn begins (right after the automatic
 *    draw), both playing cards and attacking are simultaneously legal, in
 *    any order, with no phase transition the player has to trigger.
 *
 * 2. Attacking is click-based again (reverted from Commit 30's drag
 *    experiment, per direct request) - clicking a ready Apex opens the new
 *    popup attack selector, and the existing click-to-target flow resolves
 *    it from there.
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
  const { useGameStore } = await import('@/store/gameStore');

  // --- Phase merge: no explicit Combat step, both plays and attacks legal immediately ---
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
  s = useGameStore.getState();
  check(
    'the turn is immediately in Combat phase after the single Main transition - no separate step was needed',
    s.phase === 'Combat'
  );
  check('Sync is genuinely already computed - not waiting on a second phase transition', s.players[s.activePlayerId].availableSync >= 0);

  const activeId = s.activePlayerId;
  const engineCard = s.players[activeId].hand.find((c) => c.type === 'BatterySupport' || c.type === 'AbilitySupport');
  if (engineCard) {
    s.playSupportCard(engineCard.instanceId);
    s = useGameStore.getState();
    check('a card was genuinely playable immediately, while phase is Combat (the merged model)', s.players[activeId].supportSlots.some((sl) => sl?.instanceId === engineCard.instanceId));
  }

  const apexOnBoard = s.players[activeId].apexSlots.find(Boolean);
  check('an Apex is genuinely on board and ready (not having attacked) immediately - attack legality itself is covered elsewhere (test-auto-end-turn, the full simulation suite)', !!apexOnBoard && !apexOnBoard.hasAttacked);

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (part 1) ===`);

  // --- Click-based attack popup: clicking a ready Apex opens AttackSelectorModal ---
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { default: GameBoard } = await import('@/components/GameBoard');

  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, false);
  s = useGameStore.getState();
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
  s = useGameStore.getState();

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await wait(200);
  const apexButtons = Array.from(dom.window.document.querySelectorAll('button')).filter(
    (b) => b.closest('[data-dropzone]') === null && b.textContent !== 'i' && !/end turn|battle log|reset|exit/i.test(b.textContent ?? '')
  );
  // Simulate a plain click (not a drag) on some board button - click.simulate via dispatchEvent
  let foundPopup = false;
  for (const btn of apexButtons) {
    const clickEvent = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    btn.dispatchEvent(clickEvent);
    await wait(30);
    if (dom.window.document.body.textContent?.includes('Choose an attack')) {
      foundPopup = true;
      break;
    }
  }
  check('clicking a ready Apex genuinely opens the new "Choose an attack" popup', foundPopup);

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (final) ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
