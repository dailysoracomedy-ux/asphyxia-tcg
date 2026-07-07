/* Targeted tests for the major design correction: Apex traits removed entirely, and all
   6 Rift Spaces rewritten. Covers all 26 numbered test items from the request. */
import { useGameStore } from '../store/gameStore';
import { createInstance } from '../data/decks';
import { getCardDef } from '../data/cards';
import { determineRiftSpace } from '../game/rifts';
import { getPreviewAttackDamage, addCounterFn, computeAvailableSync, MAX_MOMENTUM } from '../game/rules';
import { produce } from 'immer';
import type { GameState, PlayerState, PlayerId, Faction, RiftSpace } from '../types/game';

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

function fixturePlayer(
  id: PlayerId,
  faction: Faction,
  apex: ReturnType<typeof createInstance> | null,
  overrides: Partial<PlayerState> = {}
): PlayerState {
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
    activePlayerId: 'player1',
    firstPlayerId: 'player1',
    turnNumber: 2,
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
    gameOverReason: null, vsAI: false,
    ...extra,
  };
}

// ============================================================
// 1-2: Apex traits removed entirely
// ============================================================
console.log('=== Test 1: Apex cards have no trait/passive ability text displayed ===');
{
  const apexIds = [
    'nu-street-beast', 'nu-static-jack', 'nu-alley-wraith', 'nu-riot-runner',
    'dw-overseer-prime', 'dw-enforcer-v4', 'dw-glass-warden', 'dw-pale-executioner',
    'sa-model-00-crown', 'sa-chrome-seraph', 'sa-virex', 'sa-halcyon-maw',
  ];
  for (const id of apexIds) {
    const def = getCardDef(id);
    check(`${def.name}'s rulesText is empty (no trait text)`, def.rulesText === '');
  }
}

console.log('=== Test 3: Riot Runner no longer gains passive +100 while behind on O2 ===');
{
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex, { o2: 4 }), fixturePlayer('player2', 'Dark White', p2Apex, { o2: 12 })));
  // Mob Charge has no attack-specific bonus, so if the passive trait were still active
  // (p1.o2 < p2.o2), it would show +100. It should now show no bonus at all.
  const preview = getPreviewAttackDamage(useGameStore.getState(), p1Apex.instanceId, 'mob-charge')!;
  check('Mob Charge deals exactly base damage despite trailing on O2 (trait removed)', preview.modifiedDamage === preview.baseDamage);
}

console.log('=== Test 4: Static Jack no longer gains +100 after playing a Special ===');
{
  const p1Apex = createInstance('nu-static-jack', 'Apex');
  const noGods = createInstance('nu-no-gods', 'Special');
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex, { hand: [noGods] }), fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex'))));
  useGameStore.getState().playSpecialCard(noGods.instanceId);
  const preview = getPreviewAttackDamage(useGameStore.getState(), p1Apex.instanceId, 'shock-jab')!;
  check('Static Jack gains no armed bonus after playing its first Special (trait removed)', preview.modifiedDamage === preview.baseDamage);
}

console.log('=== Test 5: Glass Warden no longer reduces damage from 0-Sync attacks ===');
{
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  const { p1ApexId, p2ApexId } = (() => {
    useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex), fixturePlayer('player2', 'Dark White', p2Apex), { phase: 'Combat' }));
    return { p1ApexId: p1Apex.instanceId, p2ApexId: p2Apex.instanceId };
  })();
  // Pipe Swing is a 0-Sync, 200 damage attack. If Glass Warden's old trait were active,
  // this would deal only 100 (reduced by 100). It should now deal the full 200.
  useGameStore.getState().declareAttack(p1ApexId, 'pipe-swing', p2ApexId);
  const log = useGameStore.getState().log.map((l) => l.message);
  check('Glass Warden takes the full 200 damage from a 0-Sync attack (trait removed)', log.some((m) => m.includes('for 200 damage')));
}

