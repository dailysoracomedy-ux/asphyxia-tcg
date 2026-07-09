/* Targeted tests for the "quick polish" patch:
   1-4: Attack selector damage preview (getPreviewAttackDamage) matches actual combat.
   5-8: Chain indicators (getChainedSupportFor / getChainLabelForSupport).
   9-12: Momentum cap at 3. */
import { useGameStore } from '../store/gameStore';
import { createInstance } from '../data/decks';
import { getCardDef } from '../data/cards';
import {
  getPreviewAttackDamage,
  getChainedSupportFor,
  getChainLabelForSupport,
  gainMomentumFn,
  loseMomentumFn,
  MAX_MOMENTUM,
  addCounterFn,
  armAttackBonusFn,
} from '../game/rules';
import { produce } from 'immer';
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
    reconfigureUsedThisTurn: false, equipSwapUsedThisTurn: false,
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
    gameOverReason: null, vsAI: false,
  };
  useGameStore.setState(state);
  return { p1ApexId: p1Apex.instanceId, p2ApexId: p2Apex.instanceId };
}

console.log('=== Test 1: Attack selector shows modified damage when an armed bonus is active ===');
{
  const { p1ApexId } = setupCombat({ p1DefId: 'nu-riot-runner', p2DefId: 'dw-glass-warden' });
  useGameStore.setState(produce(useGameStore.getState(), (s) => armAttackBonusFn(s, p1ApexId, 200)));
  const preview = getPreviewAttackDamage(useGameStore.getState(), p1ApexId, 'mob-charge')!;
  check('base damage is 400', preview.baseDamage === 400);
  check('modified damage includes the +200 armed bonus (600)', preview.modifiedDamage === 600);
  check('modifier breakdown lists the armed bonus', preview.modifiers.some((m) => m.label === 'armed bonus' && m.amount === 200));
}

console.log('=== Test 2: Attack selector shows modified damage when an Equip bonus is active ===');
{
  const { p1ApexId } = setupCombat({ p1DefId: 'nu-riot-runner', p2DefId: 'dw-glass-warden' });
  const plasmaEdge = createInstance('nu-plasma-edge', 'Equip');
  useGameStore.setState((s) => ({
    players: { ...s.players, player1: { ...s.players.player1, apexSlots: [{ ...s.players.player1.apexSlots[0]!, equip: plasmaEdge }, null] } },
  }));
  const preview = getPreviewAttackDamage(useGameStore.getState(), p1ApexId, 'mob-charge')!;
  check('modified damage includes the +100 Plasma Edge bonus (500)', preview.modifiedDamage === 500);
  check('modifier breakdown names Plasma Edge', preview.modifiers.some((m) => m.label === 'Plasma Edge' && m.amount === 100));
}

console.log('=== Test 3: Attack selector shows modified damage when a Choke Counter reduces damage ===');
{
  const { p1ApexId } = setupCombat({ p1DefId: 'nu-riot-runner', p2DefId: 'dw-glass-warden' });
  useGameStore.setState(produce(useGameStore.getState(), (s) => addCounterFn(s, p1ApexId, 'choke', 1)));
  const preview = getPreviewAttackDamage(useGameStore.getState(), p1ApexId, 'mob-charge')!;
  check('modified damage is reduced by the Choke Counter penalty (300)', preview.modifiedDamage === 300);
  check('modifier breakdown lists the Choke Counter penalty as negative', preview.modifiers.some((m) => m.label === 'Choke Counter x1' && m.amount === -100));
}

console.log('=== Test 4: Preview matches actual resolved damage (no opponent Reaction) ===');
{
  const { p1ApexId, p2ApexId } = setupCombat({ p1DefId: 'nu-riot-runner', p2DefId: 'dw-glass-warden' });
  useGameStore.setState(produce(useGameStore.getState(), (s) => armAttackBonusFn(s, p1ApexId, 200)));
  const preview = getPreviewAttackDamage(useGameStore.getState(), p1ApexId, 'mob-charge', p2ApexId)!;
  useGameStore.getState().declareAttack(p1ApexId, 'mob-charge', p2ApexId);
  const log = useGameStore.getState().log.map((l) => l.message);
  check(`preview's 600 total matches the actually-declared damage in the log`, log.some((m) => m.includes(`for ${preview.modifiedDamage} damage`)));
}

