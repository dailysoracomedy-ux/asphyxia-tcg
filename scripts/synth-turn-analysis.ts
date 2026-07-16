/* Turn-by-turn diagnostic for Neon Underground's decline at longer O2 levels.
   Snapshots real game state after every turn (O2, board DEF, momentum, sync, hand
   size for both sides) across many real AI-vs-AI games, then aggregates by turn
   number to find WHEN Neon's position starts diverging from its opponent's -
   not just that it eventually loses. */
import { useGameStore } from '@/store/gameStore';
import { getEffectiveDef } from '@/game/rules';
import { aiPlayOneMainPhaseAction, aiPlayOneCombatAction, aiDecideControlConflict, aiChooseBinaryRiftBonus, aiChooseResponse } from '@/game/ai';
import type { Faction, PlayerId } from '@/types/game';

function rand<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

function resolvePendingWithRealAI(): boolean {
  const s = useGameStore.getState();
  const item = s.pendingResponseQueue[0];
  if (!item) return false;
  if (item.stage === 'reactionChoice') s.resolveResponse(aiChooseResponse(item.respondingPlayerId, item));
  else if (item.stage === 'negateWindow') s.resolveResponse(aiChooseResponse(item.negatingPlayerId, item));
  else if (item.stage === 'civilWarChoice') s.resolveResponse({ type: 'civilWar', pick: aiChooseBinaryRiftBonus(item.playerId) });
  else if (item.stage === 'humanErrorChoice') s.resolveResponse({ type: 'humanError', pick: aiChooseBinaryRiftBonus(item.playerId) });
  return true;
}

interface TurnSnapshot {
  turn: number;
  neonO2: number;
  oppO2: number;
  neonDef: number;
  oppDef: number;
  neonMomentum: number;
  oppMomentum: number;
  neonSync: number;
  oppSync: number;
  neonApexCount: number;
  oppApexCount: number;
  neonHandSize: number;
  oppHandSize: number;
}

function snapshot(turn: number, neonId: PlayerId, oppId: PlayerId): TurnSnapshot {
  const st = useGameStore.getState();
  const neon = st.players[neonId];
  const opp = st.players[oppId];
  const boardDef = (p: typeof neon) => p.apexSlots.filter(Boolean).reduce((sum, a) => sum + getEffectiveDef(st, a!.instanceId), 0);
  return {
    turn,
    neonO2: neon.o2,
    oppO2: opp.o2,
    neonDef: boardDef(neon),
    oppDef: boardDef(opp),
    neonMomentum: neon.momentum,
    oppMomentum: opp.momentum,
    neonSync: neon.availableSync,
    oppSync: opp.availableSync,
    neonApexCount: neon.apexSlots.filter(Boolean).length,
    oppApexCount: opp.apexSlots.filter(Boolean).length,
    neonHandSize: neon.hand.length,
    oppHandSize: opp.hand.length,
  };
}

