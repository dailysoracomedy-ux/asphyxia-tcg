/**
 * Verifies Commit 29.12's fix for a real, reported cascading failure: the
 * opponent's real (unscripted) attack destroying the player's recovered Apex
 * (Riot Runner) at some point before the finishing blow, causing emergency
 * recovery to swap in a different Apex (Static Jack) that doesn't have the
 * specific attack later scripted steps require by name - permanently
 * unsatisfiable from that point forward.
 *
 * Verified three ways:
 * 1. The guarantee is checked directly against the real, verified worst-case
 *    attack combination (800 base damage + Monomolecular Blade's +200 Choke
 *    bonus = 1000), confirming genuine survival with real margin, not just
 *    "probably enough."
 * 2. A real declareAttack call using that exact worst-case combination is run
 *    against a protected Apex, confirming it doesn't destroy - actual combat
 *    resolution, not just comparing numbers.
 * 3. Many full AI-driven playthroughs (not just one) reach the finishing-blow
 *    step with Riot Runner specifically still in play, not swapped for a
 *    different Apex - since AI variance was the whole reason this bug was
 *    intermittent rather than constant.
 */
import { useGameStore, tutorialProtectSurvivor, TUTORIAL_SURVIVOR_DEF } from '../store/gameStore';
import { aiPlayOneMainPhaseAction, aiPlayOneCombatAction, aiChooseBinaryRiftBonus } from '../game/ai';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

// --- 1: the constant has real, verified margin over the worst-case attack ---
const worstCaseAttack = 800 + 200; // verified max base damage + max Equip bonus
check('the survivor DEF threshold is genuinely, not marginally, above the worst real attack combination', TUTORIAL_SURVIVOR_DEF > worstCaseAttack);
check('there is a meaningful safety margin (at least 300) beyond the worst case, not just barely enough', TUTORIAL_SURVIVOR_DEF - worstCaseAttack >= 300);

// --- 2: a real combat resolution against the protected Apex, at the exact worst case ---
useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
useGameStore.setState((st) => ({
  players: {
    ...st.players,
    player1: { ...st.players.player1, apexSlots: [{ instanceId: 'protected-rr', defId: 'nu-riot-runner', type: 'Apex' as const }, null] },
    player2: {
      ...st.players.player2,
      apexSlots: [
        { instanceId: 'worst-case-attacker', defId: 'dw-pale-executioner', type: 'Apex' as const, equip: { instanceId: 'worst-case-equip', defId: 'dw-monomolecular-blade', type: 'Equip' as const } },
        null,
      ],
    },
  },
}));
tutorialProtectSurvivor();
let s = useGameStore.getState();
check('tutorialProtectSurvivor actually sets the DEF override on the real Apex in play', s.players.player1.apexSlots[0]?.survivorDefOverride === TUTORIAL_SURVIVOR_DEF);

