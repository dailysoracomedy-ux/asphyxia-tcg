/* Regression test locking in the rescaled card-specific O2 thresholds (per direct
   request, following the O2 pool rebalance from 6 to 12). Each card's threshold was
   scaled to preserve its original fraction of the pool:
     - Last Breath Rush, No Gods in the Gutters, Emergency Authority, Backup
       Consciousness: "O2 is 2 or lower" (2/6 = 33%) -> "O2 is 4 or lower" (4/12 = 33%)
     - Echo Riot rift: "3 or less" (3/6 = 50%) -> "6 or less" (6/12 = 50%)
   Relative comparisons (Riot Runner's passive, Civil War) were deliberately left
   untouched since they don't depend on the pool size. */
import { useGameStore } from '../store/gameStore';
import { createInstance } from '../data/decks';
import { getCardDef } from '../data/cards';
import { determineRiftSpace } from '../game/rifts';
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
  };
}

function fixturePlayer(id: PlayerId, faction: Faction, apex: ReturnType<typeof createInstance> | null, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    faction,
    deck: [],
    hand: [],
    discard: [],
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

function setupCombat(opts: { p1DefId: string; p2DefId: string; p1Overrides?: Partial<PlayerState>; p2Overrides?: Partial<PlayerState> }) {
  const p1Apex = createInstance(opts.p1DefId, 'Apex');
  const p1Faction = getCardDef(opts.p1DefId).faction;
  const p2Apex = createInstance(opts.p2DefId, 'Apex');
  const p2Faction = getCardDef(opts.p2DefId).faction;
  const p1 = fixturePlayer('player1', p1Faction, p1Apex, opts.p1Overrides);
  const p2 = fixturePlayer('player2', p2Faction, p2Apex, opts.p2Overrides);
  const state: GameState = {
    status: 'playing',
    players: { player1: p1, player2: p2 },
    activePlayerId: 'player1',
    firstPlayerId: 'player1',
    turnNumber: 2,
    phase: 'Combat',
    riftSpace: null,
    log: [],
    winnerId: null,
    pendingResponseQueue: [],
    isFirstTurnOverall: false,
    selectedFactions: { player1: p1Faction, player2: p2Faction },
    openingApexSelectionPlayerId: null,
    reconfigureAwaitingPlay: false,
    startPhasePending: false,
    debugMode: false,
    gameOverReason: null,
  };
  useGameStore.setState(state);
  return { p1ApexId: p1Apex.instanceId, p2ApexId: p2Apex.instanceId };
}

console.log('=== Last Breath Rush: +100 damage at O2 <= 4, not at O2 = 5 ===');
{
  // Riot Runner (400 DEF) vs Glass Warden (600 DEF, high enough to survive either way) so we
  // can read the bonus purely off the logged attack total rather than a destroy/survive branch.
  // Both players' O2 is set equal in each case so Riot Runner's separate *relative* passive trait
  // ("if your O2 is lower than your opponent's") never fires and confounds this specific check.
  let { p1ApexId, p2ApexId } = setupCombat({
    p1DefId: 'nu-riot-runner',
    p2DefId: 'dw-glass-warden',
    p1Overrides: { o2: 4 },
    p2Overrides: { o2: 4 },
  });
  useGameStore.getState().declareAttack(p1ApexId, 'last-breath-rush', p2ApexId);
  const logAt4 = useGameStore.getState().log.map((l) => l.message);
  check('at O2=4, Last Breath Rush gains its own +100 bonus', logAt4.some((m) => m.includes('Last Breath Rush bonus condition met')));

  ({ p1ApexId, p2ApexId } = setupCombat({
    p1DefId: 'nu-riot-runner',
    p2DefId: 'dw-glass-warden',
    p1Overrides: { o2: 5 },
    p2Overrides: { o2: 5 },
  }));
  useGameStore.getState().declareAttack(p1ApexId, 'last-breath-rush', p2ApexId);
  const logAt5 = useGameStore.getState().log.map((l) => l.message);
  check('at O2=5, Last Breath Rush does NOT gain its own bonus', !logAt5.some((m) => m.includes('Last Breath Rush bonus condition met')));
}

console.log('=== No Gods in the Gutters: momentum+primed-bonus at O2 <= 4, not at O2 = 5 ===');
{
  function setupMainPhase(o2: number, card: ReturnType<typeof createInstance>) {
    const p1Apex = createInstance('nu-riot-runner', 'Apex');
    const p2Apex = createInstance('dw-overseer-prime', 'Apex');
    const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { o2, hand: [card] });
    const p2 = fixturePlayer('player2', 'Dark White', p2Apex);
    const state: GameState = {
      status: 'playing',
      players: { player1: p1, player2: p2 },
      activePlayerId: 'player1',
      firstPlayerId: 'player1',
      turnNumber: 2,
      phase: 'Main',
      riftSpace: null,
      log: [],
      winnerId: null,
      pendingResponseQueue: [],
      isFirstTurnOverall: false,
      selectedFactions: { player1: 'Neon Underground', player2: 'Dark White' },
      openingApexSelectionPlayerId: null,
      reconfigureAwaitingPlay: false,
      startPhasePending: false,
      debugMode: false,
      gameOverReason: null,
    };
    useGameStore.setState(state);
  }

  const card4 = createInstance('nu-no-gods', 'Special');
  setupMainPhase(4, card4);
  const momentumBefore4 = useGameStore.getState().players.player1.momentum;
  useGameStore.getState().playSpecialCard(card4.instanceId);
  check('at O2=4, No Gods grants the bonus Momentum', useGameStore.getState().players.player1.momentum === momentumBefore4 + 1);

  const card5 = createInstance('nu-no-gods', 'Special');
  setupMainPhase(5, card5);
  const momentumBefore5 = useGameStore.getState().players.player1.momentum;
  useGameStore.getState().playSpecialCard(card5.instanceId);
  check('at O2=5, No Gods does NOT grant the bonus Momentum', useGameStore.getState().players.player1.momentum === momentumBefore5);
}

