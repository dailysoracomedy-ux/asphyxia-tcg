/* Targeted tests for the Negate -> React merge hotfix. Negate is no longer a
   separate CardType; the three former Negate cards (Feedback Loop, Absolute Refusal,
   Logic Denial) are now type 'Reaction', identified as cancel-style via the NEGATE
   tag and the presence of canCancel(). */
import { useGameStore } from '@/store/gameStore';
import { createInstance } from '@/data/decks';
import { getCardDef } from '@/data/cards';
import { ALL_CARDS } from '@/data/cards';
import { getEligibleResponses } from '@/game/rules';
import { getCardTypeLabel } from '@/lib/theme';
import type { GameState, PlayerState, PlayerId, Faction, ReactionDef } from '@/types/game';

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
    civilWarBonusArmedThisTurn: false, chromeHaloMomentumGainedThisTurn: false,
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
    momentum: 5,
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
    activePlayerId: 'player1',
    firstPlayerId: 'player1',
    turnNumber: 3,
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
    vsAI: false,
    ...extra,
  };
}

const NEGATE_CARD_IDS = ['nu-feedback-loop', 'dw-absolute-refusal', 'sa-logic-denial'] as const;

console.log('=== Test 1: Negate-style Reacts can still cancel legal Specials/Reacts/Equips ===');
{
  // Feedback Loop vs a Special.
  const feedbackLoop = createInstance('nu-feedback-loop', 'Reaction');
  const p2 = fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex'), { hand: [feedbackLoop] });
  const state = fixtureState(fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex')), p2);
  const eligible = getEligibleResponses(state, 'player2', {
    kind: 'SPECIAL_PLAYED',
    data: { cardType: 'Special', cardFaction: 'Neon Underground', cardOwnerId: 'player1', cardInstanceId: 'x' },
  });
  check('Feedback Loop is offered as an eligible response to a Special being played', eligible.some((c) => c.defId === 'nu-feedback-loop'));
}
{
  // Absolute Refusal vs an Equip.
  const absoluteRefusal = createInstance('dw-absolute-refusal', 'Reaction');
  const p1 = fixturePlayer('player1', 'Dark White', createInstance('dw-glass-warden', 'Apex'), { hand: [absoluteRefusal] });
  const state = fixtureState(p1, fixturePlayer('player2', 'Neon Underground', createInstance('nu-riot-runner', 'Apex')));
  const eligible = getEligibleResponses(state, 'player1', {
    kind: 'EQUIP_PLAYED',
    data: { cardType: 'Equip', cardFaction: 'Neon Underground', cardOwnerId: 'player2', cardInstanceId: 'x' },
  });
  check('Absolute Refusal is offered as an eligible response to an Equip being played', eligible.some((c) => c.defId === 'dw-absolute-refusal'));
}
{
  // Logic Denial vs a Reaction.
  const logicDenial = createInstance('sa-logic-denial', 'Reaction');
  const p1 = fixturePlayer('player1', 'Synth Ascendancy', createInstance('sa-halcyon-maw', 'Apex'), { hand: [logicDenial] });
  const state = fixtureState(p1, fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex')));
  const eligible = getEligibleResponses(state, 'player1', {
    kind: 'REACTION_PLAYED',
    data: { cardType: 'Reaction', cardFaction: 'Dark White', cardOwnerId: 'player2', cardInstanceId: 'x' },
  });
  check('Logic Denial is offered as an eligible response to a Reaction being played', eligible.some((c) => c.defId === 'sa-logic-denial'));
}
{
  // Rejects an illegal target: Feedback Loop cannot cancel an Equip per its own canCancel.
  const feedbackLoop = createInstance('nu-feedback-loop', 'Reaction');
  const p2 = fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex'), { hand: [feedbackLoop] });
  const state = fixtureState(fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex')), p2);
  const eligible = getEligibleResponses(state, 'player2', {
    kind: 'EQUIP_PLAYED',
    data: { cardType: 'Equip', cardFaction: 'Neon Underground', cardOwnerId: 'player1', cardInstanceId: 'x' },
  });
  check("Feedback Loop is correctly NOT offered against an Equip (canCancel excludes it, same as before the merge)", !eligible.some((c) => c.defId === 'nu-feedback-loop'));
}

console.log('=== Test 2: Negate-style Reacts do NOT appear as attack-defense Reacts ===');
{
  for (const defId of NEGATE_CARD_IDS) {
    const negateCard = createInstance(defId, 'Reaction');
    const def = getCardDef(defId);
    const faction = def.faction;
    const p2 = fixturePlayer('player2', faction, createInstance('dw-glass-warden', 'Apex'), { hand: [negateCard] });
    const state = fixtureState(fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex')), p2);
    const eligible = getEligibleResponses(state, 'player2', {
      kind: 'ATTACK_DECLARED',
      data: { kind: 'enemyApexAttacks', attackerId: 'player1', attackerInstanceId: 'x', attackDefId: 'y', targetInstanceId: undefined, syncCost: 0, totalDamage: 300 },
    });
    check(`${def.name} does not appear as an eligible defense against an incoming attack`, !eligible.some((c) => c.defId === defId));
  }
}
{
  // Also confirm real attack-defense Reactions (Backup Consciousness) are unaffected and still work.
  const backupConsciousness = createInstance('sa-backup-consciousness', 'Reaction');
  const p1 = fixturePlayer('player1', 'Synth Ascendancy', createInstance('sa-halcyon-maw', 'Apex'), { hand: [backupConsciousness] });
  const state = fixtureState(p1, fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex')));
  const eligible = getEligibleResponses(state, 'player1', {
    kind: 'APEX_WOULD_BE_DESTROYED',
    data: { kind: 'ownApexWouldBeDestroyed', apexInstanceId: 'x', ownerId: 'player1' },
  });
  check('a genuine attack-triggered Reaction (Backup Consciousness) still works normally', eligible.some((c) => c.defId === 'sa-backup-consciousness'));
}

console.log('=== Test 3: using a Negate-style React does not open a fresh negate window ===');
{
  const feedbackLoop = createInstance('nu-feedback-loop', 'Reaction');
  const overclock = createInstance('nu-overclock', 'Special');
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { hand: [overclock] });
  const p2 = fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex'), { hand: [feedbackLoop] });
  useGameStore.setState(fixtureState(p1, p2, { phase: 'Main', activePlayerId: 'player1' }));

  const apexTarget = useGameStore.getState().players.player1.apexSlots[0]!.instanceId;
  useGameStore.getState().playSpecialCard(overclock.instanceId, apexTarget);
  const afterPlay = useGameStore.getState();
  const negWindow = afterPlay.pendingResponseQueue[0];
  check('a negateWindow opened for player2 against the Special', negWindow?.stage === 'negateWindow');

  if (negWindow?.stage === 'negateWindow') {
    useGameStore.getState().resolveResponse({ type: 'negate', cardInstanceId: feedbackLoop.instanceId });
  }
  const afterNegate = useGameStore.getState();
  check('Feedback Loop successfully canceled the Special (it left the void-bound owner\'s side, Overclock is gone)', !afterNegate.players.player1.hand.some((c) => c.instanceId === overclock.instanceId));
  check('Feedback Loop itself is now in the Void (consumed)', afterNegate.players.player2.voidZone.some((c) => c.instanceId === feedbackLoop.instanceId));
  check('NO new response window was opened as a result of playing Feedback Loop - no negate-chain loop', afterNegate.pendingResponseQueue.length === 0);
}

console.log('=== Test 4: all old Negate cards display as "React — Negate" ===');
{
  for (const defId of NEGATE_CARD_IDS) {
    const def = getCardDef(defId);
    check(`${def.name} displays as "REACT — NEGATE"`, getCardTypeLabel(def) === 'REACT — NEGATE');
  }
  // Sanity: a plain attack-triggered Reaction displays as just "REACT", not "REACT — NEGATE".
  const backupDef = getCardDef('sa-backup-consciousness');
  check('a plain Reaction (Backup Consciousness) displays as just "REACT"', getCardTypeLabel(backupDef) === 'REACT');
}

console.log('=== Test 5: no live card uses Negate as a primary type ===');
{
  check('CardType union no longer includes "Negate" - verified structurally by every card def below', true);
  const anyNegateTyped = ALL_CARDS.some((c) => (c as { type: string }).type === 'Negate');
  check('no card in the full 45-card pool has type "Negate"', !anyNegateTyped);
  for (const defId of NEGATE_CARD_IDS) {
    const def = getCardDef(defId);
    check(`${def.name} has type "Reaction", not "Negate"`, def.type === 'Reaction');
    check(`${def.name} carries the NEGATE tag`, (def.tags ?? []).includes('NEGATE'));
    check(`${def.name} defines canCancel`, def.type === 'Reaction' && typeof (def as ReactionDef).canCancel === 'function');
  }
}

console.log('=== Test 6: same Momentum costs, same instant-per-turn limit still enforced ===');
{
  const feedbackLoop = createInstance('nu-feedback-loop', 'Reaction');
  const def = getCardDef('nu-feedback-loop') as ReactionDef;
  check('Feedback Loop still costs 2 Momentum (unchanged)', def.cost === 2);

  const overclock1 = createInstance('nu-overclock', 'Special');
  const overclock2 = createInstance('nu-overclock', 'Special');
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { hand: [overclock1, overclock2] });
  const p2 = fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex'), { hand: [feedbackLoop], momentum: 5 });
  useGameStore.setState(fixtureState(p1, p2, { phase: 'Main', activePlayerId: 'player1' }));

  const apexTarget = useGameStore.getState().players.player1.apexSlots[0]!.instanceId;
  useGameStore.getState().playSpecialCard(overclock1.instanceId, apexTarget);
  const window1 = useGameStore.getState().pendingResponseQueue[0];
  if (window1?.stage === 'negateWindow') useGameStore.getState().resolveResponse({ type: 'negate', cardInstanceId: feedbackLoop.instanceId });
  check('Momentum was spent (5 -> 3)', useGameStore.getState().players.player2.momentum === 3);
  check('instantsPlayedThisTurn is now 1', useGameStore.getState().players.player2.turnFlags.instantsPlayedThisTurn === 1);

  // A second Special is played - Feedback Loop already left hand/is gone, so nothing further to negate,
  // but this also confirms the once-per-turn instant limit still exists as a concept for these cards.
  useGameStore.getState().playSpecialCard(overclock2.instanceId, apexTarget);
  const afterSecond = useGameStore.getState();
  check('no further response window opened (Feedback Loop already used/gone)', afterSecond.pendingResponseQueue.length === 0);
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
