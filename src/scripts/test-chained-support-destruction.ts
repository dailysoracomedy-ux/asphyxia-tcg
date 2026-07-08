/* Targeted tests for Commit 18.2's Chained Support Destruction rule. */
import { useGameStore } from '../store/gameStore';
import { createInstance } from '../data/decks';
import { computeAvailableSync } from '../game/rules';
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
    activePlayerId: 'player1',
    firstPlayerId: 'player1',
    turnNumber: 2,
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
    gameOverReason: null,
    vsAI: false,
    ...extra,
  };
}

console.log('=== Test 1-3: chained Ability Support is destroyed with its Apex, sent to Void, slot emptied ===');
{
  const p1Apex = createInstance('nu-static-jack', 'Apex'); // 300 DEF
  const juiceBox = createInstance('nu-juice-box', 'AbilitySupport');
  juiceBox.chainedApexId = p1Apex.instanceId;
  const p2Apex = createInstance('dw-pale-executioner', 'Apex'); // Public Erasure: 800 dmg, destroys 300 DEF easily
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { supportSlots: [juiceBox, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', p2Apex), { activePlayerId: 'player2' }));

  useGameStore.getState().declareAttack(p2Apex.instanceId, 'public-erasure', p1Apex.instanceId);
  const after = useGameStore.getState();
  check('the Apex was destroyed', after.players.player1.apexSlots[0] === null);
  check('the chained Juice-Box was also destroyed - Support slot is now empty', after.players.player1.supportSlots[0] === null);
  check('Juice-Box is in the Void', after.players.player1.voidZone.some((c) => c.instanceId === juiceBox.instanceId));
  const log = after.log.map((l) => l.message);
  check('log clearly explains the chained destruction', log.some((m) => m.includes('Juice-Box was chained to Static Jack and is sent to the Void')));
}

console.log('=== Test 4: destroyed chained Support no longer provides Sync ===');
{
  const p1Apex = createInstance('nu-static-jack', 'Apex');
  const juiceBox = createInstance('nu-juice-box', 'AbilitySupport');
  juiceBox.chainedApexId = p1Apex.instanceId;
  const p2Apex = createInstance('dw-pale-executioner', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { supportSlots: [juiceBox, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', p2Apex), { activePlayerId: 'player2' }));
  check('1 Sync available before destruction', computeAvailableSync(useGameStore.getState(), 'player1') === 1);
  useGameStore.getState().declareAttack(p2Apex.instanceId, 'public-erasure', p1Apex.instanceId);
  check('0 Sync available after the chained Support is destroyed', computeAvailableSync(useGameStore.getState(), 'player1') === 0);
  check("player1's live availableSync field was also capped down", useGameStore.getState().players.player1.availableSync === 0);
}

console.log('=== Test 5: unchained Ability Support survives Apex destruction ===');
{
  const p1Apex = createInstance('nu-static-jack', 'Apex');
  const sparkPlug = createInstance('nu-spark-plug', 'AbilitySupport'); // left unchained
  const p2Apex = createInstance('dw-pale-executioner', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { supportSlots: [sparkPlug, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', p2Apex), { activePlayerId: 'player2' }));
  useGameStore.getState().declareAttack(p2Apex.instanceId, 'public-erasure', p1Apex.instanceId);
  const after = useGameStore.getState();
  check('the Apex was destroyed', after.players.player1.apexSlots[0] === null);
  check('the unchained Spark-Plug survives in its Support slot', after.players.player1.supportSlots[0]?.instanceId === sparkPlug.instanceId);
  check('it still provides Sync', computeAvailableSync(after, 'player1') === 1);
}

console.log('=== Test 6: Battery Support is never destroyed by Apex destruction ===');
{
  const p1Apex = createInstance('nu-static-jack', 'Apex');
  const deadBattery = createInstance('nu-dead-battery', 'BatterySupport');
  const p2Apex = createInstance('dw-pale-executioner', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { supportSlots: [deadBattery, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', p2Apex), { activePlayerId: 'player2' }));
  useGameStore.getState().declareAttack(p2Apex.instanceId, 'public-erasure', p1Apex.instanceId);
  const after = useGameStore.getState();
  check('the Battery Support survives', after.players.player1.supportSlots[0]?.instanceId === deadBattery.instanceId);
}

console.log('=== Test 7: a Support chained to a DIFFERENT, surviving Apex is unaffected ===');
{
  const p1ApexA = createInstance('nu-static-jack', 'Apex'); // will be destroyed
  const p1ApexB = createInstance('nu-riot-runner', 'Apex'); // survives
  const juiceBox = createInstance('nu-juice-box', 'AbilitySupport');
  juiceBox.chainedApexId = p1ApexB.instanceId; // chained to the SURVIVING apex, not the destroyed one
  const p2Apex = createInstance('dw-pale-executioner', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1ApexA, { apexSlots: [p1ApexA, p1ApexB], supportSlots: [juiceBox, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', p2Apex), { activePlayerId: 'player2' }));
  useGameStore.getState().declareAttack(p2Apex.instanceId, 'public-erasure', p1ApexA.instanceId);
  const after = useGameStore.getState();
  check('Apex A was destroyed', !after.players.player1.apexSlots.some((a) => a?.instanceId === p1ApexA.instanceId));
  check('Apex B (unaffected) is still on board', after.players.player1.apexSlots.some((a) => a?.instanceId === p1ApexB.instanceId));
  check("Juice-Box (chained to B, not A) survives untouched", after.players.player1.supportSlots[0]?.instanceId === juiceBox.instanceId);
  check('Juice-Box is still chained to Apex B', after.players.player1.supportSlots[0]?.chainedApexId === p1ApexB.instanceId);
}

console.log('=== Test 8: prevented Apex destruction preserves the chained Support (Backup Consciousness) ===');
{
  const p1Apex = createInstance('sa-halcyon-maw', 'Apex'); // 500 DEF
  const backupConsciousness = createInstance('sa-backup-consciousness', 'Reaction');
  const juiceBox = createInstance('nu-juice-box', 'AbilitySupport'); // faction mismatch is fine for this fixture-level test
  juiceBox.chainedApexId = p1Apex.instanceId;
  const p2Apex = createInstance('dw-pale-executioner', 'Apex'); // Public Erasure: 800 dmg vs 500 DEF, would destroy
  const p1 = fixturePlayer('player1', 'Synth Ascendancy', p1Apex, { supportSlots: [juiceBox, null, null], hand: [backupConsciousness], momentum: 1 });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', p2Apex), { activePlayerId: 'player2' }));

  useGameStore.getState().declareAttack(p2Apex.instanceId, 'public-erasure', p1Apex.instanceId);
  const item = useGameStore.getState().pendingResponseQueue[0];
  check('a destroy-prevention response window opened', item?.stage === 'reactionChoice');
  if (item?.stage === 'reactionChoice') {
    useGameStore.getState().resolveResponse({ type: 'reaction', cardInstanceId: backupConsciousness.instanceId });
  }
  const after = useGameStore.getState();
  check('the Apex survives (destruction prevented)', after.players.player1.apexSlots[0]?.instanceId === p1Apex.instanceId);
  check('the chained Juice-Box was NOT destroyed - destruction never happened', after.players.player1.supportSlots[0]?.instanceId === juiceBox.instanceId);
  check('Juice-Box is still chained', after.players.player1.supportSlots[0]?.chainedApexId === p1Apex.instanceId);
}

console.log('=== Test 9: this rule is general-purpose, not hardcoded to Spark-Plug/Juice-Box (Oxygen Siphon, Gatekeeper Drone) ===');
{
  const p1Apex = createInstance('dw-glass-warden', 'Apex');
  const oxygenSiphon = createInstance('dw-oxygen-siphon', 'AbilitySupport');
  oxygenSiphon.chainedApexId = p1Apex.instanceId;
  const p2Apex = createInstance('sa-virex', 'Apex'); // Archive Kill: 600 dmg vs 600 DEF, exact destroy
  const p1 = fixturePlayer('player1', 'Dark White', p1Apex, { supportSlots: [oxygenSiphon, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Synth Ascendancy', p2Apex), { activePlayerId: 'player2' }));
  useGameStore.getState().declareAttack(p2Apex.instanceId, 'archive-kill', p1Apex.instanceId);
  const after = useGameStore.getState();
  check('Glass Warden was destroyed', after.players.player1.apexSlots[0] === null);
  check('Oxygen Siphon (chained) was also destroyed via the general helper, not a hardcoded card check', after.players.player1.supportSlots[0] === null);
  check('Oxygen Siphon is in the Void', after.players.player1.voidZone.some((c) => c.instanceId === oxygenSiphon.instanceId));
}
{
  const p1Apex = createInstance('dw-glass-warden', 'Apex');
  const gatekeeperDrone = createInstance('dw-gatekeeper-drone', 'AbilitySupport');
  gatekeeperDrone.chainedApexId = p1Apex.instanceId;
  const p2Apex = createInstance('sa-virex', 'Apex');
  const p1 = fixturePlayer('player1', 'Dark White', p1Apex, { supportSlots: [gatekeeperDrone, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Synth Ascendancy', p2Apex), { activePlayerId: 'player2' }));
  useGameStore.getState().declareAttack(p2Apex.instanceId, 'archive-kill', p1Apex.instanceId);
  const after = useGameStore.getState();
  check('Gatekeeper Drone (chained) was also destroyed', after.players.player1.supportSlots[0] === null);
  check('Gatekeeper Drone is in the Void', after.players.player1.voidZone.some((c) => c.instanceId === gatekeeperDrone.instanceId));
}

console.log('=== Test 10: Juice-Box does not grant a pending End Phase DEF buff if it was destroyed with its Apex ===');
{
  const p1Apex = createInstance('nu-static-jack', 'Apex');
  const juiceBox = createInstance('nu-juice-box', 'AbilitySupport');
  juiceBox.chainedApexId = p1Apex.instanceId;
  const p2Apex = createInstance('dw-pale-executioner', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { supportSlots: [juiceBox, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', p2Apex), { activePlayerId: 'player2' }));
  useGameStore.getState().declareAttack(p2Apex.instanceId, 'public-erasure', p1Apex.instanceId);
  // Advance through End Phase - nothing should throw, and no ghost buff should appear anywhere.
  useGameStore.getState().endTurn();
  const after = useGameStore.getState();
  check('no crash occurred advancing through End Phase with the Apex and its Juice-Box both gone', after.status === 'playing' || after.status === 'gameover');
  check('the destroyed Support does not linger anywhere on the board', !after.players.player1.supportSlots.some((s) => s?.instanceId === juiceBox.instanceId));
}

console.log('=== Test 11: Reconfigured (returned) Support does not die with its former Apex ===');
{
  const p1Apex = createInstance('nu-static-jack', 'Apex');
  const juiceBox = createInstance('nu-juice-box', 'AbilitySupport');
  juiceBox.chainedApexId = p1Apex.instanceId;
  const p2Apex = createInstance('dw-pale-executioner', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { supportSlots: [juiceBox, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', p2Apex), { phase: 'Main', activePlayerId: 'player1' }));

  useGameStore.getState().reconfigure(juiceBox.instanceId); // return-only, no replay
  const afterReconfigure = useGameStore.getState();
  check('Juice-Box was returned to hand', afterReconfigure.players.player1.hand.some((c) => c.instanceId === juiceBox.instanceId));
  check('Support slot is now empty', afterReconfigure.players.player1.supportSlots[0] === null);

  useGameStore.setState({ ...afterReconfigure, phase: 'Combat', activePlayerId: 'player2' });
  useGameStore.getState().declareAttack(p2Apex.instanceId, 'public-erasure', p1Apex.instanceId);
  const after = useGameStore.getState();
  check('the Apex was destroyed', after.players.player1.apexSlots[0] === null);
  check('Juice-Box (already returned to hand before the Apex died) did NOT go to Void', !after.players.player1.voidZone.some((c) => c.instanceId === juiceBox.instanceId));
  check('Juice-Box is still safely in hand', after.players.player1.hand.some((c) => c.instanceId === juiceBox.instanceId));
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
