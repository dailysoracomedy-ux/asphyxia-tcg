/* Comprehensive balance-testing harness. Unlike simulate.ts (random-ish heuristic
   play, built for crash-testing), this drives both sides with the REAL in-game AI
   (src/game/ai.ts - the same decision code actual Vs AI / AI vs AI matches use),
   so every stat here reflects competent play, not random button-mashing. */
import { useGameStore } from '@/store/gameStore';
import { getCardDef } from '@/data/cards';
import { aiPlayOneMainPhaseAction, aiPlayOneCombatAction, aiDecideControlConflict, aiChooseBinaryRiftBonus, aiChooseResponse } from '@/game/ai';
import type { Faction, PlayerId } from '@/types/game';

const FACTIONS: Faction[] = ['Neon Underground', 'Dark White', 'Synth Ascendancy'];

function rand<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

function totalCards(playerId: PlayerId): number {
  const p = useGameStore.getState().players[playerId];
  const equips = p.apexSlots.filter(Boolean).reduce((n, a) => n + (a!.equip ? 1 : 0), 0);
  return p.deck.length + p.hand.length + p.voidZone.length + p.apexSlots.filter(Boolean).length + p.supportSlots.filter(Boolean).length + equips;
}

function resolvePendingWithRealAI(): boolean {
  const s = useGameStore.getState();
  const item = s.pendingResponseQueue[0];
  if (!item) return false;

  if (item.stage === 'reactionChoice') {
    s.resolveResponse(aiChooseResponse(item.respondingPlayerId, item));
  } else if (item.stage === 'negateWindow') {
    s.resolveResponse(aiChooseResponse(item.negatingPlayerId, item));
  } else if (item.stage === 'civilWarChoice') {
    s.resolveResponse({ type: 'civilWar', pick: aiChooseBinaryRiftBonus(item.playerId) });
  } else if (item.stage === 'humanErrorChoice') {
    s.resolveResponse({ type: 'humanError', pick: aiChooseBinaryRiftBonus(item.playerId) });
  }
  return true;
}

interface GameRecord {
  turns: number;
  ms: number;
  winner: PlayerId | null;
  firstPlayerId: PlayerId | null;
  winnerFinalO2: number | null;
  voidReshuffles: number;
  sawTwoApexBoard: boolean;
  riftId: string | null;
  player1Played: Set<string>;
  player2Played: Set<string>;
  player1Drawn: Set<string>;
  player2Drawn: Set<string>;
}

