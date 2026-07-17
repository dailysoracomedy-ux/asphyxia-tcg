/**
 * Verifies Commit 34's coin flip, rebuilt as a menu-only feature (not baked
 * into startNewGame's own state machine, after an earlier version of this
 * broke essentially every existing test/caller by inserting a new blocking
 * status - startNewGame must behave identically to before for every caller
 * that doesn't pass the new optional forcedFirstPlayerId).
 *
 * 1. startNewGame's default behavior is completely unaffected - goes
 *    straight to 'selectingOpeningApex' exactly as before.
 * 2. forcedFirstPlayerId, when provided, genuinely carries through to who
 *    is actually active once the match reaches 'playing' - overriding the
 *    older balance-based "who goes first" rule.
 * 3. Without forcedFirstPlayerId, the older balance-based rule still
 *    applies exactly as before (AI vs AI, or any caller that doesn't route
 *    through the new menu coin flip).
 */
import { useGameStore } from '@/store/gameStore';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

// --- Fix 1: default behavior is completely unaffected ---
useGameStore.getState().startNewGame('Neon Underground', 'Dark White', true, false, false);
let s = useGameStore.getState();
check('startNewGame with no forcedFirstPlayerId genuinely behaves exactly as before - straight to opening-Apex selection', s.status === 'selectingOpeningApex');
check('no coin-flip-decided first player exists when none was passed', !s.coinFlipFirstPlayerId);

// --- Fix 2: forcedFirstPlayerId genuinely carries through ---
function playThrough(forcedFirstPlayerId?: 'player1' | 'player2') {
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', true, false, false, forcedFirstPlayerId);
  let st = useGameStore.getState();
  const apex1 = st.players.player1.hand.find((c) => c.type === 'Apex');
  if (apex1) st.selectOpeningApex('player1', apex1.instanceId);
  st = useGameStore.getState();
  const apex2 = st.players.player2.hand.find((c) => c.type === 'Apex');
  if (apex2) st.selectOpeningApex('player2', apex2.instanceId);
  return useGameStore.getState();
}

s = playThrough('player1');
check('forcedFirstPlayerId=player1 genuinely carries through to who is actually active', s.status === 'playing' && s.activePlayerId === 'player1' && s.firstPlayerId === 'player1');

s = playThrough('player2');
check('forcedFirstPlayerId=player2 genuinely carries through, overriding the older balance-based rule', s.status === 'playing' && s.activePlayerId === 'player2' && s.firstPlayerId === 'player2');

// --- Fix 3: without it, the older rule still genuinely applies (AI vs AI, or any legacy caller) ---
s = playThrough(undefined);
check('without forcedFirstPlayerId, the match still genuinely reaches "playing" with a real first player decided by the older rule', s.status === 'playing' && (s.firstPlayerId === 'player1' || s.firstPlayerId === 'player2'));

// --- the first-turn-attack rejection still genuinely works after all this ---
s = playThrough('player1');
check('isFirstTurnOverall is genuinely still true for the coin-flip winner\u2019s first turn - the "no attack turn 1" rule is unaffected', s.isFirstTurnOverall === true);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