console.log('=== Test 5 & 6: Chain indicators show the correct Apex <-> Support relationship ===');
{
  const s = useGameStore.getState();
  s.startNewGame('Neon Underground', 'Dark White');
  let guard = 0;
  while (useGameStore.getState().status === 'selectingOpeningApex' && guard < 5) {
    guard += 1;
    const st = useGameStore.getState();
    const pid = st.openingApexSelectionPlayerId!;
    const apex = st.players[pid].hand.find((c) => c.type === 'Apex')!;
    st.selectOpeningApex(pid, apex.instanceId);
  }
  while (useGameStore.getState().phase !== 'Main') {
    const st = useGameStore.getState();
    if (st.phase === 'Start' && st.startPhasePending) st.advancePhase('Start');
    else if (st.phase === 'Start') st.advancePhase('Main');
  }
  const active = useGameStore.getState().activePlayerId;
  const apexId = useGameStore.getState().players[active].apexSlots.find(Boolean)!.instanceId;
  const apexName = getCardDef(useGameStore.getState().players[active].apexSlots.find(Boolean)!.defId).name;
  const sparkPlug = createInstance('nu-spark-plug', 'AbilitySupport');
  useGameStore.setState((state) => ({
    players: { ...state.players, [active]: { ...state.players[active], hand: [...state.players[active].hand, sparkPlug] } },
  }));
  useGameStore.getState().playSupportCard(sparkPlug.instanceId, undefined, apexId);

  const chainedSupport = getChainedSupportFor(useGameStore.getState(), active, apexId);
  check('Apex correctly shows which Ability Support is chained to it', chainedSupport?.instanceId === sparkPlug.instanceId);

  const chainLabel = getChainLabelForSupport(useGameStore.getState(), active, sparkPlug.instanceId);
  check(`Support correctly shows which Apex it is chained to ("Chain -> ${apexName}")`, chainLabel === `Chain -> ${apexName}`);
}

console.log('=== Test 7: Battery Supports show no chain info ===');
{
  const { } = setupCombat({ p1DefId: 'nu-riot-runner', p2DefId: 'dw-glass-warden' });
  const deadBattery = createInstance('nu-dead-battery', 'BatterySupport');
  useGameStore.setState((s) => ({
    players: { ...s.players, player1: { ...s.players.player1, supportSlots: [deadBattery, null, null] } },
  }));
  const chainLabel = getChainLabelForSupport(useGameStore.getState(), 'player1', deadBattery.instanceId);
  check('Battery Support returns no chain label at all (null)', chainLabel === null);
}

console.log('=== Test 8: Unchained Ability Support shows "Unchained" ===');
{
  const { } = setupCombat({ p1DefId: 'nu-riot-runner', p2DefId: 'dw-glass-warden' });
  const sparkPlug = createInstance('nu-spark-plug', 'AbilitySupport'); // chainedApexId is null by default
  useGameStore.setState((s) => ({
    players: { ...s.players, player1: { ...s.players.player1, supportSlots: [sparkPlug, null, null] } },
  }));
  const chainLabel = getChainLabelForSupport(useGameStore.getState(), 'player1', sparkPlug.instanceId);
  check('Unchained Ability Support shows "Unchained"', chainLabel === 'Unchained');
}

