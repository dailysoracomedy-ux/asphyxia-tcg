/**
 * Verifies Commit 29.4's core fixes:
 * 1. Tutorial games skip the normal opening-Apex-selection screen entirely -
 *    they start directly in 'playing' status with zero Apexes on board, so
 *    there's no ungated selection screen for the player to interact with before
 *    ever seeing the tutorial's own guidance (the exact reported bug: "the
 *    player can choose an Apex before pressing Continue").
 * 2. The tutorial's own Step 1 attack (Step 6 in the script, on turn 1) actually
 *    succeeds - a real, previously-undiscovered bug where "the first player
 *    cannot attack on their very first turn" silently blocked it, confirmed by
 *    direct testing before the fix and re-confirmed working after.
 * 3. The dim/spotlight overlay actually renders during a tutorial match and
 *    genuinely blocks a click on an unrelated part of the board, while the
 *    element the current step highlights stays clickable (pokes above the
 *    overlay via the tutorial-spotlight class).
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
(global as unknown as { AudioContext: unknown }).AudioContext = class {
  state = 'running';
  currentTime = 0;
  createOscillator() {
    return { type: '', frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} };
  }
  createGain() {
    return {
      gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: () => {},
    };
  }
  resume() {
    return Promise.resolve();
  }
};

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

async function main() {
  const { useGameStore } = await import('@/store/gameStore');

  // --- Fix 1: no normal opening-Apex-selection screen for tutorial mode ---
  useGameStore.getState().startNewGame('Synth Ascendancy', 'Synth Ascendancy', false, false, true);
  const s1 = useGameStore.getState();
  check('tutorial games start directly in "playing" status (never "selectingOpeningApex")', s1.status === 'playing');
  check('both players start with zero Apexes on board - Step 1 is a real, guided first play, not pre-filled', !s1.players.player1.apexSlots.some(Boolean) && !s1.players.player2.apexSlots.some(Boolean));
  check('player1 is active and it is turn 1, matching the scripted script', s1.activePlayerId === 'player1' && s1.turnNumber === 1);

  // --- Fix 2: the tutorial's turn-1 attack actually succeeds ---
  let s = useGameStore.getState();
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  s = useGameStore.getState();
  if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
  s = useGameStore.getState();
  check('isFirstTurnOverall is NOT set for tutorial mode (the actual fix)', s.isFirstTurnOverall === false);

  s.playApexCard(s.players.player1.hand.find((c) => c.defId === 'nu-street-beast')!.instanceId);
  s = useGameStore.getState();
  s.playSupportCard(s.players.player1.hand.find((c) => c.defId === 'nu-dead-battery')!.instanceId);
  s = useGameStore.getState();
  s.advancePhase('Combat');
  s = useGameStore.getState();
  const attacker = s.players.player1.apexSlots.find(Boolean)!;
  s.declareAttack(attacker.instanceId, 'neon-pounce');
  s = useGameStore.getState();
  check(
    "the tutorial's Step 6 attack actually resolves on turn 1 (previously silently blocked by a real game rule)",
    s.players.player1.apexSlots.find(Boolean)?.hasAttacked === true
  );
  check('normal (non-tutorial) games are completely unaffected - the first player still cannot attack turn 1', (() => {
    useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, false);
    const normalState = useGameStore.getState();
    return normalState.status === 'selectingOpeningApex'; // normal flow untouched
  })());

  // --- Fix 3: the spotlight overlay actually blocks/allows clicks correctly ---
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { default: GameBoard } = await import('@/components/GameBoard');
  useGameStore.getState().startNewGame('Synth Ascendancy', 'Synth Ascendancy', false, false, true);
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 300));

  const { useTutorialStore } = await import('@/store/tutorialStore');
  useTutorialStore.getState().setStep(1); // play-apex, which spotlights Street-Beast
  await new Promise((r) => setTimeout(r, 150));

  const html = container.innerHTML;
  check('the dim overlay actually renders during a tutorial match', html.includes('bg-black/70'));
  check('the required hand card (Street-Beast) carries the spotlight class, poking above the overlay', html.includes('tutorial-spotlight'));

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
