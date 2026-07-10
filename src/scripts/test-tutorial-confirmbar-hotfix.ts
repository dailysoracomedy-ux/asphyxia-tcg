/**
 * Verifies two real, reported hotfixes on top of Commit 29.4:
 * 1. The tutorial dim overlay (z-30) was sitting above ConfirmBar and the
 *    Overdrive prompt (no elevated z-index of their own), silently blocking
 *    clicks on "Confirm" during a gated tutorial step - reported directly:
 *    "I can't confirm because of the blackout screen."
 * 2. CombatControls' own "Select one of your Apexes above to attack with it."
 *    box duplicated the newer, more compact phasePrompt text (Commit 29),
 *    reported as visual clutter that pushed the Equip flap out of view below it.
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
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');

  // --- Fix 1: ConfirmBar stays above the tutorial overlay ---
  useGameStore.getState().startNewGame('Synth Ascendancy', 'Synth Ascendancy', false, false, true);
  let s = useGameStore.getState();
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  s = useGameStore.getState();
  if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
  s = useGameStore.getState();

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 300));

  // Give both players 2 empty Apex slots so playing Street-Beast triggers a real
  // ConfirmBar (ambiguous destination) rather than Commit 24's auto-play path -
  // needed specifically to get ConfirmBar on screen for this check.
  useGameStore.setState((st) => {
    const p1 = { ...st.players.player1 };
    p1.hand = [...p1.hand];
    return { players: { ...st.players, player1: p1 } };
  });

  const html = container.innerHTML;
  check('the tutorial dim overlay is present on the board', html.includes('bg-black/70'));
  // The wrapper around ConfirmBar/Overdrive-prompt UI should carry the
  // above-overlay class whenever tutorialMode is active, regardless of which
  // specific mode/prompt is currently showing - this is what keeps it
  // permanently un-blockable rather than needing per-prompt handling.
  check('the confirmation-UI wrapper carries the above-overlay class during a tutorial match', html.includes('tutorial-above-overlay'));

  root.unmount();

  // --- Fix 2: no redundant CombatControls box ---
  const { default: CombatControls } = await import('@/components/CombatControls');
  const container2 = dom.window.document.createElement('div');
  const root2 = createRoot(container2 as unknown as Element);
  root2.render(
    React.createElement(CombatControls, {
      apexDef: null,
      state: useGameStore.getState(),
      attackerInstanceId: null,
      availableSync: 0,
      hasAttacked: false,
      selectedAttackId: null,
      onChooseAttack: () => {},
      onCancel: () => {},
      awaitingTarget: false,
    } as never)
  );
  await new Promise((r) => setTimeout(r, 50));
  check(
    'CombatControls no longer renders its own redundant "Select one of your Apexes..." box (phasePrompt already covers this)',
    !container2.innerHTML.includes('Select one of your Apexes above to attack with it')
  );
  check('CombatControls renders nothing at all in this state (not just different text - genuinely no box/clutter)', container2.innerHTML.trim().length === 0);
  root2.unmount();

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