function runOneGame(synthId: PlayerId, oppFaction: Faction, maxTurns: number, o2Amount: number): { winner: PlayerId | null; synthId: PlayerId; snapshots: TurnSnapshot[] } {
  const s = useGameStore.getState();
  s.resetToMenu();
  const f1: Faction = synthId === 'player1' ? 'Synth Ascendancy' : oppFaction;
  const f2: Faction = synthId === 'player1' ? oppFaction : 'Synth Ascendancy';
  s.startNewGame(f1, f2, false, false, false, undefined, o2Amount);

  let guard = 0;
  while (useGameStore.getState().status === 'selectingOpeningApex' && guard < 10) {
    guard += 1;
    const st = useGameStore.getState();
    const pid = st.openingApexSelectionPlayerId!;
    const apexCard = rand(st.players[pid].hand.filter((c) => c.type === 'Apex'));
    if (!apexCard) throw new Error('No apex in opening hand');
    st.selectOpeningApex(pid, apexCard.instanceId);
  }

  const oppId: PlayerId = synthId === 'player1' ? 'player2' : 'player1';
  const snapshots: TurnSnapshot[] = [];

  function playMainAndCombatForRealAI(pid: PlayerId) {
    let guardActions = 0;
    while (guardActions < 40) {
      guardActions += 1;
      if (useGameStore.getState().pendingResponseQueue.length > 0) {
        resolvePendingWithRealAI();
        continue;
      }
      const playedCard = aiPlayOneMainPhaseAction(pid);
      if (playedCard) continue;
      const attacked = aiPlayOneCombatAction(pid);
      if (!attacked) break;
    }
  }

  let turns = 0;
  let guardTop = 0;
  while (useGameStore.getState().status === 'playing' && turns < maxTurns && guardTop < maxTurns * 30) {
    guardTop += 1;
    const st = useGameStore.getState();
    if (st.pendingResponseQueue.length > 0) {
      resolvePendingWithRealAI();
      continue;
    }
    if (st.phase === 'Start' && !st.startPhasePending && st.riftSpace?.id === 'ControlConflict') {
      const active = st.players[st.activePlayerId];
      if (active.supportSlots.some(Boolean) && !active.lockedSupportInstanceId) {
        aiDecideControlConflict(st.activePlayerId);
        continue;
      }
    }
    if (st.phase === 'Start' && st.startPhasePending) {
      st.advancePhase('Start');
      continue;
    }
    if (st.phase === 'Start' && !st.startPhasePending) {
      st.advancePhase('Main');
      continue;
    }
    if (st.phase === 'Combat') {
      playMainAndCombatForRealAI(st.activePlayerId);
      turns += 1;
      snapshots.push(snapshot(turns, synthId, oppId));
      useGameStore.getState().endTurn();
      continue;
    }
  }

  const finalState = useGameStore.getState();
  return { winner: finalState.winnerId, synthId, snapshots };
}

const O2_LEVELS = [96];
const OPPONENTS: Faction[] = ['Dark White'];
const GAMES_PER_CELL = 40;
const MAX_TRACKED_TURN = 45;

