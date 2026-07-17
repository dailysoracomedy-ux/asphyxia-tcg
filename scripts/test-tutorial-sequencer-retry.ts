/**
 * Verifies Commit 29.16's fix for a real, reported bug: "the opponent sequence
 * here is still off. A new Apex didn't surface and the new Apex didn't
 * attack." Screenshot showed Turn 4, Draw Phase, the tutorial panel already on
 * the React step, but the opponent's board completely empty of Apexes.
 *
 * Root cause, confirmed by tracing the actual timing rather than re-checking
 * the already-verified sequence itself: react-window's onEnter fires the
 * instant its step becomes active, which happens immediately when the
 * player's own buffed attack resolves (hasAttacked becomes true) - still
 * during the PLAYER's own turn, well before their turn actually ends via
 * auto-end-turn. The sequencer's very first runNext() call checked
 * `activePlayerId !== 'player2'`, found it was still 'player1', and bailed
 * out permanently with no retry - silently doing nothing for the entire rest
 * of the opponent's subsequent turn.
 */
import { useGameStore, tutorialRunScriptedOpponentTurn, tutorialEnsureReactReady } from '@/store/gameStore';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

async function main() {
  // Set up a realistic mid-tutorial state: player1's own turn, about to end,
  // with the opponent (player2) about to get a turn and needing an Apex.
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  useGameStore.setState((st) => ({
    activePlayerId: 'player1', // still the PLAYER's turn - the exact bug scenario
    phase: 'Combat',
    players: {
      ...st.players,
      player1: {
        ...st.players.player1,
        apexSlots: [{ instanceId: 'test-riot-runner', defId: 'nu-riot-runner', type: 'Apex' as const, hasAttacked: true }, null],
      },
      player2: {
        ...st.players.player2,
        apexSlots: [null, null],
        // Reserve Grid already on board from the opponent's first scripted
        // turn (matching the real scenario) - react-window's own action list
        // never replays it, since it's expected to already be there.
        supportSlots: [{ instanceId: 'test-reserve-grid', defId: 'dw-reserve-grid', type: 'BatterySupport' as const }, null, null],
      },
    },
  }));
  let s = useGameStore.getState();
  check('test setup: it is genuinely still player1\'s turn (the exact scenario that triggers the bug)', s.activePlayerId === 'player1');

  // Call the sequencer exactly as react-window's onEnter does - while it's
  // still player1's turn, matching the real timing this bug depends on.
  tutorialEnsureReactReady();
  tutorialRunScriptedOpponentTurn(
    [
      { kind: 'playApex', defId: 'dw-pale-executioner' },
      { kind: 'advanceToCombat' },
      { kind: 'attack', attackerDefId: 'dw-pale-executioner', attackId: 'surgical-strike' },
    ],
    { expectsPlayerResponse: true }
  );

  // The sequencer should be quietly retrying right now, not having given up -
  // confirm nothing happened yet while it's still player1's turn.
  await new Promise((r) => setTimeout(r, 300));
  s = useGameStore.getState();
  check('nothing has happened yet while genuinely still player1\'s turn (correctly waiting, not incorrectly acting)', !s.players.player2.apexSlots.some(Boolean));

  // Now let the turn actually pass to player2, matching what auto-end-turn
  // would really do a moment later.
  useGameStore.setState({ activePlayerId: 'player2', phase: 'Start', startPhasePending: true });
  s = useGameStore.getState();
  check('turn now genuinely belongs to player2', s.activePlayerId === 'player2');

  // Wait for the full sequence to run: retry detects the turn change, then
  // Start->Main, playApex, advanceToCombat, attack.
  await new Promise((r) => setTimeout(r, 4000));
  s = useGameStore.getState();
  check(
    'the sequence genuinely resumed once it actually became the opponent\'s turn - the real fix, not just a passing check',
    s.players.player2.apexSlots.some((a) => a?.defId === 'dw-pale-executioner')
  );
  check('the scripted attack actually happened - a real response window is open for the player', s.pendingResponseQueue.length > 0);

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