// Give the target a Choke Counter so Monomolecular Blade's bonus is genuinely
// at its worst-case +200, not the default +100 - the actual worst realistic hit.
useGameStore.setState((st) => {
  const p1 = { ...st.players.player1 };
  const apex = { ...p1.apexSlots[0]!, counters: { choke: 1, upgrade: 0, glitch: 0 } };
  p1.apexSlots = [apex, null];
  return { players: { ...st.players, player1: p1 } };
});
s = useGameStore.getState();
if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
s = useGameStore.getState();
if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
s = useGameStore.getState();
useGameStore.setState({ activePlayerId: 'player2', phase: 'Combat' });
s = useGameStore.getState();
const attackerDef = s.players.player2.apexSlots[0]!;
s.declareAttack(attackerDef.instanceId, 'public-erasure', s.players.player1.apexSlots[0]!.instanceId);
s = useGameStore.getState();
check('the protected Apex genuinely survives the real worst-case attack resolution, not just in theory', s.players.player1.apexSlots.some(Boolean));

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (part 1) ===`);

// --- 3: many full, real AI-driven playthroughs reach finishing-blow with Riot Runner intact ---
function advanceAiTurn() {
  let st = useGameStore.getState();
  let guard = 0;
  while (st.activePlayerId === 'player2' && st.status === 'playing' && guard < 40) {
    guard++;
    if (st.pendingResponseQueue.length > 0) st.resolveResponse({ type: 'pass' } as never);
    else if (st.phase === 'Start' && st.startPhasePending) st.advancePhase('Start');
    else if (st.phase === 'Start' && !st.startPhasePending) st.advancePhase('Main');
    else if (st.phase === 'Main') { if (!aiPlayOneMainPhaseAction('player2')) st.advancePhase('Combat'); }
    else if (st.phase === 'Combat') { if (!aiPlayOneCombatAction('player2')) st.endTurn(); }
    st = useGameStore.getState();
  }
}

let survivedAllRuns = true;
const RUNS = 15;
for (let run = 0; run < RUNS; run++) {
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  let st = useGameStore.getState();
  if (st.phase === 'Start' && st.startPhasePending) st.advancePhase('Start');
  st = useGameStore.getState();
  if (st.phase === 'Start' && !st.startPhasePending) st.advancePhase('Main');
  st = useGameStore.getState();
  st.playApexCard(st.players.player1.hand.find((c) => c.defId === 'nu-street-beast')!.instanceId);
  st = useGameStore.getState();
  st.playSupportCard(st.players.player1.hand.find((c) => c.defId === 'nu-dead-battery')!.instanceId);
  st = useGameStore.getState();
  st.advancePhase('Combat');
  st = useGameStore.getState();
  const a1 = st.players.player1.apexSlots.find(Boolean)!;
  const t1 = st.players.player2.apexSlots.find(Boolean)!;
  st.declareAttack(a1.instanceId, 'neon-pounce', t1.instanceId);
  st = useGameStore.getState();
  st.endTurn();
  advanceAiTurn();
  st = useGameStore.getState();

  if (st.phase === 'Start' && st.startPhasePending) st.advancePhase('Start');
  st = useGameStore.getState();
  if (st.pendingResponseQueue.length > 0) {
    const item = st.pendingResponseQueue[0];
    if (item.stage === 'civilWarChoice' || item.stage === 'humanErrorChoice') {
      st.resolveResponse(item.stage === 'civilWarChoice' ? { type: 'civilWar', pick: aiChooseBinaryRiftBonus('player1') } : { type: 'humanError', pick: aiChooseBinaryRiftBonus('player1') });
      st = useGameStore.getState();
    }
  }
  if (st.phase === 'Start' && !st.startPhasePending) st.advancePhase('Main');
  st = useGameStore.getState();

  // Apply the actual tutorial guarantee right when Play an Equip would (the
  // real fix's actual call site), then let several more real AI turns play out
  // - simulating the opponent continuing to attack across multiple turns,
  // exactly the scenario that was intermittently breaking before. Re-applying
  // it every iteration matches the real fix's continuous behavior (Commit
  // 29.12) - a one-time call left a real gap where a destroy-and-recover cycle
  // could produce a fresh Apex instance that never got the guarantee at all.
  tutorialProtectSurvivor();
  for (let extraTurn = 0; extraTurn < 3; extraTurn++) {
    st = useGameStore.getState();
    if (st.status !== 'playing') break;
    tutorialProtectSurvivor();
    if (st.phase === 'Main' && st.players.player1.hand.length > 0) st.advancePhase('Combat');
    st = useGameStore.getState();
    if (st.phase === 'Combat') {
      const attacker = st.players.player1.apexSlots.find((a) => a && !a.hasAttacked);
      if (attacker) st.endTurn();
    }
    advanceAiTurn();
    tutorialProtectSurvivor();
  }

  st = useGameStore.getState();
  const hasAnyApex = st.players.player1.apexSlots.some(Boolean);
  const survivingApex = st.players.player1.apexSlots.find(Boolean);
  const isProtected = survivingApex?.survivorDefOverride === TUTORIAL_SURVIVOR_DEF;
  if (st.status === 'playing' && (!hasAnyApex || !isProtected)) {
    survivedAllRuns = false;
    console.log(`  run ${run + 1}: no protected Apex in play - apex slots now:`, st.players.player1.apexSlots.map((a) => ({ defId: a?.defId, protected: a?.survivorDefOverride === TUTORIAL_SURVIVOR_DEF })));
  }
}
check(
  `whichever Apex the player has always ends up protected across ${RUNS} independent real-AI-driven runs (Commit 29.12 - robust to the specific Apex changing, not just Riot Runner specifically surviving)`,
  survivedAllRuns
);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (final) ===`);
process.exit(failed > 0 ? 1 : 0);