console.log('=== Test 9: Momentum cannot exceed 3 from Civil War ===');
{
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  const p2Apex = createInstance('dw-overseer-prime', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { o2: 4, momentum: 3 });
  const p2 = fixturePlayer('player2', 'Dark White', p2Apex, { o2: 12 });
  const civilWar = { id: 'CivilWar' as const, name: 'Civil War', description: '', shortDescription: '' };
  const state: GameState = {
    status: 'playing', players: { player1: p1, player2: p2 }, activePlayerId: 'player1', firstPlayerId: 'player1',
    turnNumber: 3, phase: 'Start', riftSpace: civilWar, log: [], winnerId: null, pendingResponseQueue: [],
    isFirstTurnOverall: false, selectedFactions: { player1: 'Neon Underground', player2: 'Dark White' },
    openingApexSelectionPlayerId: null, reconfigureAwaitingPlay: false, startPhasePending: true,
    debugMode: false, gameOverReason: null, vsAI: false,
  };
  useGameStore.setState(state);
  useGameStore.getState().advancePhase('Start');
  useGameStore.getState().resolveResponse({ type: 'civilWar', pick: 'momentum' });
  check('Momentum stays at 3 despite Civil War trying to grant more (already trailing on O2)', useGameStore.getState().players.player1.momentum === 3);
  check('log notes player is already at max Momentum', useGameStore.getState().log.some((l) => l.message.includes('already at max Momentum')));
}

console.log('=== Test 10: Momentum cannot exceed 3 from Apex Break Reward ===');
{
  const { p1ApexId, p2ApexId } = setupCombat({
    p1DefId: 'nu-riot-runner',
    p2DefId: 'dw-overseer-prime',
    p1Overrides: { momentum: 3 },
  });
  useGameStore.getState().declareAttack(p1ApexId, 'mob-charge', p2ApexId);
  check('Momentum is still capped at 3 after Apex Break Reward would have granted more', useGameStore.getState().players.player1.momentum === 3);
}

console.log('=== Test 11: Momentum cannot exceed 3 from card effects (direct helper check) ===');
{
  const p1 = fixturePlayer('player1', 'Neon Underground', null, { momentum: 2 });
  const p2 = fixturePlayer('player2', 'Dark White', null);
  const state: GameState = {
    status: 'playing', players: { player1: p1, player2: p2 }, activePlayerId: 'player1', firstPlayerId: 'player1',
    turnNumber: 2, phase: 'Main', riftSpace: null, log: [], winnerId: null, pendingResponseQueue: [],
    isFirstTurnOverall: false, selectedFactions: { player1: 'Neon Underground', player2: 'Dark White' },
    openingApexSelectionPlayerId: null, reconfigureAwaitingPlay: false, startPhasePending: false,
    debugMode: false, gameOverReason: null, vsAI: false,
  };
  useGameStore.setState(state);
  gainMomentumFn(useGameStore.getState(), 'player1', 5); // wildly over-gain from a hypothetical card effect
  check('Momentum caps at 3 even from a large over-gain', useGameStore.getState().players.player1.momentum === MAX_MOMENTUM);
  check('log notes the cap was hit', useGameStore.getState().log.some((l) => l.message.includes('capped at 3')));
}

console.log('=== Test 12: Spending Momentum still works after being capped at 3 ===');
{
  const p1 = fixturePlayer('player1', 'Neon Underground', null, { momentum: 3 });
  const p2 = fixturePlayer('player2', 'Dark White', null);
  const state: GameState = {
    status: 'playing', players: { player1: p1, player2: p2 }, activePlayerId: 'player1', firstPlayerId: 'player1',
    turnNumber: 2, phase: 'Main', riftSpace: null, log: [], winnerId: null, pendingResponseQueue: [],
    isFirstTurnOverall: false, selectedFactions: { player1: 'Neon Underground', player2: 'Dark White' },
    openingApexSelectionPlayerId: null, reconfigureAwaitingPlay: false, startPhasePending: false,
    debugMode: false, gameOverReason: null, vsAI: false,
  };
  useGameStore.setState(state);
  loseMomentumFn(useGameStore.getState(), 'player1', 2);
  check('spending 2 Momentum from a capped 3 leaves exactly 1', useGameStore.getState().players.player1.momentum === 1);
  gainMomentumFn(useGameStore.getState(), 'player1', 5);
  check('can gain back up to the cap again after spending', useGameStore.getState().players.player1.momentum === MAX_MOMENTUM);
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
