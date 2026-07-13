/**
 * Verifies Commit 31.1's hotfix for a real, reported bug: the tutorial got
 * stuck on step 1, unable to continue. Root cause: auto-end-turn
 * (Commit 24.1) never checked tutorialMode - at the tutorial's very first
 * guided step, before any Apex is on the board, "no Apex can still attack"
 * is trivially true (there's no Apex at all), so it fired after 900ms and
 * ended the player's turn before they ever got a chance to drag their Apex
 * into play, permanently skipping past the guided flow.
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
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');
  const { useTutorialStore } = await import('@/store/tutorialStore');

  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  useTutorialStore.getState().setSlideshowActive(false);
  useTutorialStore.getState().setStep(0);

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await wait(150);

  let s = useGameStore.getState();
  if (s.status === 'selectingOpeningApex') {
    const apex1 = s.players.player1.hand.find((c) => c.defId === 'nu-street-beast');
    if (apex1) s.selectOpeningApex('player1', apex1.instanceId);
    s = useGameStore.getState();
    const apex2 = s.players.player2.hand.find((c) => c.type === 'Apex');
    if (apex2) s.selectOpeningApex('player2', apex2.instanceId);
  }
  s = useGameStore.getState();
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  s = useGameStore.getState();
  if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
  await wait(150);

  s = useGameStore.getState();
  check('test setup: player1 genuinely has no Apex on board yet (the exact condition that triggered the bug)', s.players.player1.apexSlots.every((a) => a === null));
  check('test setup: it is genuinely still player1\u2019s turn, still step 0', s.activePlayerId === 'player1' && useTutorialStore.getState().step === 0);

  // Wait well past the old 900ms auto-end-turn delay, doing nothing - this
  // is exactly what a real player reading the tutorial text does before
  // they drag the Apex.
  await wait(1500);

  s = useGameStore.getState();
  check('the turn did NOT auto-end while the player hadn\u2019t acted yet - the actual bug, now fixed', s.activePlayerId === 'player1');
  check('the guided step is still genuinely step 0 - nothing skipped ahead', useTutorialStore.getState().step === 0);
  check('the Apex slot is still genuinely empty - still waiting for the real drag', s.players.player1.apexSlots.every((a) => a === null));

  // Confirm the fix doesn't break normal (non-tutorial) auto-end-turn.
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', true, false, false);
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
  await wait(1300);
  s = useGameStore.getState();
  check('normal (non-tutorial) auto-end-turn still works - player1\u2019s turn genuinely ended with no Apex on board', s.activePlayerId !== 'player1' || s.turnNumber > 1);

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
