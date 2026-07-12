/**
 * Verifies tutorialEnsureFinishingBlow's real, verified-safe combat math still
 * holds under Commit 29.17's fully-scripted rebuild. This guarantee is
 * unchanged by the rebuild - it still sets the opponent to a low, real O2 and
 * places a real, named low-DEF Apex, guaranteeing the tutorial's finishing
 * attack is genuinely lethal - but is now called from the 'finishing-blow'
 * step's onEnter (see tutorialSteps.ts) rather than from a player-gated step.
 *
 * The worst-case verification below is unchanged in spirit from earlier
 * commits: prove the guarantee holds even for a different Apex than the one
 * originally scripted (as if emergency recovery swapped in something else)
 * with no Equip bonus at all, not just in the ideal case.
 */
import { useGameStore, tutorialEnsureFinishingBlow } from '../store/gameStore';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
tutorialEnsureFinishingBlow();
let s = useGameStore.getState();
check('the finishing-blow guarantee sets the opponent to a low, real O2 value', s.players.player2.o2 === 1);
check('the finishing-blow guarantee places a real, named Apex (Pale Executioner, 300 DEF) as the target', s.players.player2.apexSlots[0]?.defId === 'dw-pale-executioner');

// Now verify the true worst case, not the best case: a DIFFERENT Apex than
// originally scripted (Static Jack, as if emergency recovery swapped it in
// after Riot Runner was destroyed), with NO Equip bonus at all (since an Equip
// attached to a destroyed Apex instance is lost with it) - proving the
// guarantee's math genuinely holds even when nothing goes as originally
// planned, not just in the ideal case.
useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
s = useGameStore.getState();
if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
s = useGameStore.getState();
if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
s = useGameStore.getState();
s.playApexCard(s.players.player1.hand.find((c) => c.defId === 'nu-street-beast')!.instanceId);
s = useGameStore.getState();
s.playSupportCard(s.players.player1.hand.find((c) => c.defId === 'nu-dead-battery')!.instanceId);
s = useGameStore.getState();
useGameStore.setState((st) => {
  const staticJack = { instanceId: 'test-static-jack', defId: 'nu-static-jack', type: 'Apex' as const };
  return { players: { ...st.players, player1: { ...st.players.player1, apexSlots: [staticJack, null] } } };
});
tutorialEnsureFinishingBlow();
s = useGameStore.getState();
s.advancePhase('Combat');
s = useGameStore.getState();
const attacker = s.players.player1.apexSlots.find(Boolean)!;
const target = s.players.player2.apexSlots.find(Boolean)!;
s.declareAttack(attacker.instanceId, 'circuit-breaker', target.instanceId);
s = useGameStore.getState();
check('the scripted finishing blow genuinely ends the match - status is gameover', s.status === 'gameover');
check('player1 (the human) is the actual winner, not the opponent', s.winnerId === 'player1');

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