function runOneGame(f1: Faction, f2: Faction, maxTurns: number, o2Amount: number): GameRecord {
  const startedAt = Date.now();
  const s = useGameStore.getState();
  s.resetToMenu();
  s.startNewGame(f1, f2, false, false, false, undefined, o2Amount);

  let guard = 0;
  while (useGameStore.getState().status === 'selectingOpeningApex' && guard < 10) {
    guard += 1;
    const st = useGameStore.getState();
    const pid = st.openingApexSelectionPlayerId!;
    const apexCard = rand(st.players[pid].hand.filter((c) => c.type === 'Apex'));
    if (!apexCard) throw new Error('No apex in opening hand - mulligan loop failed');
    st.selectOpeningApex(pid, apexCard.instanceId);
  }

  const afterOpening = useGameStore.getState();
  const firstPlayerId = afterOpening.firstPlayerId ?? null;
  const riftId = afterOpening.riftSpace?.id ?? null;

  const startingDeckOrder: Record<PlayerId, string[]> = {
    player1: afterOpening.players.player1.deck.map((c) => c.defId),
    player2: afterOpening.players.player2.deck.map((c) => c.defId),
  };
  const openingHandDefIds: Record<PlayerId, string[]> = {
    player1: afterOpening.players.player1.hand.map((c) => c.defId),
    player2: afterOpening.players.player2.hand.map((c) => c.defId),
  };

  const played: Record<PlayerId, Set<string>> = { player1: new Set(), player2: new Set() };
  let voidReshuffles = 0;
  let sawTwoApexBoard = false;

  function countVoidReshufflesInLog() {
    const st = useGameStore.getState();
    voidReshuffles = st.log.filter((l) => l.message.includes('reshuffles back into the deck')).length;
  }

  function sampleBoardState() {
    const st = useGameStore.getState();
    for (const pid of ['player1', 'player2'] as PlayerId[]) {
      if (st.players[pid].apexSlots.every(Boolean)) sawTwoApexBoard = true;
    }
  }

  function playMainAndCombatForRealAI(pid: PlayerId) {
    let guardActions = 0;
    while (guardActions < 40) {
      guardActions += 1;
      if (useGameStore.getState().pendingResponseQueue.length > 0) {
        resolvePendingWithRealAI();
        continue;
      }
      const beforeHand = new Set(useGameStore.getState().players[pid].hand.map((c) => c.instanceId));
      const playedCard = aiPlayOneMainPhaseAction(pid);
      if (playedCard) {
        const afterHand = new Set(useGameStore.getState().players[pid].hand.map((c) => c.instanceId));
        const st = useGameStore.getState();
        const allPossibleLocations = [
          ...st.players[pid].apexSlots.filter(Boolean),
          ...st.players[pid].supportSlots.filter(Boolean),
          ...st.players[pid].voidZone,
          ...(st.players[pid].apexSlots.filter(Boolean).map((a) => a!.equip).filter(Boolean) as { defId: string; instanceId: string }[]),
        ];
        for (const id of beforeHand) {
          if (!afterHand.has(id)) {
            const found = allPossibleLocations.find((c) => c!.instanceId === id);
            if (found) played[pid].add(found.defId);
          }
        }
        continue;
      }
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
      sampleBoardState();
      for (const pid of ['player1', 'player2'] as PlayerId[]) {
        if (totalCards(pid) !== 30) {
          throw new Error(`Card conservation broken for ${pid}: has ${totalCards(pid)} expected 30`);
        }
      }
      turns += 1;
      useGameStore.getState().endTurn();
      continue;
    }
  }

  countVoidReshufflesInLog();
  const finalState = useGameStore.getState();

  const drawn: Record<PlayerId, string[]> = { player1: [], player2: [] };
  for (const pid of ['player1', 'player2'] as PlayerId[]) {
    const drawnCount = startingDeckOrder[pid].length - finalState.players[pid].deck.length;
    drawn[pid] = [...openingHandDefIds[pid], ...startingDeckOrder[pid].slice(0, Math.max(0, drawnCount))];
  }

  const winnerFinalO2 = finalState.winnerId ? finalState.players[finalState.winnerId].o2 : null;

  return {
    turns,
    ms: Date.now() - startedAt,
    winner: finalState.winnerId,
    firstPlayerId,
    winnerFinalO2,
    voidReshuffles,
    sawTwoApexBoard,
    riftId,
    player1Played: played.player1,
    player2Played: played.player2,
    player1Drawn: new Set(drawn.player1),
    player2Drawn: new Set(drawn.player2),
  };
}

const O2_LEVELS = [12, 24, 48, 96];
const GAMES_PER_PAIRING = 8;

interface FactionAgg {
  wins: number;
  games: number;
  turnsSum: number;
  msSum: number;
  timeouts: number;
  firstPlayerGames: number;
  firstPlayerWins: number;
  winnerFinalO2Sum: number;
  winnerFinalO2Count: number;
  blowouts: number;
  closeGames: number;
  gamesWithVoidReshuffle: number;
  totalVoidReshuffles: number;
  gamesWithTwoApexBoard: number;
}

function freshAgg(): FactionAgg {
  return {
    wins: 0, games: 0, turnsSum: 0, msSum: 0, timeouts: 0,
    firstPlayerGames: 0, firstPlayerWins: 0,
    winnerFinalO2Sum: 0, winnerFinalO2Count: 0,
    blowouts: 0, closeGames: 0,
    gamesWithVoidReshuffle: 0, totalVoidReshuffles: 0,
    gamesWithTwoApexBoard: 0,
  };
}

interface CardAgg {
  faction: Faction;
  timesDrawn: number;
  timesPlayed: number;
  gamesPlayedIn: number;
  winsWhenPlayed: number;
}

