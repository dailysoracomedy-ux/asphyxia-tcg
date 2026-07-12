/**
 * Verifies Commit 30.5's fix for a real, reported bug: "the card blows up
 * but it's too large... and also I can't choose any attack to attack."
 * Root cause, confirmed directly: the popup used CSS `transform: scale()` to
 * enlarge the card, which visually enlarges an element WITHOUT changing the
 * layout space it reserves - so the scaled card visually overlapped the
 * attack buttons rendered below it, while the card's own click hit-area grew
 * to match its scaled (larger, now-overlapping) bounds. Clicking what looked
 * like an attack button could land on the card's own area instead. Fixed by
 * removing the scale transform entirely (switching to the smaller 'lg' Card
 * size preset, which needs no further scaling and was reported as more
 * appropriately sized than 'xl').
 *
 * Honest limitation: jsdom has no real layout/paint engine, so this test
 * (which dispatches clicks directly on DOM element references, not via
 * coordinate-based hit-testing) cannot actually detect the CSS-transform
 * visual-overlap failure mode itself - confirmed directly by temporarily
 * reintroducing the old scale transform and finding this test still passed.
 * What it does prove, and is still genuinely worth proving: the underlying
 * click-to-attack logic (popup opens, an attack option's onClick genuinely
 * calls the real store action, the popup closes, a real log entry exists)
 * is correct end to end - the CSS fix itself needs a real browser check.
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

  // Hotseat, and directly inject a 3+-attack Apex with real Sync available so
  // more than one option is affordable - a single-affordable-attack scenario
  // would resolve immediately without ever showing the popup at all.
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
  const testApex = createInstance('nu-riot-runner', 'Apex');
  const enemyApex = createInstance('dw-pale-executioner', 'Apex');
  const opponentId = activeId === 'player1' ? 'player2' : 'player1';
  useGameStore.setState((st) => ({
    players: {
      ...st.players,
      [activeId]: { ...st.players[activeId], apexSlots: [testApex, null] },
      [opponentId]: { ...st.players[opponentId], apexSlots: [enemyApex, null] },
    },
  }));
  // Guarantee real Sync so more than one attack is affordable.
  useGameStore.setState((st) => ({
    players: { ...st.players, [activeId]: { ...st.players[activeId], availableSync: 2 } },
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
    if (dom.window.document.body.textContent?.includes('Choose an attack')) {
      opened = true;
      break;
    }
  }
  check('the attack popup genuinely opened from a real click', opened);

  // Now click a real, affordable attack option button inside the popup and
  // confirm the attack genuinely resolved - the actual reported bug.
  const attackButtons = Array.from(dom.window.document.querySelectorAll('button')).filter((b) => /Sync.*dmg/.test(b.textContent ?? ''));
  check('at least one real attack option button is rendered in the popup', attackButtons.length > 0);
  const clickable = attackButtons.find((b) => !b.hasAttribute('disabled'));
  check('at least one attack option is genuinely enabled (affordable)', !!clickable);
  if (clickable) {
    click(clickable);
    await wait(100);
  }

  s = useGameStore.getState();
  const popupStillOpen = dom.window.document.body.textContent?.includes('Choose an attack');
  check('clicking a real attack option genuinely closed the popup (the attack was accepted, not silently dropped)', !popupStillOpen);
  check('a real attack log entry genuinely exists - not just a UI state change with no actual resolution', s.log.some((l) => l.message.toLowerCase().includes('attack')));

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