function main() {
  const startedAt = Date.now();
  let gamesRun = 0;
  let crashed = 0;

  // byO2[o2][turn] = { won: {sumO2Diff, sumDefDiff, sumMomDiff, sumSyncDiff, sumHandDiff, n}, lost: {...} }
  interface Acc { sumO2Diff: number; sumDefDiff: number; sumMomDiff: number; sumSyncDiff: number; sumHandDiff: number; n: number }
  const freshAcc = (): Acc => ({ sumO2Diff: 0, sumDefDiff: 0, sumMomDiff: 0, sumSyncDiff: 0, sumHandDiff: 0, n: 0 });

  const byO2: Record<number, { won: Acc[]; lost: Acc[]; all: Acc[] }> = {};
  for (const o2 of O2_LEVELS) {
    byO2[o2] = {
      won: Array.from({ length: MAX_TRACKED_TURN + 1 }, freshAcc),
      lost: Array.from({ length: MAX_TRACKED_TURN + 1 }, freshAcc),
      all: Array.from({ length: MAX_TRACKED_TURN + 1 }, freshAcc),
    };
  }

  for (const o2 of O2_LEVELS) {
    const maxTurns = Math.max(150, Math.round(150 * (o2 / 12)));
    for (const opp of OPPONENTS) {
      for (let i = 0; i < GAMES_PER_CELL; i++) {
        // Alternate which player slot Neon occupies, so this isn't silently
        // measuring a P1/P2 seating artifact instead of a real faction trend.
        const synthId: PlayerId = i % 2 === 0 ? 'player1' : 'player2';
        gamesRun += 1;
        try {
          const { winner, snapshots } = runOneGame(synthId, opp, maxTurns, o2);
          const neonWon = winner === synthId;
          for (const snap of snapshots) {
            if (snap.turn > MAX_TRACKED_TURN) break;
            const bucket = neonWon ? byO2[o2].won[snap.turn] : byO2[o2].lost[snap.turn];
            const all = byO2[o2].all[snap.turn];
            for (const acc of [bucket, all]) {
              acc.sumO2Diff += snap.neonO2 - snap.oppO2;
              acc.sumDefDiff += snap.neonDef - snap.oppDef;
              acc.sumMomDiff += snap.neonMomentum - snap.oppMomentum;
              acc.sumSyncDiff += snap.neonSync - snap.oppSync;
              acc.sumHandDiff += snap.neonHandSize - snap.oppHandSize;
              acc.n += 1;
            }
          }
        } catch (e) {
          crashed += 1;
          console.error(`\n!!! CRASHED: O2=${o2} Synth(${synthId}) vs ${opp} [run ${i}] !!!`);
          console.error(e);
        }
      }
    }
    console.log(`O2=${o2} done (${gamesRun} games so far, ${((Date.now() - startedAt) / 1000).toFixed(0)}s elapsed)`);
  }

  console.log('\n\n=== TURN-BY-TURN DIAGNOSTIC ===\n');
  for (const o2 of O2_LEVELS) {
    console.log(`--- O2=${o2} (Synth Ascendancy vs Dark White) ---`);
    console.log('turn | avg O2 diff (N-opp) | avg DEF diff | avg Momentum diff | avg Sync diff | avg hand-size diff | games sampled');
    let firstNegativeStreak: number | null = null;
    let negativeStreakLen = 0;
    for (let t = 1; t <= MAX_TRACKED_TURN; t++) {
      const acc = byO2[o2].all[t];
      if (acc.n < 10) continue; // too few surviving games at this turn depth to be meaningful
      const avgO2 = acc.sumO2Diff / acc.n;
      const avgDef = acc.sumDefDiff / acc.n;
      const avgMom = acc.sumMomDiff / acc.n;
      const avgSync = acc.sumSyncDiff / acc.n;
      const avgHand = acc.sumHandDiff / acc.n;
      console.log(`  ${t.toString().padStart(3)} | ${avgO2 >= 0 ? '+' : ''}${avgO2.toFixed(2).padStart(7)} | ${avgDef >= 0 ? '+' : ''}${avgDef.toFixed(1).padStart(7)} | ${avgMom >= 0 ? '+' : ''}${avgMom.toFixed(2).padStart(6)} | ${avgSync >= 0 ? '+' : ''}${avgSync.toFixed(2).padStart(6)} | ${avgHand >= 0 ? '+' : ''}${avgHand.toFixed(2).padStart(6)} | n=${acc.n}`);

      if (avgO2 < 0) {
        negativeStreakLen += 1;
        if (negativeStreakLen >= 3 && firstNegativeStreak === null) firstNegativeStreak = t - 2;
      } else {
        negativeStreakLen = 0;
      }
    }
    console.log(`  => Neon's O2 differential first turns decisively (3+ consecutive turns) negative around turn ${firstNegativeStreak ?? 'never, in this sample'}\n`);

    console.log(`  Won games only vs Lost games only, at a few key checkpoints:`);
    for (const t of [3, 6, 10, 15, 20]) {
      const w = byO2[o2].won[t];
      const l = byO2[o2].lost[t];
      if (w.n < 5 && l.n < 5) continue;
      const wO2 = w.n > 0 ? (w.sumO2Diff / w.n).toFixed(2) : 'n/a';
      const lO2 = l.n > 0 ? (l.sumO2Diff / l.n).toFixed(2) : 'n/a';
      const wDef = w.n > 0 ? (w.sumDefDiff / w.n).toFixed(1) : 'n/a';
      const lDef = l.n > 0 ? (l.sumDefDiff / l.n).toFixed(1) : 'n/a';
      console.log(`    turn ${t}: [won games] O2 diff ${wO2}, DEF diff ${wDef} (n=${w.n})  |  [lost games] O2 diff ${lO2}, DEF diff ${lDef} (n=${l.n})`);
    }
    console.log('');
  }

  console.log(`Total games: ${gamesRun}, crashed: ${crashed}, time: ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
  if (crashed > 0) process.exitCode = 1;
}

main();
