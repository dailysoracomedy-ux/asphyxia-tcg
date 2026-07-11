/**
 * Verifies Commit 29.14's tutorial rebuild: a fully scripted opponent, zero AI
 * decision-making anywhere in tutorial mode. Directly requested: "Zero AI
 * involvement just logic pushing the whole tutorial." Every opponent action -
 * which card, which slot, which attack, which target, when to end turn - is
 * now a hardcoded sequence of real store-action calls, not a decision made by
 * the AI.
 *
 * Also verifies a real bug found and fixed while building this: the deck-
 * priority ordering originally used three sequential "move to front"
 * operations that interfered with each other, causing the wrong opponent
 * Apex to be placed at match start (confirmed directly via the Battle Log
 * before fixing) - and a second real risk found while testing the fix: the
 * player can legitimately have an eligible React and enough Momentum well
 * before the intended React step, which could let them consume it early and
 * break the later step.
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
  const { useTutorialStore } = await import('@/store/tutorialStore');
  const { TUTORIAL_STEPS } = await import('@/tutorial/tutorialSteps');

  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  let s = useGameStore.getState();
  check('the scripted opener is genuinely Enforcer-V4, not accidentally Pale Executioner (the real placement bug found and fixed)', s.players.player2.apexSlots[0]?.defId === 'dw-enforcer-v4');

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 150));

  // Play through Step 1-7 exactly as a real player would.
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
  const target = s.players.player2.apexSlots.find(Boolean)!;
  s.declareAttack(attacker.instanceId, 'neon-pounce', target.instanceId);
  s = useGameStore.getState();
  check('the real clean break happened - player1 has Momentum from Apex Break Reward', s.players.player1.momentum === 1);
  s.endTurn();
  await new Promise((r) => setTimeout(r, 100));

  // Advance the tutorial step to opponent-overflow to trigger its onEnter (the
  // real mounted panel does this automatically as the step's own
  // autoAdvanceWhen fires - forcing it directly here since the panel's own
  // 450ms auto-advance delay plus this step's own scripted sequence would
  // otherwise make this test slower than it needs to be).
  const overflowIdx = TUTORIAL_STEPS.findIndex((st) => st.id === 'opponent-overflow');
  useTutorialStore.getState().setStep(overflowIdx);

  // Wait for the full scripted sequence: Start->Main, play Pale Executioner,
  // play Reserve Grid, advance to Combat, attack - each step 700ms apart.
  await new Promise((r) => setTimeout(r, 4500));
  s = useGameStore.getState();
  check('the scripted opponent actually played Pale Executioner (not the AI picking something else)', s.players.player2.apexSlots.some((a) => a?.defId === 'dw-pale-executioner'));
  check('the scripted opponent actually played Reserve Grid for Sync', s.players.player2.supportSlots.some((a) => a?.defId === 'dw-reserve-grid'));
  check('the scripted first attack genuinely destroyed Street-Beast with real overflow damage', !s.players.player1.apexSlots.some(Boolean));
  check('the overflow damage matches the verified math exactly (200 overflow = 2 O2)', s.players.player1.o2 === 10);
  check('no response window was left open or unresolved - the unexpected-eligibility risk was auto-passed cleanly', s.pendingResponseQueue.length === 0);
  check('the opponent turn actually ended and control genuinely returned to player1', s.activePlayerId === 'player1');
  check('player1 genuinely still has Glitch Step in hand - it was NOT consumed by the earlier unintended eligibility', s.players.player1.hand.some((c) => c.defId === 'nu-glitch-step'));

  // --- Continue through Apex Recovery, Equip, Special, buffed attack, and the
  //     second scripted opponent turn (the intended React step). ---
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  s = useGameStore.getState();
  if (s.pendingResponseQueue.length > 0) {
    const item = s.pendingResponseQueue[0];
    if (item.stage === 'civilWarChoice' || item.stage === 'humanErrorChoice') {
      s.resolveResponse(item.stage === 'civilWarChoice' ? { type: 'civilWar', pick: 'momentum' } : { type: 'humanError', pick: 'momentum' });
      s = useGameStore.getState();
    }
  }
  if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
  s = useGameStore.getState();
  check('emergency Apex recovery placed a real Apex for player1 to continue with', s.players.player1.apexSlots.some(Boolean));

  const recovered = s.players.player1.apexSlots.find(Boolean)!;
  s.playEquipCard(s.players.player1.hand.find((c) => c.defId === 'nu-plasma-edge')!.instanceId, recovered.instanceId);
  s = useGameStore.getState();
  const specialCard = s.players.player1.hand.find((c) => c.defId === 'nu-overclock');
  if (specialCard) {
    s.playSpecialCard(specialCard.instanceId);
    s = useGameStore.getState();
  }
  s.advancePhase('Combat');
  s = useGameStore.getState();
  const attacker2 = s.players.player1.apexSlots.find(Boolean)!;
  const target2 = s.players.player2.apexSlots.find(Boolean)!;
  const { getCardDef } = await import('@/data/cards');
  const attacker2Def = getCardDef(attacker2.defId) as { attacks: { id: string; syncCost: number }[] };
  const oneSyncAttack = attacker2Def.attacks.find((a) => a.syncCost === 1)!;
  s.declareAttack(attacker2.instanceId, oneSyncAttack.id, target2.instanceId);
  s = useGameStore.getState();
  check('the buffed attack resolves and deals real overflow damage to the opponent', s.log.some((l) => l.message.includes('Overflow damage')));
  s.endTurn();
  await new Promise((r) => setTimeout(r, 100));

  const reactIdx = TUTORIAL_STEPS.findIndex((st) => st.id === 'react-window');
  useTutorialStore.getState().setStep(reactIdx);
  // This sequence includes only 3 scripted actions (play, advance, attack) vs
  // the first turn's 4 - and the attack itself is the last action, so the
  // sequencer stops and waits for the response rather than continuing.
  await new Promise((r) => setTimeout(r, 3500));
  s = useGameStore.getState();
  check('the second scripted opponent turn played the second Pale Executioner', s.players.player2.apexSlots.some((a) => a?.defId === 'dw-pale-executioner'));
  check('the intended React step genuinely leaves a real response window open for the player - this ONE should NOT be auto-passed', s.pendingResponseQueue.length > 0);
  check("the pending response genuinely belongs to player1's own reactionChoice, not resolved on their behalf", s.pendingResponseQueue[0]?.stage === 'reactionChoice');

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
