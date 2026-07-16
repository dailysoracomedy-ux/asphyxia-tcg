/**
 * Verifies the destroy-ghost mechanism (Commit 23.2 hotfix) - the fix for a real,
 * user-reported bug: card-level combat animations (attack pulse, hit flash, destroy
 * shake) appeared completely invisible in practice, even though the O2 damage flash
 * worked fine. Root cause, confirmed by direct investigation, not assumed: when an
 * attack destroys an Apex, the real game state removes it from its board slot in
 * the exact same synchronous update that fires the CARD_DESTROYED visual event -
 * so by the time React re-renders, the slot already reads empty, and the 700ms
 * shake animation never gets a single frame to actually play. The fix captures a
 * snapshot of the destroyed card (owner + slot index + a plain copy of the
 * instance) inside the visual event itself, so the vacated slot can keep rendering
 * that "ghost" - with its shake animation - for exactly as long as the event stays
 * alive, then correctly reverts to a genuinely empty slot.
 *
 * Uses the same jsdom + react-dom/client createRoot approach that found the
 * original Commit 23.1 crash - a real DOM mount, not renderToStaticMarkup (which
 * skips effects) and not a pure store-logic test (which can't observe rendered
 * classes at all). This is exactly the class of bug none of the other 17 test
 * files in this suite can catch on their own.
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
  if (cond) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.log(`  FAIL: ${label}`);
  }
}

async function main() {
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');
  const { getCardDef } = await import('@/data/cards');

  const store = useGameStore.getState();
  store.startNewGame('Dark White', 'Neon Underground', false);
  let s = useGameStore.getState();
  const p1 = s.openingApexSelectionPlayerId!;
  s.selectOpeningApex(p1, s.players[p1].hand.find((c) => c.type === 'Apex')!.instanceId);
  s = useGameStore.getState();
  const p2 = s.openingApexSelectionPlayerId!;
  s.selectOpeningApex(p2, s.players[p2].hand.find((c) => c.type === 'Apex')!.instanceId);
  s = useGameStore.getState();

  let guard = 0;
  while (s.status === 'playing' && s.phase !== 'Combat' && guard < 10) {
    guard++;
    if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
    else if (s.phase === 'Start') s.advancePhase('Main');
    else if (s.phase === 'Main') s.advancePhase('Combat');
    s = useGameStore.getState();
  }
  if (s.isFirstTurnOverall) {
    s.endTurn();
    s = useGameStore.getState();
    guard = 0;
    while (s.status === 'playing' && s.phase !== 'Combat' && guard < 20) {
      guard++;
      if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
      else if (s.phase === 'Start') s.advancePhase('Main');
      else if (s.phase === 'Main') s.advancePhase('Combat');
      s = useGameStore.getState();
    }
  }

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 120));

  const attacker = s.players[s.activePlayerId].apexSlots.find(Boolean)!;
  const apexDef = getCardDef(attacker.defId) as { attacks: { id: string }[] };
  const opponentId = s.activePlayerId === 'player1' ? 'player2' : 'player1';
  const target = s.players[opponentId].apexSlots.find(Boolean)!;

  // Directly grant enough Sync to guarantee the attack isn't rejected for an
  // unrelated setup reason - isolates the animation behavior being tested.
  useGameStore.setState((st) => {
    const p = { ...st.players[st.activePlayerId] };
    p.availableSync = 10;
    return { players: { ...st.players, [st.activePlayerId]: p } };
  });
  s = useGameStore.getState();

  // Strongest attack, to guarantee a kill regardless of the target's DEF.
  s.declareAttack(attacker.instanceId, apexDef.attacks[apexDef.attacks.length - 1].id, target.instanceId);
  s = useGameStore.getState();

  // Deck contents are shuffled fresh each run, so the defender may occasionally
  // have drawn a Reaction eligible for this exact attack/destroy trigger, opening a
  // response window this test doesn't care about. Auto-pass through anything that
  // opens, same as other tests in this suite do, so this test verifies the vfx
  // ghost mechanism specifically, not response-window handling.
  let responseGuard = 0;
  while (s.pendingResponseQueue.length > 0 && responseGuard < 5) {
    responseGuard++;
    s.resolveResponse({ type: 'pass' });
    s = useGameStore.getState();
  }

  const actuallyDestroyed = !s.players[opponentId].apexSlots.some((a) => a?.instanceId === target.instanceId);
  check('the target was actually destroyed by this attack (test setup sanity check)', actuallyDestroyed);

  await new Promise((r) => setTimeout(r, 80));
  const htmlRightAfter = container.innerHTML;
  // Commit 43 renamed the destroy animation (shake -> shatter); match either.
  check('a destroy-animation class renders in the vacated slot immediately after destruction', /vfx-destroy-\w+/.test(htmlRightAfter));

  await new Promise((r) => setTimeout(r, 1000));
  const htmlAfterGhostExpires = container.innerHTML;
  check('the ghost animation class is gone once its duration elapses', !/vfx-destroy-\w+/.test(htmlAfterGhostExpires));

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
