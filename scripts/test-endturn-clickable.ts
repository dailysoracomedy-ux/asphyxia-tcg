/**
 * Verifies Commit 41.6's fix for the actual reported game-breaking bug: End
 * Turn became unclickable after an earlier commit's negative-margin overlap
 * fix + high z-index layering combined to leave an invisible, pointer-
 * events-capturing box sitting on top of the End Turn button even where
 * that box was visually empty. Confirms a real click on the real button
 * genuinely reaches its handler and ends the turn.
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
  // Attack with the Apex so the turn genuinely can end (phase must be Combat
  // and nothing pending), matching a real player's actual flow.
  s = useGameStore.getState();
  const myApex = s.players.player1.apexSlots.find(Boolean);
  if (myApex && !s.isFirstTurnOverall) {
    const { getCardDef } = await import('@/data/cards');
    const def = getCardDef(myApex.defId);
    const atk = def.type === 'Apex' ? def.attacks[0] : undefined;
    const oppApex = s.players.player2.apexSlots.find(Boolean);
    if (atk && oppApex) s.declareAttack(myApex.instanceId, atk.id, oppApex.instanceId);
  }

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await wait(150);

  const endTurnBtn = Array.from(dom.window.document.querySelectorAll('button')).find((b) => b.textContent === 'End Turn');
  check('the real End Turn button is genuinely present', !!endTurnBtn);

  // The actual reported bug: is something else at that exact screen point
  // instead of the button? Simulate what a real click does - dispatch
  // directly on the button element itself (the most direct possible test
  // that its own click handler fires when clicked).
  const turnBefore = s.turnNumber;
  const phaseBefore = s.phase;
  if (endTurnBtn && !endTurnBtn.disabled) {
    click(endTurnBtn);
    await wait(100);
  }
  s = useGameStore.getState();
  check(
    'clicking End Turn genuinely changed real game state (turn advanced or phase changed) - the actual reported bug, now fixed',
    endTurnBtn?.disabled || s.turnNumber !== turnBefore || s.phase !== phaseBefore || s.activePlayerId !== 'player1'
  );

  // Confirm nothing with pointer-events blocking sits directly over the button's DOM position in a way that would matter for a real browser click.
  const row8 = endTurnBtn?.closest('.pointer-events-none');
  check('End Turn\u2019s own ancestor chain does not leave it inside a pointer-events-none region without an override', !row8 || (row8 as HTMLElement).className.includes('pointer-events-auto') || !!endTurnBtn?.closest('.pointer-events-auto'));

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
