/* Targeted verification tests for the Engine Tag System / getEligibleResponses helper,
   per the 9 scenarios requested. Uses small hand-built state fixtures for the pure
   eligibility checks (1-7) and the real store for the structural checks (8-9). */
import { getEligibleResponses, MAX_O2 } from '../game/rules';
import { getCardDef } from '../data/cards';
import { createInstance } from '../data/decks';
import { useGameStore } from '../store/gameStore';
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

function fixturePlayer(id: PlayerId, faction: Faction, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    faction,
    deck: [],
    hand: [],
    voidZone: [],
    apexSlots: [null, null],
    supportSlots: [null, null, null],
    o2: MAX_O2,
    momentum: 0,
    availableSync: 0,
    turnFlags: {
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
    },
    pendingAttackBonus: 0,
    pendingTargetedAttackBonus: null,
    reserveGridShield: 0,
    lockedSupportInstanceId: null,
    ...overrides,
  };
}

function fixtureState(p1: PlayerState, p2: PlayerState): GameState {
  return {
    status: 'playing',
    players: { player1: p1, player2: p2 },
    activePlayerId: 'player1',
    firstPlayerId: 'player1',
    turnNumber: 5,
    phase: 'Combat',
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
    gameOverReason: null, vsAI: false,
  };
}

console.log('=== Scenario 1: attacker attacks, defender has no eligible instant card ===');
{
  const p1 = fixturePlayer('player1', 'Neon Underground', { momentum: 5 });
  const p2 = fixturePlayer('player2', 'Dark White', { momentum: 5, hand: [] }); // no cards at all
  const state = fixtureState(p1, p2);
  const eligible = getEligibleResponses(state, 'player2', {
    kind: 'ATTACK_DECLARED',
    data: { kind: 'enemyApexAttacks', attackerId: 'player1', attackerInstanceId: 'x', attackDefId: 'y', targetInstanceId: undefined, syncCost: 0, totalDamage: 300 },
  });
  check('no eligible responses -> empty array (no pass screen should open)', eligible.length === 0);
}

console.log('=== Scenario 2: defender has Glitch Step + 1 Momentum, attack declared ===');
{
  const glitchStep = createInstance('nu-glitch-step', 'Reaction');
  const p1 = fixturePlayer('player1', 'Neon Underground', { momentum: 5 });
  const p2 = fixturePlayer('player2', 'Dark White', { momentum: 1, hand: [glitchStep] });
  const state = fixtureState(p1, p2);
  const eligible = getEligibleResponses(state, 'player2', {
    kind: 'ATTACK_DECLARED',
    data: { kind: 'enemyApexAttacks', attackerId: 'player1', attackerInstanceId: 'x', attackDefId: 'y', targetInstanceId: undefined, syncCost: 0, totalDamage: 300 },
  });
  check('Glitch Step + enough Momentum -> 1 eligible response', eligible.length === 1 && eligible[0].defId === 'nu-glitch-step');
}

console.log('=== Scenario 3: attack would deal O2 damage, defender has Emergency Authority + 1 Momentum ===');
{
  const emergencyAuthority = createInstance('dw-emergency-authority', 'Reaction');
  const p1 = fixturePlayer('player1', 'Neon Underground', { momentum: 5 });
  const p2 = fixturePlayer('player2', 'Dark White', { momentum: 1, hand: [emergencyAuthority] });
  const state = fixtureState(p1, p2);
  const eligible = getEligibleResponses(state, 'player2', {
    kind: 'O2_DAMAGE_PENDING',
    data: {
      kind: 'opponentAttackDealsO2Damage',
      attackerId: 'player1',
      defenderId: 'player2',
      amount: 2,
      isOverflow: true,
      attackerInstanceId: 'x',
      attackDefId: 'y',
      targetInstanceId: 'z',
      destroyedTarget: true,
    },
  });
  check('Emergency Authority + enough Momentum + O2 damage > 0 -> 1 eligible response', eligible.length === 1 && eligible[0].defId === 'dw-emergency-authority');
}

console.log('=== Scenario 4: Player 1 plays Overclock (a Special), Player 2 has Feedback Loop + 2 Momentum ===');
{
  const feedbackLoop = createInstance('nu-feedback-loop', 'Reaction');
  const p1 = fixturePlayer('player1', 'Neon Underground', { momentum: 5 });
  const p2 = fixturePlayer('player2', 'Dark White', { momentum: 2, hand: [feedbackLoop] });
  const state = fixtureState(p1, p2);
  const overclockDef = getCardDef('nu-overclock');
  check('sanity: Overclock is not tagged INSTANT', !(overclockDef.tags ?? []).includes('INSTANT'));
  const eligible = getEligibleResponses(state, 'player2', {
    kind: 'SPECIAL_PLAYED',
    data: { cardType: 'Special', cardFaction: 'Neon Underground', cardOwnerId: 'player1', cardInstanceId: 'special-instance' },
  });
  check('Feedback Loop + enough Momentum vs a Special -> 1 eligible response', eligible.length === 1 && eligible[0].defId === 'nu-feedback-loop');
}