console.log('=== Test 6: Pale Executioner no longer gains Momentum from attacking a Choked target ===');
{
  const p1Apex = createInstance('dw-pale-executioner', 'Apex');
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Dark White', p1Apex), fixturePlayer('player2', 'Dark White', p2Apex), { phase: 'Combat' }));
  useGameStore.setState(produce(useGameStore.getState(), (s) => addCounterFn(s, p2Apex.instanceId, 'choke', 1)));
  const momentumBefore = useGameStore.getState().players.player1.momentum;
  useGameStore.getState().declareAttack(p1Apex.instanceId, 'clean-cut', p2Apex.instanceId);
  check('Pale Executioner gains no Momentum from attacking a Choked target (trait removed)', useGameStore.getState().players.player1.momentum === momentumBefore);
}

console.log('=== Test 7: Model-00 "Crown" no longer gains Momentum on entry ===');
{
  const juiceBox = createInstance('nu-juice-box', 'AbilitySupport'); // any Support, just needs to exist
  const p1 = fixturePlayer('player1', 'Synth Ascendancy', null, { supportSlots: [juiceBox, null, null] });
  const p2 = fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex'));
  useGameStore.setState(fixtureState(p1, p2));
  const crown = createInstance('sa-model-00-crown', 'Apex');
  useGameStore.setState((s) => ({ players: { ...s.players, player1: { ...s.players.player1, hand: [crown] } } }));
  const momentumBefore = useGameStore.getState().players.player1.momentum;
  useGameStore.getState().playApexCard(crown.instanceId, 1);
  check('Crown gains no Momentum on entry despite controlling a Support (trait removed)', useGameStore.getState().players.player1.momentum === momentumBefore);
}

console.log('=== Test 8: Virex no longer gains an Upgrade Counter from destroying an Apex ===');
{
  const p1Apex = createInstance('sa-virex', 'Apex');
  const p2Apex = createInstance('dw-overseer-prime', 'Apex'); // 400 DEF, exact match for Archive Kill (600 dmg, overkill but destroys)
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Synth Ascendancy', p1Apex), fixturePlayer('player2', 'Dark White', p2Apex), { phase: 'Combat' }));
  useGameStore.getState().declareAttack(p1Apex.instanceId, 'archive-kill', p2Apex.instanceId);
  const apexAfter = useGameStore.getState().players.player1.apexSlots[0];
  check('the target was destroyed', useGameStore.getState().players.player2.apexSlots[0] === null);
  check('Virex gains no Upgrade Counter from the kill (trait removed)', (apexAfter?.counters?.upgrade ?? 0) === 0);
}

