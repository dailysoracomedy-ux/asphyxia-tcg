/**
 * Verifies Commit 30.4's fix for a real, reported bug: "some of the Synth
 * Ascendancy Engines don't give +100 attack. Or at least not immediately."
 * Drone Choir used to arm a delayed bonus for the chained Apex's NEXT attack
 * (which its own old rules text put at "next turn," since a bonus armed
 * after an attack already resolved can only ever apply to a future one).
 * Now uses chainedAttackBonus - the same live, immediate mechanism
 * Spark-Plug (cards.neon.ts) already uses - applied directly to the current
 * attack's damage, every time.
 */
import { useGameStore } from '@/store/gameStore';
import { getPreviewAttackDamage } from '@/game/rules';
import { createInstance } from '@/data/decks';
import { getCardDef } from '@/data/cards';
import type { ApexDef } from '@/types/game';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

useGameStore.getState().startNewGame('Synth Ascendancy', 'Dark White', true, false, false);
let s = useGameStore.getState();
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
useGameStore.setState({ activePlayerId: 'player1' });
s = useGameStore.getState();

const apex = s.players.player1.apexSlots.find(Boolean)!;
const droneChoir = createInstance('sa-drone-choir', 'AbilitySupport');
useGameStore.setState((st) => ({
  players: {
    ...st.players,
    player1: {
      ...st.players.player1,
      supportSlots: [droneChoir, null, null] as typeof st.players.player1.supportSlots,
    },
  },
}));
s = useGameStore.getState();
useGameStore.getState().chainSupport(droneChoir.instanceId, apex.instanceId);
s = useGameStore.getState();
const chained = s.players.player1.supportSlots.find((sl) => sl?.instanceId === droneChoir.instanceId);
check('test setup: Drone Choir is genuinely chained to the Apex', chained?.chainedApexId === apex.instanceId);

// Check the FIRST attack this Apex makes - the bonus must already be live,
// not waiting for a future attack.
const anyAttack = (getCardDef(apex.defId) as ApexDef).attacks[0];
const preview = getPreviewAttackDamage(s, apex.instanceId, anyAttack.id);
check(
  'the +100 bonus is genuinely visible in the FIRST attack\u2019s preview - immediate, not armed for a future attack',
  !!preview && preview.modifiers.some((m) => m.label === 'Drone Choir' && m.amount === 100)
);
check('the modified damage genuinely includes the +100 (not just listed as a modifier with no effect)', !!preview && preview.modifiedDamage === anyAttack.baseDamage + 100);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