console.log('=== Echo Riot rift: Momentum at start of turn when both players have O2 <= 6, not at 7 ===');
{
  const riftEchoRiot = determineRiftSpace('Neon Underground', 'Neon Underground');
  check('Neon vs Neon correctly resolves to Echo Riot', riftEchoRiot.id === 'EchoRiot');

  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  const p2Apex = createInstance('nu-street-beast', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { o2: 6 });
  const p2 = fixturePlayer('player2', 'Neon Underground', p2Apex, { o2: 6 });
  const stateAt6: GameState = {
    status: 'playing',
    players: { player1: p1, player2: p2 },
    activePlayerId: 'player1',
    firstPlayerId: 'player1',
    turnNumber: 3,
    phase: 'Start',
    riftSpace: riftEchoRiot,
    log: [],
    winnerId: null,
    pendingResponseQueue: [],
    isFirstTurnOverall: false,
    selectedFactions: { player1: 'Neon Underground', player2: 'Neon Underground' },
    openingApexSelectionPlayerId: null,
    reconfigureAwaitingPlay: false,
    startPhasePending: true,
    debugMode: false,
    gameOverReason: null,
  };
  useGameStore.setState(stateAt6);
  useGameStore.getState().advancePhase('Start');
  check('at O2=6 for both players, Echo Riot grants Momentum at Start Phase', useGameStore.getState().players.player1.momentum === 1);

  const p1b = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { o2: 7 });
  const p2b = fixturePlayer('player2', 'Neon Underground', createInstance('nu-street-beast', 'Apex'), { o2: 7 });
  useGameStore.setState({ ...stateAt6, players: { player1: p1b, player2: p2b }, log: [] });
  useGameStore.getState().advancePhase('Start');
  check('at O2=7 for both players, Echo Riot does NOT grant Momentum', useGameStore.getState().players.player1.momentum === 0);
}

console.log('=== Backup Consciousness: places Upgrade+Glitch counters at O2 <= 4, not at O2 = 5 ===');
{
  function runBackupConsciousnessAt(defenderO2: number) {
    const backupConsciousness = createInstance('sa-backup-consciousness', 'Reaction');
    const { p1ApexId, p2ApexId } = setupCombat({
      p1DefId: 'nu-riot-runner',
      p2DefId: 'sa-halcyon-maw', // 400 DEF, exact match for Mob Charge
      p2Overrides: { o2: defenderO2, momentum: 1, hand: [backupConsciousness] },
    });
    useGameStore.getState().declareAttack(p1ApexId, 'mob-charge', p2ApexId);
    const item = useGameStore.getState().pendingResponseQueue[0];
    if (item && item.stage === 'reactionChoice') {
      useGameStore.getState().resolveResponse({ type: 'reaction', cardInstanceId: backupConsciousness.instanceId });
    }
    return useGameStore.getState().players.player2.apexSlots[0];
  }

  const survivorAt4 = runBackupConsciousnessAt(4);
  check(
    'at O2=4, Backup Consciousness also places Upgrade+Glitch counters',
    (survivorAt4?.counters?.upgrade ?? 0) > 0 && (survivorAt4?.counters?.glitch ?? 0) > 0
  );

  const survivorAt5 = runBackupConsciousnessAt(5);
  check(
    'at O2=5, Backup Consciousness survives but does NOT place the extra counters',
    (survivorAt5?.counters?.upgrade ?? 0) === 0 && (survivorAt5?.counters?.glitch ?? 0) === 0
  );
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