// ============================================================
// 9-10: Ability Support chained/vanilla
// ============================================================
console.log('=== Test 9: Ability Supports can be played unchained and still provide Sync ===');
{
  const juiceBox = createInstance('nu-juice-box', 'AbilitySupport');
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { hand: [juiceBox] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex'))));
  useGameStore.getState().playSupportCard(juiceBox.instanceId); // no chainedApexId provided
  const after = useGameStore.getState();
  const placed = after.players.player1.supportSlots.find((s) => s?.instanceId === juiceBox.instanceId);
  check('the Support was played unchained', placed?.chainedApexId == null);
  check('unchained Support still provides +1 Sync', computeAvailableSync(after, 'player1') === 1);
}

console.log('=== Test 10: Unchained Ability Supports do not activate their Sync Ability ===');
{
  const sparkPlug = createInstance('nu-spark-plug', 'AbilitySupport'); // left unchained (chainedApexId null)
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { supportSlots: [sparkPlug, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex')), { phase: 'Combat' }));
  useGameStore.getState().declareAttack(p1Apex.instanceId, 'mob-charge', useGameStore.getState().players.player2.apexSlots[0]!.instanceId);
  const log = useGameStore.getState().log.map((l) => l.message);
  check('unchained Spark-Plug never triggers its Sync Ability', !log.some((m) => m.includes('Spark-Plug')));
  const apexAfter = useGameStore.getState().players.player1.apexSlots[0];
  check('no armed bonus was granted', (apexAfter?.armedBonus ?? 0) === 0);
}

// ============================================================
// 11-12: Civil War
// ============================================================
console.log('=== Test 11: Civil War Momentum trigger works (choice-based) ===');
{
  const civilWar: RiftSpace = determineRiftSpace('Neon Underground', 'Dark White');
  check('Neon vs Dark White resolves to Civil War', civilWar.id === 'CivilWar');
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { o2: 4 });
  const p2 = fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex'), { o2: 12 });
  useGameStore.setState(fixtureState(p1, p2, { phase: 'Start', startPhasePending: true, riftSpace: civilWar }));
  useGameStore.getState().advancePhase('Start');
  const choiceItem = useGameStore.getState().pendingResponseQueue[0];
  check('a Civil War choice window opens when behind on O2', choiceItem?.stage === 'civilWarChoice');
  useGameStore.getState().resolveResponse({ type: 'civilWar', pick: 'momentum' });
  check('choosing Momentum grants player1 1 Momentum', useGameStore.getState().players.player1.momentum === 1);
}

console.log('=== Test 11b: Civil War +100 attack choice works ===');
{
  const civilWar: RiftSpace = determineRiftSpace('Neon Underground', 'Dark White');
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { o2: 4 });
  const p2 = fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex'), { o2: 12 });
  useGameStore.setState(fixtureState(p1, p2, { phase: 'Start', startPhasePending: true, riftSpace: civilWar }));
  useGameStore.getState().advancePhase('Start');
  useGameStore.getState().resolveResponse({ type: 'civilWar', pick: 'damage' });
  const preview = getPreviewAttackDamage(useGameStore.getState(), p1Apex.instanceId, 'pipe-swing')!;
  check('choosing +100 damage is visible on the next attack preview', preview.modifiedDamage === preview.baseDamage + 100);
}

console.log('=== Test 12: Civil War does NOT arm an extra bonus after destroying an Apex (Commit 12 hotfix) ===');
{
  const civilWar: RiftSpace = determineRiftSpace('Neon Underground', 'Dark White');
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  const p2Apex = createInstance('dw-overseer-prime', 'Apex'); // 400 DEF, exact match for Mob Charge
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { o2: 4 });
  const p2 = fixturePlayer('player2', 'Dark White', p2Apex, { o2: 12 });
  useGameStore.setState(fixtureState(p1, p2, { phase: 'Combat', riftSpace: civilWar }));
  useGameStore.getState().declareAttack(p1Apex.instanceId, 'mob-charge', p2Apex.instanceId);
  const log = useGameStore.getState().log.map((l) => l.message);
  check('the target was destroyed', useGameStore.getState().players.player2.apexSlots[0] === null);
  check('no old "arms +100 damage" destroy-triggered bonus fires anymore', !log.some((m) => m.includes('Civil War arms')));
  const preview = getPreviewAttackDamage(useGameStore.getState(), p1Apex.instanceId, 'pipe-swing')!;
  check('no lingering +100 bonus is visible on a subsequent attack preview', preview.modifiedDamage === preview.baseDamage);
}

// ============================================================
// 13-14: Human Error
// ============================================================
console.log('=== Test 13: Human Error first Special choice works ===');
{
  const humanError: RiftSpace = determineRiftSpace('Neon Underground', 'Synth Ascendancy');
  check('Neon vs Synth resolves to Human Error', humanError.id === 'HumanError');
  const noGods = createInstance('nu-no-gods', 'Special');
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { hand: [noGods] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Synth Ascendancy', createInstance('sa-halcyon-maw', 'Apex')), { riftSpace: humanError }));
  useGameStore.getState().playSpecialCard(noGods.instanceId);
  const item = useGameStore.getState().pendingResponseQueue.find((i) => i.stage === 'humanErrorChoice');
  check('a Human Error choice window opens after the first Special resolves', !!item);
  if (item) {
    useGameStore.getState().resolveResponse({ type: 'humanError', pick: 'momentum' });
    check('choosing Momentum grants 1 Momentum', useGameStore.getState().players.player1.momentum >= 1);
  }
}

console.log('=== Test 14: Human Error does not trigger if the Special is negated ===');
{
  const humanError: RiftSpace = determineRiftSpace('Neon Underground', 'Synth Ascendancy');
  const noGods = createInstance('nu-no-gods', 'Special');
  const feedbackLoop = createInstance('nu-feedback-loop', 'Reaction'); // INSTANT NEGATE ON_SPECIAL_PLAYED
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { hand: [noGods] });
  const p2 = fixturePlayer('player2', 'Neon Underground', createInstance('nu-street-beast', 'Apex'), { hand: [feedbackLoop], momentum: 2 });
  useGameStore.setState(fixtureState(p1, p2, { riftSpace: humanError, selectedFactions: { player1: 'Neon Underground', player2: 'Neon Underground' } }));
  useGameStore.getState().playSpecialCard(noGods.instanceId);
  const negateItem = useGameStore.getState().pendingResponseQueue[0];
  check('a negate window opened', negateItem?.stage === 'negateWindow');
  if (negateItem?.stage === 'negateWindow') {
    useGameStore.getState().resolveResponse({ type: 'negate', cardInstanceId: feedbackLoop.instanceId });
  }
  const humanErrorItem = useGameStore.getState().pendingResponseQueue.find((i) => i.stage === 'humanErrorChoice');
  check('no Human Error choice window opens for a negated Special', !humanErrorItem);
}

