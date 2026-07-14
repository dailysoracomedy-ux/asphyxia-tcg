/**
 * Verifies Commit 29.15's fix for a real, reported bug: "on step 17 the
 * opponent isn't attacking to play a React card."
 *
 * Root cause, confirmed by direct testing before fixing anything: Emergency
 * Apex Recovery is a normal, automatic rule that fires for *any* player
 * entering Main Phase with zero Apexes - including the fully scripted
 * opponent, who legitimately reaches zero Apexes once their first Apex is
 * destroyed. It was auto-playing an Apex for player2 before the scripted
 * sequence's own playApex action ever got a chance to run, silently
 * short-circuiting the rest of that turn's script (the Engine never played,
 * nothing left to drive the attack forward).
 */
import { useGameStore } from '@/store/gameStore';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

// --- Emergency recovery is suppressed for player2 during tutorial mode ---
useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
useGameStore.setState((st) => ({
  activePlayerId: 'player2',
  phase: 'Start',
  startPhasePending: false,
  players: {
    ...st.players,
    player2: { ...st.players.player2, apexSlots: [null, null] },
  },
}));
let s = useGameStore.getState();
check('test setup: player2 genuinely has zero Apexes in play', !s.players.player2.apexSlots.some(Boolean));
const handBefore = s.players.player2.hand.length;

s.advancePhase('Main');
s = useGameStore.getState();
check(
  'emergency recovery does NOT auto-play an Apex for player2 during tutorial mode - the scripted sequence owns this entirely',
  !s.players.player2.apexSlots.some(Boolean)
);
check("player2's hand is genuinely untouched - nothing was silently consumed", s.players.player2.hand.length === handBefore);

// --- Confirm this suppression is specific to tutorial mode - normal Vs AI must be completely unaffected ---
useGameStore.getState().startNewGame('Neon Underground', 'Dark White', true, false, false);
s = useGameStore.getState();
if (s.status === 'selectingOpeningApex') {
  const apex = s.players.player1.hand.find((c) => c.type === 'Apex');
  if (apex) s.selectOpeningApex('player1', apex.instanceId);
}
s = useGameStore.getState();
if (s.status === 'selectingOpeningApex') {
  const apex = s.players.player2.hand.find((c) => c.type === 'Apex');
  if (apex) s.selectOpeningApex('player2', apex.instanceId);
}
s = useGameStore.getState();
useGameStore.setState((st) => ({
  activePlayerId: 'player2',
  phase: 'Start',
  startPhasePending: false,
  players: { ...st.players, player2: { ...st.players.player2, apexSlots: [null, null] } },
}));
s = useGameStore.getState();
const hasApexAvailable = s.players.player2.hand.some((c) => c.type === 'Apex') || s.players.player2.deck.some((c) => c.type === 'Apex');
s.advancePhase('Main');
s = useGameStore.getState();
check(
  'normal (non-tutorial) Vs AI is completely unaffected - emergency recovery still works normally for player2 there',
  !hasApexAvailable || s.players.player2.apexSlots.some(Boolean)
);

// --- Player1's own emergency recovery (a real, intentional teaching moment) is still completely unaffected ---
useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
s = useGameStore.getState();
check("player1's own tutorialAwaitingFirstApex suppression (a different, deliberate mechanism) is untouched by this fix", s.tutorialAwaitingFirstApex === true);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