function main() {
  let gamesRun = 0;
  let crashed = 0;
  const startedAt = Date.now();

  const statsByO2: Record<number, Record<Faction, FactionAgg>> = {};
  const mirrorStatsByO2: Record<number, Record<Faction, FactionAgg>> = {};
  const riftFactionWins: Record<string, Record<Faction, { wins: number; games: number }>> = {};
  const cardStats: Record<string, CardAgg> = {};

  for (const o2 of O2_LEVELS) {
    statsByO2[o2] = { 'Neon Underground': freshAgg(), 'Dark White': freshAgg(), 'Synth Ascendancy': freshAgg() };
    mirrorStatsByO2[o2] = { 'Neon Underground': freshAgg(), 'Dark White': freshAgg(), 'Synth Ascendancy': freshAgg() };
  }

  for (const o2 of O2_LEVELS) {
    const maxTurns = Math.max(150, Math.round(150 * (o2 / 12)));

    for (const f1 of FACTIONS) {
      for (const f2 of FACTIONS) {
        const isMirror = f1 === f2;
        for (let i = 0; i < GAMES_PER_PAIRING; i++) {
          gamesRun += 1;
          try {
            const rec = runOneGame(f1, f2, maxTurns, o2);

            for (const pid of ['player1', 'player2'] as PlayerId[]) {
              const faction = pid === 'player1' ? f1 : f2;
              const st = statsByO2[o2][faction];
              const won = rec.winner === pid;

              st.games += 1;
              st.turnsSum += rec.turns;
              st.msSum += rec.ms;
              if (won) st.wins += 1;
              if (rec.winner === null) st.timeouts += 1;
              if (rec.firstPlayerId === pid) {
                st.firstPlayerGames += 1;
                if (won) st.firstPlayerWins += 1;
              }
              if (won && rec.winnerFinalO2 !== null) {
                st.winnerFinalO2Sum += rec.winnerFinalO2;
                st.winnerFinalO2Count += 1;
                if (rec.winnerFinalO2 >= o2 * 0.5) st.blowouts += 1;
                if (rec.winnerFinalO2 <= Math.max(1, o2 * 0.15)) st.closeGames += 1;
              }
              if (rec.voidReshuffles > 0) st.gamesWithVoidReshuffle += 1;
              st.totalVoidReshuffles += rec.voidReshuffles;
              if (rec.sawTwoApexBoard) st.gamesWithTwoApexBoard += 1;

              if (isMirror) {
                const mst = mirrorStatsByO2[o2][faction];
                mst.games += 1;
                mst.turnsSum += rec.turns;
                if (won) mst.wins += 1;
                if (rec.winner === null) mst.timeouts += 1;
              }

              if (o2 === 12 && rec.riftId) {
                riftFactionWins[rec.riftId] ??= { 'Neon Underground': { wins: 0, games: 0 }, 'Dark White': { wins: 0, games: 0 }, 'Synth Ascendancy': { wins: 0, games: 0 } };
                riftFactionWins[rec.riftId][faction].games += 1;
                if (won) riftFactionWins[rec.riftId][faction].wins += 1;
              }

              if (o2 === 12) {
                const playedSet = pid === 'player1' ? rec.player1Played : rec.player2Played;
                const drawnSet = pid === 'player1' ? rec.player1Drawn : rec.player2Drawn;
                for (const defId of drawnSet) {
                  cardStats[defId] ??= { faction, timesDrawn: 0, timesPlayed: 0, gamesPlayedIn: 0, winsWhenPlayed: 0 };
                  cardStats[defId].timesDrawn += 1;
                }
                for (const defId of playedSet) {
                  cardStats[defId] ??= { faction, timesDrawn: 0, timesPlayed: 0, gamesPlayedIn: 0, winsWhenPlayed: 0 };
                  cardStats[defId].timesPlayed += 1;
                  cardStats[defId].gamesPlayedIn += 1;
                  if (won) cardStats[defId].winsWhenPlayed += 1;
                }
              }
            }
          } catch (e) {
            crashed += 1;
            console.error(`\n!!! GAME CRASHED: O2=${o2} ${f1} vs ${f2} [run ${i}] !!!`);
            console.error(e);
          }
        }
      }
    }
    console.log(`O2=${o2} batch complete (${gamesRun} games run so far, ${((Date.now() - startedAt) / 1000).toFixed(0)}s elapsed)`);
  }

  console.log('\n\n=== BALANCE SUMMARY ===\n');
  for (const o2 of O2_LEVELS) {
    console.log(`--- O2 = ${o2} ---`);
    const rows = FACTIONS.map((f) => {
      const st = statsByO2[o2][f];
      return { faction: f, st, winRate: st.games > 0 ? (st.wins / st.games) * 100 : 0 };
    }).sort((a, b) => b.winRate - a.winRate);

    rows.forEach((r, i) => {
      const st = r.st;
      const avgTurns = st.games > 0 ? (st.turnsSum / st.games).toFixed(1) : '0';
      const avgMs = st.games > 0 ? (st.msSum / st.games).toFixed(0) : '0';
      const fpWinRate = st.firstPlayerGames > 0 ? ((st.firstPlayerWins / st.firstPlayerGames) * 100).toFixed(1) : 'n/a';
      const avgWinnerO2 = st.winnerFinalO2Count > 0 ? (st.winnerFinalO2Sum / st.winnerFinalO2Count).toFixed(1) : 'n/a';
      const blowoutPct = st.wins > 0 ? ((st.blowouts / st.wins) * 100).toFixed(0) : '0';
      const closePct = st.wins > 0 ? ((st.closeGames / st.wins) * 100).toFixed(0) : '0';
      const voidPct = st.games > 0 ? ((st.gamesWithVoidReshuffle / st.games) * 100).toFixed(1) : '0';
      const twoApexPct = st.games > 0 ? ((st.gamesWithTwoApexBoard / st.games) * 100).toFixed(1) : '0';
      console.log(`  #${i + 1} ${r.faction}: ${r.winRate.toFixed(1)}% win rate (${st.wins}/${st.games})`);
      console.log(`       avg ${avgTurns} turns/game, avg ${avgMs}ms/game sim time`);
      console.log(`       first-player win rate when this faction went first: ${fpWinRate}%`);
      console.log(`       avg winner's remaining O2 when this faction won: ${avgWinnerO2} / ${o2}`);
      console.log(`       of this faction's wins: ${blowoutPct}% blowouts (>=50% O2 left), ${closePct}% close games (<=15% O2 left)`);
      console.log(`       void reshuffled at least once in ${voidPct}% of games; two-Apex board seen in ${twoApexPct}% of games`);
    });

    console.log(`  Mirror matches only (expected ~50% each if no P1/P2 turn-order bias):`);
    for (const f of FACTIONS) {
      const mst = mirrorStatsByO2[o2][f];
      const winRate = mst.games > 0 ? ((mst.wins / mst.games) * 100).toFixed(1) : '0.0';
      console.log(`    ${f} vs itself: ${winRate}% (${mst.wins}/${mst.games})`);
    }
    console.log('');
  }

  console.log('=== RIFT x FACTION (O2=12 only) ===');
  for (const riftId of Object.keys(riftFactionWins)) {
    console.log(`  ${riftId}:`);
    const rows = FACTIONS.map((f) => {
      const r = riftFactionWins[riftId][f];
      return { f, winRate: r.games > 0 ? (r.wins / r.games) * 100 : 0, games: r.games, wins: r.wins };
    }).sort((a, b) => b.winRate - a.winRate);
    rows.forEach((r) => console.log(`    ${r.f}: ${r.winRate.toFixed(1)}% (${r.wins}/${r.games})`));
  }

  console.log('\n=== TOP/BOTTOM 15 CARDS BY WIN RATE WHEN PLAYED (O2=12, min 10 plays) ===');
  const cardRows = Object.entries(cardStats)
    .map(([defId, c]) => ({ defId, name: getCardDef(defId).name, ...c, winRateWhenPlayed: c.gamesPlayedIn > 0 ? (c.winsWhenPlayed / c.gamesPlayedIn) * 100 : 0 }))
    .filter((c) => c.timesPlayed >= 10)
    .sort((a, b) => b.winRateWhenPlayed - a.winRateWhenPlayed);
  console.log('  Top 15:');
  cardRows.slice(0, 15).forEach((c) => console.log(`    ${c.name} (${c.faction}): ${c.winRateWhenPlayed.toFixed(1)}% win rate when played (${c.timesPlayed} plays, ${c.timesDrawn} draws)`));
  console.log('  Bottom 15:');
  cardRows.slice(-15).reverse().forEach((c) => console.log(`    ${c.name} (${c.faction}): ${c.winRateWhenPlayed.toFixed(1)}% win rate when played (${c.timesPlayed} plays, ${c.timesDrawn} draws)`));

  console.log(`\nTotal games run: ${gamesRun}, crashed: ${crashed}, total time: ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
  if (crashed > 0) process.exitCode = 1;

  console.log('\n=== RAW JSON ===');
  console.log(JSON.stringify({ statsByO2, mirrorStatsByO2, riftFactionWins, cardStats, gamesRun, crashed }, (_k, v) => (v instanceof Set ? [...v] : v), 2));
}

main();