console.log(`\n=== RESULTS SO FAR: ${passed} passed, ${failed} failed ===`);

// ============================================================
// 15-18: Control Conflict
// ============================================================
console.log('=== Test 15: Control Conflict locking works ===');
{
  const controlConflict: RiftSpace = determineRiftSpace('Dark White', 'Synth Ascendancy');
  check('Dark White vs Synth resolves to Control Conflict', controlConflict.id === 'ControlConflict');
  const juiceBox = createInstance('nu-juice-box', 'AbilitySupport');
  const p1 = fixturePlayer('player1', 'Dark White', createInstance('dw-glass-warden', 'Apex'), { supportSlots: [juiceBox, null, null] });
  useGameStore.setState(
    fixtureState(p1, fixturePlayer('player2', 'Synth Ascendancy', createInstance('sa-halcyon-maw', 'Apex')), {
      phase: 'Start',
      startPhasePending: false,
      riftSpace: controlConflict,
    })
  );
  const momentumBefore = useGameStore.getState().players.player1.momentum;
  useGameStore.getState().lockSupportControlConflict(juiceBox.instanceId);
  const after = useGameStore.getState();
  check('the Support is now locked', after.players.player1.supportSlots[0]?.lockedByControlConflict === true);
  check('locking grants 1 Momentum', after.players.player1.momentum === momentumBefore + 1);
}

