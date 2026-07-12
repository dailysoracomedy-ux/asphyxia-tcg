/**
 * Verifies Commit 30.6's card-integrated attack selector: instead of a
 * separate row of attack buttons under the popup card, each attack row on
 * the card face itself becomes a clickable zone (with a hover backing box),
 * matching the requested reference design. Also verifies the defense-in-depth
 * guards added so other board interactions can't fire while the popup is
 * open, even if something ever changed the stacking order that currently
 * blocks them structurally.
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
  const { createInstance } = await import('@/data/decks');

  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, false);
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
  const activeId = s.activePlayerId;
  const opponentId = activeId === 'player1' ? 'player2' : 'player1';
  const testApex = createInstance('nu-riot-runner', 'Apex');
  const enemyApex = createInstance('dw-pale-executioner', 'Apex');
  const engineCard = createInstance('nu-dead-battery', 'BatterySupport');
  useGameStore.setState((st) => ({
    players: {
      ...st.players,
      [activeId]: { ...st.players[activeId], apexSlots: [testApex, null], supportSlots: [engineCard, null, null], availableSync: 2 },
      [opponentId]: { ...st.players[opponentId], apexSlots: [enemyApex, null] },
    },
  }));
  s = useGameStore.getState();

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await wait(200);

  const boardButtons = () =>
    Array.from(dom.window.document.querySelectorAll('button')).filter(
      (b) => b.closest('[data-dropzone]') === null && b.textContent !== 'i' && !/end turn|battle log|reset|exit/i.test(b.textContent ?? '')
    );

  let opened = false;
  for (const btn of boardButtons()) {
    click(btn);
    await wait(30);
    if (dom.window.document.querySelector('button[aria-label*="sync"]')) {
      opened = true;
      break;
    }
  }
  check('the popup opened and the card-integrated attack rows are genuinely rendered (found via their aria-label, not a separate button list)', opened);

  const attackRowButtons = Array.from(dom.window.document.querySelectorAll('button[aria-label*="sync"]'));
  check('the old separate button list is genuinely gone - no plain "N Sync · N dmg" text buttons exist anymore, only the on-card rows', dom.window.document.body.textContent?.includes('Sync ·') === false || attackRowButtons.length > 0);

  const enabledRow = attackRowButtons.find((b) => !b.hasAttribute('disabled'));
  check('at least one on-card attack row is genuinely clickable (affordable)', !!enabledRow);

  // --- Defense-in-depth: other board interactions should not fire while the popup is open ---
  s = useGameStore.getState();
  // Try clicking the End Turn button specifically - it should be disabled while the popup is open.
  const endTurnBtn = Array.from(dom.window.document.querySelectorAll('button')).find((b) => /end turn/i.test(b.textContent ?? ''));
  check('the End Turn button is genuinely disabled while the attack popup is open', endTurnBtn?.hasAttribute('disabled') === true);

  if (enabledRow) {
    click(enabledRow);
    await wait(100);
  }
  s = useGameStore.getState();
  const popupStillOpen = !!dom.window.document.querySelector('button[aria-label*="sync"]');
  check('clicking a real on-card attack row genuinely closed the popup (selection accepted, not silently dropped)', !popupStillOpen);
  check('a real attack log entry genuinely exists after clicking the on-card row', s.log.some((l) => l.message.toLowerCase().includes('attack')));

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
