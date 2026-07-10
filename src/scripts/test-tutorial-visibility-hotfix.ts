/**
 * Verifies Commit 29.6's three reported fixes:
 * 1. buffed-attack-target now has an autoAdvanceWhen - the actual Step 13 stuck
 *    bug, where a direct O2 hit (no enemy Apex to target) never satisfied the
 *    step's requiredAction and nothing else caught the outcome instead.
 * 2. attack-target/buffed-attack-target's text adapts to whether an enemy Apex
 *    actually exists, rather than permanently saying "attack the enemy Apex"
 *    even when there isn't one.
 * 3. Cards already in play (both players' Apex/Engine slots) stay visually
 *    bright during a tutorial match via the new tutorial-stay-bright class,
 *    rather than being darkened by the dim overlay along with everything else.
 * 4. The phase prompt no longer renders in Row 5 (between the two boards, where
 *    it was repeatedly reported as squeezing the Equip flap out of view).
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
  const { TUTORIAL_STEPS } = await import('@/tutorial/tutorialSteps');

  // --- Fix 1: the actual Step 13 stuck bug ---
  const buffedTarget = TUTORIAL_STEPS.find((s) => s.id === 'buffed-attack-target')!;
  check('buffed-attack-target now has an autoAdvanceWhen (was completely missing before this fix)', typeof buffedTarget.autoAdvanceWhen === 'function');
  const noEnemyApexButAttacked = { players: { player1: { apexSlots: [{ instanceId: 'x', hasAttacked: true }, null] } } } as never;
  check('it correctly advances once the player has attacked, even with no enemy Apex present', buffedTarget.autoAdvanceWhen!(noEnemyApexButAttacked) === true);
  const notYetAttacked = { players: { player1: { apexSlots: [{ instanceId: 'x', hasAttacked: false }, null] } } } as never;
  check('it correctly does NOT advance before the attack actually happens', buffedTarget.autoAdvanceWhen!(notYetAttacked) === false);

  // --- Fix 2: adaptive text ---
  check('attack-target text is now a function (adapts to whether an enemy Apex exists)', typeof TUTORIAL_STEPS.find((s) => s.id === 'attack-target')!.text === 'function');
  check('buffed-attack-target text is now a function too', typeof buffedTarget.text === 'function');
  const withEnemyApex = { players: { player2: { apexSlots: [{ instanceId: 'y' }, null] } } } as never;
  const withoutEnemyApex = { players: { player2: { apexSlots: [null, null] } } } as never;
  const textFn = buffedTarget.text as (s: never) => string;
  check('text correctly mentions "the enemy Apex" when one actually exists', textFn(withEnemyApex).toLowerCase().includes('enemy apex'));
  check('text correctly switches to describing a direct O2 hit when no enemy Apex exists (the exact reported confusion)', textFn(withoutEnemyApex).toLowerCase().includes('o2 directly'));

  // --- Fix 3 & 4: DOM-level checks ---
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');

  useGameStore.getState().startNewGame('Synth Ascendancy', 'Synth Ascendancy', false, false, true);
  let s = useGameStore.getState();
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  s = useGameStore.getState();
  if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
  s = useGameStore.getState();
  s.playApexCard(s.players.player1.hand.find((c) => c.defId === 'nu-street-beast')!.instanceId);
  s = useGameStore.getState();

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 300));

  const html = container.innerHTML;
  check('the just-played Apex (already in play) carries the stay-bright class, not just the overlay darkening it', html.includes('tutorial-stay-bright'));
  check('the phase prompt text still exists somewhere (moved, not deleted)', html.includes('play an Apex, Engine, Equip, or one Special'));
  const promptIndex = html.indexOf('play an Apex, Engine, Equip, or one Special');
  const battleLogIndex = html.indexOf('Battle Log');
  check(
    'the phase prompt now renders before the Battle Log button (i.e. in Row 1, the top bar) rather than its old spot between the two boards',
    promptIndex !== -1 && battleLogIndex !== -1 && promptIndex < battleLogIndex
  );

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
