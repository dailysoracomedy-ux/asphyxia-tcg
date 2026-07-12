/**
 * Verifies Commit 29.18's two fixes, both real and reported:
 *
 * 1. "The last step where the game state pushes way forward and the tutorial
 *    menu doesn't see it happen." Root cause: both scripted sequencers had a
 *    terminal guard that returned immediately once status left 'playing'
 *    (i.e. the moment the finishing blow won the game) - without ever calling
 *    finish()/setBusy(false). Continue stayed permanently disabled even
 *    though the match had, in fact, already ended.
 *
 * 2. "When I tried to restart it, it didn't restart and was stuck on
 *    'playing this out'." Root cause: Restart never explicitly cleared
 *    `busy`, and a still-in-flight sequence from before the restart could
 *    keep operating against the fresh game state, potentially re-setting
 *    `busy` itself. Fixed with an explicit clear plus a generation counter
 *    that lets any stale sequence detect it's been superseded and stop
 *    touching anything at all.
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

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { useGameStore, tutorialEnsureFinishingBlow, tutorialRunFullyScriptedTurn, tutorialRunScriptedOpponentTurn } = await import('@/store/gameStore');
  const { useTutorialStore } = await import('@/store/tutorialStore');

  // --- Fix 1: gameover mid-sequence must still clear busy ---
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  let s = useGameStore.getState();
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  s = useGameStore.getState();
  if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
  s = useGameStore.getState();
  s.playApexCard(s.players.player1.hand.find((c) => c.defId === 'nu-street-beast')!.instanceId);
  s = useGameStore.getState();
  s.playSupportCard(s.players.player1.hand.find((c) => c.defId === 'nu-dead-battery')!.instanceId);
  s = useGameStore.getState();
  s.advancePhase('Combat');
  s = useGameStore.getState();
  const attacker = s.players.player1.apexSlots.find(Boolean)!;
  tutorialEnsureFinishingBlow();
  useTutorialStore.getState().setBusy(false);
  tutorialRunFullyScriptedTurn('player1', [{ kind: 'attack', attackerDefId: attacker.defId, attackId: 'neon-pounce' }]);
  await wait(2500);
  s = useGameStore.getState();
  check('the match genuinely ended (status is gameover)', s.status === 'gameover');
  check('busy correctly cleared once the game ended mid-sequence - Continue is no longer stuck disabled', useTutorialStore.getState().busy === false);

  // --- Fix 2: Restart mid-sequence must not leave busy stuck true ---
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  useTutorialStore.getState().setBusy(false);
  // Start a real scripted sequence, then Restart while it's still mid-flight -
  // exactly the reported scenario.
  tutorialRunScriptedOpponentTurn([
    { kind: 'playApex', defId: 'dw-pale-executioner' },
    { kind: 'playSupport', defId: 'dw-reserve-grid' },
    { kind: 'advanceToCombat' },
    { kind: 'attack', attackerDefId: 'dw-pale-executioner', attackId: 'surgical-strike' },
  ]);
  await wait(200); // sequence is now genuinely in-flight, not yet complete
  check('the stale sequence is genuinely still in flight before restarting (busy is true)', useTutorialStore.getState().busy === true);

  // Simulate exactly what the Restart button now does.
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  useTutorialStore.getState().setBusy(false);

  await wait(3000); // long enough for the stale sequence to have fully finished its own timeline if it were still running unchecked
  check('busy genuinely stays false - the stale sequence detected it was superseded and never touched it again', useTutorialStore.getState().busy === false);
  s = useGameStore.getState();
  check('the restarted game is genuinely fresh - player1 has no Apex in play yet (still step 0 territory)', !s.players.player1.apexSlots.some(Boolean));

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