console.log('=== Scenario 5: Player 1 plays an Equip, Player 2 has Absolute Refusal / Logic Denial + 2 Momentum ===');
{
  const absoluteRefusal = createInstance('dw-absolute-refusal', 'Reaction');
  const logicDenial = createInstance('sa-logic-denial', 'Reaction');
  const p1 = fixturePlayer('player1', 'Neon Underground', { momentum: 5 });
  for (const [label, card] of [
    ['Absolute Refusal', absoluteRefusal],
    ['Logic Denial', logicDenial],
  ] as const) {
    const p2 = fixturePlayer('player2', 'Dark White', { momentum: 2, hand: [card] });
    const state = fixtureState(p1, p2);
    const plasmaEdgeDef = getCardDef('nu-plasma-edge');
    check(`sanity: Plasma Edge is not tagged INSTANT`, !(plasmaEdgeDef.tags ?? []).includes('INSTANT'));
    const eligible = getEligibleResponses(state, 'player2', {
      kind: 'EQUIP_PLAYED',
      data: { cardType: 'Equip', cardFaction: 'Neon Underground', cardOwnerId: 'player1', cardInstanceId: 'equip-instance' },
    });
    check(`${label} + enough Momentum vs an Equip -> 1 eligible response`, eligible.length === 1 && eligible[0].defId === card.defId);
  }
}

console.log('=== Scenario 6: Player 2\'s Apex would be destroyed, has Backup Consciousness + 1 Momentum ===');
{
  const backupConsciousness = createInstance('sa-backup-consciousness', 'Reaction');
  const p1 = fixturePlayer('player1', 'Neon Underground', { momentum: 5 });
  const p2 = fixturePlayer('player2', 'Synth Ascendancy', { momentum: 1, hand: [backupConsciousness] });
  const state = fixtureState(p1, p2);
  const eligible = getEligibleResponses(state, 'player2', {
    kind: 'APEX_WOULD_BE_DESTROYED',
    data: { kind: 'ownApexWouldBeDestroyed', apexInstanceId: 'apex-1', ownerId: 'player2' },
  });
  check('Backup Consciousness + enough Momentum -> 1 eligible response', eligible.length === 1 && eligible[0].defId === 'sa-backup-consciousness');
}

console.log('=== Scenario 7: correct card, but not enough Momentum ===');
{
  const glitchStep = createInstance('nu-glitch-step', 'Reaction');
  const p1 = fixturePlayer('player1', 'Neon Underground', { momentum: 5 });
  const p2 = fixturePlayer('player2', 'Dark White', { momentum: 0, hand: [glitchStep] }); // cost is 1, has 0
  const state = fixtureState(p1, p2);
  const eligible = getEligibleResponses(state, 'player2', {
    kind: 'ATTACK_DECLARED',
    data: { kind: 'enemyApexAttacks', attackerId: 'player1', attackerInstanceId: 'x', attackDefId: 'y', targetInstanceId: undefined, syncCost: 0, totalDamage: 300 },
  });
  check('Glitch Step present but 0 Momentum (cost 1) -> 0 eligible responses', eligible.length === 0);
}

console.log('=== Scenario 8 & 9: Specials/Equips are not playable as the non-active player ===');
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
  // Burn the mandatory no-attack first turn to get into a normal Main phase.
  while (useGameStore.getState().phase !== 'Main') {
    const st = useGameStore.getState();
    if (st.phase === 'Start' && st.startPhasePending) st.advancePhase('Start');
    else if (st.phase === 'Start') st.advancePhase('Main');
  }

  const active = useGameStore.getState().activePlayerId;
  const nonActive: PlayerId = active === 'player1' ? 'player2' : 'player1';
  const nonActiveSpecial = useGameStore.getState().players[nonActive].hand.find((c) => c.type === 'Special');
  const nonActiveEquip = useGameStore.getState().players[nonActive].hand.find((c) => c.type === 'Equip');

  if (nonActiveSpecial) {
    const before = JSON.stringify(useGameStore.getState().players[nonActive].hand.map((c) => c.instanceId));
    useGameStore.getState().playSpecialCard(nonActiveSpecial.instanceId);
    const after = JSON.stringify(useGameStore.getState().players[nonActive].hand.map((c) => c.instanceId));
    check('non-active player cannot play a Special (hand unchanged)', before === after);
  } else {
    console.log('  (skipped - no Special in non-active hand this run)');
  }

  if (nonActiveEquip) {
    const before = JSON.stringify(useGameStore.getState().players[nonActive].hand.map((c) => c.instanceId));
    useGameStore.getState().playEquipCard(nonActiveEquip.instanceId, 'irrelevant-apex-id');
    const after = JSON.stringify(useGameStore.getState().players[nonActive].hand.map((c) => c.instanceId));
    check('non-active player cannot play an Equip (hand unchanged)', before === after);
  } else {
    console.log('  (skipped - no Equip in non-active hand this run)');
  }

  // Also confirm structurally: no Special/Equip in the whole card pool carries INSTANT.
  const allSpecialsAndEquips = ['nu-overclock', 'nu-data-thief', 'nu-no-gods', 'dw-system-scan', 'dw-choke-protocol', 'dw-verdict-protocol',
    'sa-compile-sequence', 'sa-upgrade-path', 'sa-ascension-complete',
    'nu-plasma-edge', 'nu-smog-jacket', 'dw-monomolecular-blade', 'dw-sterile-mantle', 'sa-chrome-halo', 'sa-pattern-blade'];
  const anyInstant = allSpecialsAndEquips.some((id) => (getCardDef(id).tags ?? []).includes('INSTANT'));
  check('no Special or Equip in the card pool is tagged INSTANT', !anyInstant);
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
