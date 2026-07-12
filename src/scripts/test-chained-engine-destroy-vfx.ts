/**
 * Verifies Commit 26's chained-Engine destruction ghost: when an Apex with a
 * chained Engine is destroyed (Commit 18.2's Chained Support Destruction rule),
 * both the Apex and its Engine now get their own destroy-shake ghost, instead of
 * only the Apex having one (as in Commit 23.2) while the Engine just vanished
 * instantly from its slot.
 *
 * This also specifically guards a real bug caught and fixed while building this:
 * Apex slots and Support slots both use a 0-based index space, so a slot-index-only
 * ghost lookup would have let an Apex-slot-0 ghost collide with an Engine-slot-0
 * ghost the instant both are destroyed simultaneously - exactly the situation this
 * feature creates. Fixed with a `slotKind: 'apex' | 'support'` field; this test
 * confirms the real rendered DOM shows both distinctly, not just that the events
 * exist in the store.
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
  const { getCardDef } = await import('@/data/cards');
  const { createInstance } = await import('@/data/decks');

  const store = useGameStore.getState();
  store.startNewGame('Neon Underground', 'Dark White', false);
  let s = useGameStore.getState();
  const p1 = s.openingApexSelectionPlayerId!;
  s.selectOpeningApex(p1, s.players[p1].hand.find((c) => c.type === 'Apex')!.instanceId);
  s = useGameStore.getState();
  const p2 = s.openingApexSelectionPlayerId!;
  s.selectOpeningApex(p2, s.players[p2].hand.find((c) => c.type === 'Apex')!.instanceId);
  s = useGameStore.getState();

  // Chain an Ability Support to player1's Apex so there's something to destroy
  // alongside it.
  const attacker = s.players.player1.apexSlots.find(Boolean)!;
  useGameStore.setState((st) => {
    const p1s = { ...st.players.player1 };
    const engine = createInstance('nu-spark-plug', 'AbilitySupport');
    engine.chainedApexId = attacker.instanceId;
    p1s.supportSlots = [engine, null, null];
    return { players: { ...st.players, player1: p1s } };
  });

  let guard = 0;
  s = useGameStore.getState();
  while (s.status === 'playing' && (s.activePlayerId !== 'player2' || s.phase !== 'Combat' || s.isFirstTurnOverall) && guard < 30) {
    guard++;
    if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
    else if (s.phase === 'Start') s.advancePhase('Main');
    else if (s.phase === 'Main') s.advancePhase('Combat');
    else if (s.phase === 'Combat') s.endTurn();
    s = useGameStore.getState();
  }

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 50));

  const p2Attacker = s.players.player2.apexSlots.find(Boolean)!;
  const apexDef = getCardDef(p2Attacker.defId) as { attacks: { id: string }[] };
  useGameStore.setState((st) => {
    const p = { ...st.players.player2 };
    p.availableSync = 10;
    return { players: { ...st.players, player2: p } };
  });
  s = useGameStore.getState();

  const engineBefore = s.players.player1.supportSlots.find((sup) => sup?.chainedApexId === attacker.instanceId);
  check('the Engine is actually chained to the Apex before the attack (test setup sanity check)', !!engineBefore);

  s.declareAttack(p2Attacker.instanceId, apexDef.attacks[apexDef.attacks.length - 1].id, attacker.instanceId);
  s = useGameStore.getState();
  let responseGuard = 0;
  while (s.pendingResponseQueue.length > 0 && responseGuard < 5) {
    responseGuard++;
    s.resolveResponse({ type: 'pass' });
    s = useGameStore.getState();
  }

  const apexDestroyed = !s.players.player1.apexSlots.some((a) => a?.instanceId === attacker.instanceId);
  const engineDestroyed = !s.players.player1.supportSlots.some((sup) => sup?.instanceId === engineBefore?.instanceId);
  check('the Apex was actually destroyed by this attack', apexDestroyed);
  check('the chained Engine was also destroyed along with it (Commit 18.2 rule)', engineDestroyed);

  // Check the actual event data directly - this is the precise check for the real
  // bug fixed here (apex and support slots share a 0-based index space; a ghost
  // lookup keyed only on index, without slotKind, could return either one for
  // both, silently showing the wrong card in the wrong slot).
  const { useAnimationStore } = await import('@/store/animationStore');
  const destroyEvents = useAnimationStore.getState().events.filter((e) => e.type === 'CARD_DESTROYED' && e.destroyedGhost);
  const apexGhost = destroyEvents.find((e) => e.destroyedGhost!.instance.instanceId === attacker.instanceId);
  const engineGhost = destroyEvents.find((e) => e.destroyedGhost!.instance.instanceId === engineBefore?.instanceId);
  check('the Apex has its own destroy-ghost tagged slotKind "apex"', apexGhost?.destroyedGhost?.slotKind === 'apex');
  check('the Engine has its own destroy-ghost tagged slotKind "support" (not colliding with the Apex\'s)', engineGhost?.destroyedGhost?.slotKind === 'support');
  check('the two ghosts occupy the same slot index (0) but are still distinguishable', apexGhost?.destroyedGhost?.slotIndex === engineGhost?.destroyedGhost?.slotIndex);

  await new Promise((r) => setTimeout(r, 20));
  const html = container.innerHTML;
  const shakeCount = (html.match(/vfx-destroy-shake/g) ?? []).length;
  check('both the Apex and its Engine show a destroy-shake ghost simultaneously (not just one)', shakeCount >= 2);

  await new Promise((r) => setTimeout(r, 1000));
  const htmlAfter = container.innerHTML;
  check('both ghosts are gone once their animation window elapses', !htmlAfter.includes('vfx-destroy-shake'));

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
