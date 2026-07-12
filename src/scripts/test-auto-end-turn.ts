/**
 * Verifies the Commit 24.1 auto-end-turn effect: once the active human player's
 * last Apex that could attack has attacked, the turn should end automatically
 * without a manual "End Turn" click. A useEffect-driven behavior like this can't
 * be verified by a pure store-logic test (nothing about the store itself changes
 * turn automatically - the effect lives entirely in GameBoard.tsx), so this uses
 * the same jsdom + react-dom/client mount approach the other DOM tests use.
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
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

async function main() {
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');

  // Hotseat (not Vs AI) so both turns are "human" turns and the effect is free to
  // fire regardless of which player is active.
  const store = useGameStore.getState();
  store.startNewGame('Dark White', 'Neon Underground', false);
  let s = useGameStore.getState();
  const p1 = s.openingApexSelectionPlayerId!;
  s.selectOpeningApex(p1, s.players[p1].hand.find((c) => c.type === 'Apex')!.instanceId);
  s = useGameStore.getState();
  const p2 = s.openingApexSelectionPlayerId!;
  s.selectOpeningApex(p2, s.players[p2].hand.find((c) => c.type === 'Apex')!.instanceId);
  s = useGameStore.getState();

  // First turn can't attack - cycle to turn 2 first.
  let guard = 0;
  while (s.status === 'playing' && s.phase !== 'Combat' && guard < 10) {
    guard++;
    if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
    else if (s.phase === 'Start') s.advancePhase('Main');
    else if (s.phase === 'Main') s.advancePhase('Combat');
    s = useGameStore.getState();
  }
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

  const activeIdBefore = s.activePlayerId;
  const turnBefore = s.turnNumber;

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 50));

  const attacker = s.players[s.activePlayerId].apexSlots.find(Boolean)!;
  const { getCardDef } = await import('@/data/cards');
  const apexDef = getCardDef(attacker.defId) as { attacks: { id: string }[] };
  useGameStore.setState((st) => {
    const p = { ...st.players[st.activePlayerId] };
    p.availableSync = 10;
    return { players: { ...st.players, [st.activePlayerId]: p } };
  });
  s = useGameStore.getState();

  const opponentId = activeIdBefore === 'player1' ? 'player2' : 'player1';
  const target = s.players[opponentId].apexSlots.find(Boolean);

  // Declare the (only) attack this player has available - a fresh 2-Apex-slot
  // board with one Apex played only has one Apex to attack with here.
  s.declareAttack(attacker.instanceId, apexDef.attacks[0].id, target?.instanceId);
  s = useGameStore.getState();
  let responseGuard = 0;
  while (s.pendingResponseQueue.length > 0 && responseGuard < 5) {
    responseGuard++;
    s.resolveResponse({ type: 'pass' });
    s = useGameStore.getState();
  }

  check('the (only) Apex has now attacked', s.players[activeIdBefore].apexSlots.some((a) => a?.hasAttacked));
  check('turn has not ended yet, immediately after the attack', s.activePlayerId === activeIdBefore && s.turnNumber === turnBefore);

  // Wait past the effect's 900ms delay.
  await new Promise((r) => setTimeout(r, 1100));
  const sAfter = useGameStore.getState();
  check('the turn auto-ended after the last available Apex attacked', sAfter.activePlayerId !== activeIdBefore || sAfter.turnNumber !== turnBefore);

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