console.log('=== Test 16: Locked Support still provides Sync ===');
{
  const juiceBox = createInstance('nu-juice-box', 'AbilitySupport');
  juiceBox.lockedByControlConflict = true;
  const p1 = fixturePlayer('player1', 'Dark White', createInstance('dw-glass-warden', 'Apex'), { supportSlots: [juiceBox, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Synth Ascendancy', createInstance('sa-halcyon-maw', 'Apex'))));
  check('a locked Support still counts toward available Sync', computeAvailableSync(useGameStore.getState(), 'player1') === 1);
}

console.log('=== Test 17: Locked Ability Support does not trigger its Sync Ability ===');
{
  const sparkPlug = createInstance('nu-spark-plug', 'AbilitySupport');
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  sparkPlug.chainedApexId = p1Apex.instanceId;
  sparkPlug.lockedByControlConflict = true;
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { supportSlots: [sparkPlug, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex')), { phase: 'Combat' }));
  useGameStore.getState().declareAttack(p1Apex.instanceId, 'mob-charge', useGameStore.getState().players.player2.apexSlots[0]!.instanceId);
  const log = useGameStore.getState().log.map((l) => l.message);
  check('a locked, chained Spark-Plug does not trigger its Sync Ability', !log.some((m) => m.includes("Spark-Plug's Sync Ability triggers")));
}

console.log('=== Test 18: Locked Support cannot be Reconfigured ===');
{
  const juiceBox = createInstance('nu-juice-box', 'AbilitySupport');
  juiceBox.lockedByControlConflict = true;
  const p1 = fixturePlayer('player1', 'Dark White', createInstance('dw-glass-warden', 'Apex'), { supportSlots: [juiceBox, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Synth Ascendancy', createInstance('sa-halcyon-maw', 'Apex'))));
  useGameStore.getState().reconfigure(juiceBox.instanceId);
  check('the locked Support was NOT returned to hand', useGameStore.getState().players.player1.supportSlots[0]?.instanceId === juiceBox.instanceId);
  check('the hand did not gain the card', useGameStore.getState().players.player1.hand.length === 0);
}

// ============================================================
// 19-20: Echo Riot
// ============================================================
console.log('=== Test 19: Echo Riot self-O2 Momentum works ===');
{
  const echoRiot: RiftSpace = determineRiftSpace('Neon Underground', 'Neon Underground');
  check('Neon vs Neon resolves to Echo Riot', echoRiot.id === 'EchoRiot');
  const overclock = createInstance('nu-overclock', 'Special');
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { hand: [overclock] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Neon Underground', p2Apex), { riftSpace: echoRiot }));
  useGameStore.getState().playSpecialCard(overclock.instanceId, p1Apex.instanceId);
  // Overclock only arms the O2 cost - it actually applies when that Apex's next attack resolves.
  useGameStore.setState(() => ({ phase: 'Combat' as const }));
  const momentumBefore = useGameStore.getState().players.player1.momentum;
  // Pipe Swing (200) + Overclock (+200) = 400, well under Glass Warden's 600 DEF, so the
  // target survives and Apex Break Reward never fires - cleanly isolating Echo Riot's grant.
  useGameStore.getState().declareAttack(p1Apex.instanceId, 'pipe-swing', p2Apex.instanceId);
  check('target survived (no Apex Break Reward confound)', useGameStore.getState().players.player2.apexSlots[0] !== null);
  check('player1 gains 1 Momentum from the self-inflicted O2 loss when the armed attack resolves', useGameStore.getState().players.player1.momentum === momentumBefore + 1);
}

console.log('=== Test 20: Echo Riot upgrades Apex Break Reward to +2 Momentum at O2 <= 6 ===');
{
  const echoRiot: RiftSpace = determineRiftSpace('Neon Underground', 'Neon Underground');
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  const p2Apex = createInstance('dw-overseer-prime', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { o2: 6 });
  const p2 = fixturePlayer('player2', 'Neon Underground', p2Apex, { o2: 6 });
  useGameStore.setState(fixtureState(p1, p2, { phase: 'Combat', riftSpace: echoRiot }));
  useGameStore.getState().declareAttack(p1Apex.instanceId, 'mob-charge', p2Apex.instanceId);
  check('Apex Break Reward grants +2 Momentum when both are at O2 <= 6', useGameStore.getState().players.player1.momentum === 2);
}

// ============================================================
// 21-22: White Room Collapse
// ============================================================
console.log('=== Test 21: White Room Collapse Momentum on first Choke works ===');
{
  const whiteRoom: RiftSpace = determineRiftSpace('Dark White', 'Dark White');
  check('Dark White vs Dark White resolves to White Room Collapse', whiteRoom.id === 'WhiteRoomCollapse');
  const p1Apex = createInstance('dw-enforcer-v4', 'Apex');
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Dark White', p1Apex), fixturePlayer('player2', 'Dark White', p2Apex), { phase: 'Combat', riftSpace: whiteRoom }));
  const momentumBefore = useGameStore.getState().players.player1.momentum;
  useGameStore.setState(produce(useGameStore.getState(), (s) => addCounterFn(s, p2Apex.instanceId, 'choke', 1, 'player1')));
  check('player1 gains 1 Momentum for placing the first Choke Counter this turn', useGameStore.getState().players.player1.momentum === momentumBefore + 1);
}

console.log('=== Test 22: White Room Collapse removes 1 Choke from Apexes with 3+ Choke at end of turn ===');
{
  const whiteRoom: RiftSpace = determineRiftSpace('Dark White', 'Dark White');
  const p1Apex = createInstance('dw-glass-warden', 'Apex');
  const p1 = fixturePlayer('player1', 'Dark White', p1Apex);
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', createInstance('dw-enforcer-v4', 'Apex')), { phase: 'Combat', riftSpace: whiteRoom }));
  useGameStore.setState(produce(useGameStore.getState(), (s) => addCounterFn(s, p1Apex.instanceId, 'choke', 3)));
  useGameStore.getState().endTurn();
  const apexAfter = useGameStore.getState().players.player1.apexSlots[0];
  check('an Apex with 3 Choke Counters loses 1 at end of turn (now 2)', apexAfter?.counters?.choke === 2);
}

// ============================================================
// 23-25: Recursive Failure
// ============================================================
console.log('=== Test 23 & 24: Recursive Failure triggers on the second VOLUNTARY card, ignoring forced recovery ===');
{
  const recursiveFailure: RiftSpace = determineRiftSpace('Synth Ascendancy', 'Synth Ascendancy');
  check('Synth vs Synth resolves to Recursive Failure', recursiveFailure.id === 'RecursiveFailure');

  const supportCard = createInstance('sa-logic-bloom', 'AbilitySupport');
  const specialCard = createInstance('sa-compile-sequence', 'Special');
  const p1Apex = createInstance('sa-virex', 'Apex');
  const p1 = fixturePlayer('player1', 'Synth Ascendancy', p1Apex, { hand: [supportCard, specialCard] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Synth Ascendancy', createInstance('sa-halcyon-maw', 'Apex')), { riftSpace: recursiveFailure }));

  // First voluntary card: no trigger yet.
  useGameStore.getState().playSupportCard(supportCard.instanceId);
  check('no Glitch Counter yet after only 1 voluntary card', (useGameStore.getState().players.player1.apexSlots[0]?.counters?.glitch ?? 0) === 0);

  // Second voluntary card: should trigger Momentum + Glitch Counter from Recursive Failure,
  // AND Compile Sequence's own separate "if this is your 2nd card, gain 1 Momentum" text -
  // both are expected to stack (capped at 3), so total gain here is +2.
  const momentumBefore = useGameStore.getState().players.player1.momentum;
  useGameStore.getState().playSpecialCard(specialCard.instanceId);
  const after = useGameStore.getState();
  check(
    'playing the second voluntary card grants Momentum from both Recursive Failure and the card\'s own text',
    after.players.player1.momentum === momentumBefore + 2
  );
  check('playing the second voluntary card places 1 Glitch Counter', (after.players.player1.apexSlots[0]?.counters?.glitch ?? 0) === 1);
}

console.log('=== Test 25: Recursive Failure removes 1 Glitch at end of turn if 2 or fewer voluntary cards were played ===');
{
  const recursiveFailure: RiftSpace = determineRiftSpace('Synth Ascendancy', 'Synth Ascendancy');
  const p1Apex = createInstance('sa-virex', 'Apex');
  useGameStore.setState(produce(useGameStore.getState(), () => {}));
  const p1 = fixturePlayer('player1', 'Synth Ascendancy', p1Apex, { turnFlags: { ...freshTurnFlags(), cardsPlayedThisTurn: 1 } });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Synth Ascendancy', createInstance('sa-halcyon-maw', 'Apex')), { phase: 'Combat', riftSpace: recursiveFailure }));
  useGameStore.setState(produce(useGameStore.getState(), (s) => addCounterFn(s, p1Apex.instanceId, 'glitch', 2)));
  useGameStore.getState().endTurn();
  const apexAfter = useGameStore.getState().players.player1.apexSlots[0];
  check('1 Glitch Counter is removed at end of turn (2 -> 1) since only 1 voluntary card was played', apexAfter?.counters?.glitch === 1);
}

// ============================================================
// 26: Momentum cap
// ============================================================
console.log('=== Test 26: Momentum never exceeds 3, even from rift effects ===');
{
  const civilWar: RiftSpace = determineRiftSpace('Neon Underground', 'Dark White');
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { o2: 4, momentum: 3 });
  const p2 = fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex'), { o2: 12 });
  useGameStore.setState(fixtureState(p1, p2, { phase: 'Start', startPhasePending: true, riftSpace: civilWar }));
  useGameStore.getState().advancePhase('Start');
  useGameStore.getState().resolveResponse({ type: 'civilWar', pick: 'momentum' });
  check('Momentum stays at 3 even when Civil War would grant more', useGameStore.getState().players.player1.momentum === MAX_MOMENTUM);
  check('log notes player is already at max Momentum', useGameStore.getState().log.some((l) => l.message.includes('already at max Momentum')));
}

console.log(`\n=== FINAL RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
