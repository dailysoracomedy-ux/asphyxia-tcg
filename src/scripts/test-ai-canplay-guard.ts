/* Regression test for a real bug reported from live gameplay: the AI would try to
   play a Special whose canPlay() precondition failed (e.g. Ascension Complete
   requires "played another card earlier this turn"), get silently rejected, but
   still claim it had acted - causing the AI driver to retry the exact same illegal
   play forever (100+ repeated "cannot be played right now" log lines, game frozen). */
import { useGameStore } from '../store/gameStore';
import { createInstance } from '../data/decks';
import { aiPlayOneMainPhaseAction } from '../game/ai';
import type { GameState, PlayerState, PlayerId, Faction } from '../types/game';

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`  PASS: ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

function freshTurnFlags() {
  return {
    specialsPlayedThisTurn: 0,
    supportsPlayedThisTurn: 0,
    instantsPlayedThisTurn: 0,
    cardsPlayedThisTurn: 0,
    reconfigureUsedThisTurn: false,
    directO2LossThisTurn: 0,
    firstSpecialResolved: false,
    chokeCounterPlacedThisTurn: false,
    ownEffectO2LossThisTurn: false,
    recursiveGlitchPlacedThisTurn: false,
    civilWarBonusArmedThisTurn: false,
  };
}

function fixturePlayer(id: PlayerId, faction: Faction, apex: ReturnType<typeof createInstance> | null, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    faction,
    deck: [],
    hand: [],
    voidZone: [],
    apexSlots: [apex, null],
    supportSlots: [null, null, null],
    o2: 12,
    momentum: 0,
    availableSync: 3,
    turnFlags: freshTurnFlags(),
    pendingAttackBonus: 0,
    pendingTargetedAttackBonus: null,
    reserveGridShield: 0,
    lockedSupportInstanceId: null,
    ...overrides,
  };
}

function fixtureState(p1: PlayerState, p2: PlayerState, extra: Partial<GameState> = {}): GameState {
  return {
    status: 'playing',
    players: { player1: p1, player2: p2 },
    activePlayerId: 'player2',
    firstPlayerId: 'player1',
    turnNumber: 11,
    phase: 'Main',
    riftSpace: null,
    log: [],
    winnerId: null,
    pendingResponseQueue: [],
    isFirstTurnOverall: false,
    selectedFactions: { player1: p1.faction, player2: p2.faction },
    openingApexSelectionPlayerId: null,
    reconfigureAwaitingPlay: false,
    startPhasePending: false,
    debugMode: false,
    gameOverReason: null,
    vsAI: true,
    ...extra,
  };
}

console.log('=== Reproduction: Ascension Complete cannot be played (canPlay fails), AI must not loop forever ===');
{
  const apexWithUpgrade = createInstance('sa-chrome-seraph', 'Apex');
  apexWithUpgrade.counters = { choke: 0, glitch: 0, upgrade: 1 }; // has an upgrade counter, so targeting alone is NOT the blocker
  const ascensionComplete = createInstance('sa-ascension-complete', 'Special');
  const p2 = fixturePlayer('player2', 'Synth Ascendancy', apexWithUpgrade, {
    hand: [ascensionComplete],
    turnFlags: { ...freshTurnFlags(), cardsPlayedThisTurn: 0 }, // nothing played yet this turn -> canPlay() is false
  });
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex')), p2, { activePlayerId: 'player2' }));

  const acted = aiPlayOneMainPhaseAction('player2');
  check('AI correctly reports it did NOT act (nothing legal to do)', acted === false);
  check('Ascension Complete is still in hand (rejected play never consumed it)', useGameStore.getState().players.player2.hand.some((c) => c.instanceId === ascensionComplete.instanceId));
  const log = useGameStore.getState().log.map((l) => l.message);
  check('at most one rejection was logged, not a runaway loop', log.filter((m) => m.includes('cannot be played right now')).length <= 1);
}

console.log('=== Once the canPlay precondition is actually met, the AI plays it normally ===');
{
  const apexWithUpgrade = createInstance('sa-chrome-seraph', 'Apex');
  apexWithUpgrade.counters = { choke: 0, glitch: 0, upgrade: 1 };
  const ascensionComplete = createInstance('sa-ascension-complete', 'Special');
  const p2 = fixturePlayer('player2', 'Synth Ascendancy', apexWithUpgrade, {
    hand: [ascensionComplete],
    turnFlags: { ...freshTurnFlags(), cardsPlayedThisTurn: 1, specialsPlayedThisTurn: 0 }, // already played something else this turn
  });
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex')), p2, { activePlayerId: 'player2' }));

  const acted = aiPlayOneMainPhaseAction('player2');
  check('AI plays it successfully once canPlay() is satisfied', acted === true);
  check('Ascension Complete left the hand', !useGameStore.getState().players.player2.hand.some((c) => c.instanceId === ascensionComplete.instanceId));
}

console.log('=== A full AI turn never stalls even when the hand contains an initially-unplayable Special ===');
{
  const apexWithUpgrade = createInstance('sa-chrome-seraph', 'Apex');
  apexWithUpgrade.counters = { choke: 0, glitch: 0, upgrade: 1 };
  const ascensionComplete = createInstance('sa-ascension-complete', 'Special'); // unplayable at first (nothing played yet)
  const battery = createInstance('nu-dead-battery', 'BatterySupport'); // wrong faction is fine for this isolated fixture test
  const p2 = fixturePlayer('player2', 'Synth Ascendancy', apexWithUpgrade, { hand: [ascensionComplete, battery] });
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex')), p2, { activePlayerId: 'player2' }));

  let guard = 0;
  let acted = true;
  while (acted && guard < 20) {
    guard += 1;
    acted = aiPlayOneMainPhaseAction('player2');
  }
  check('the AI Main Phase loop terminates well under the guard (moved past the unplayable card)', guard < 20);
  check('the Battery Support (a legal play) was played even though Ascension Complete came first in priority order attempts', useGameStore.getState().players.player2.supportSlots.some((s) => s?.instanceId === battery.instanceId));
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
