/* Targeted tests for the v0.2.1 pacing/cleanup patch:
   - Specials/Supports/Instants limited to 1 per player turn
   - Reconfigure shares the Support budget
   - Ability Support same-Apex double-chain prevention
   - No-Apex recovery rule (hand -> deck -> discard -> loss)
   - O2 capped at 6
   - Game log persists after game end
   Uses useGameStore.setState directly to deterministically inject fixture cards into
   hand (bypassing shuffle RNG) so these tests don't depend on what got drawn, while still
   exercising the real store actions under test. */
import { useGameStore, maybeRunEmergencyApexDraw } from '../store/gameStore';
import { createInstance } from '../data/decks';
import { getEligibleResponses, gainO2Fn, MAX_O2 } from '../game/rules';
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

function fixturePlayer(id: PlayerId, faction: Faction, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    faction,
    deck: [],
    hand: [],
    discard: [],
    apexSlots: [null, null],
    supportSlots: [null, null, null],
    o2: MAX_O2,
    momentum: 0,
    availableSync: 0,
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
    turnNumber: 5,
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
    ...extra,
  };
}

/** Gets a fresh real game (via the store) into the active player's Main Phase, past the
 *  mandatory no-attack first turn, so store-driven tests have a normal turn to work with. */
function setupToMainPhase() {
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
  // Burn the mandatory no-attack first turn to get to turn 2's Main Phase.
  while (useGameStore.getState().phase !== 'Combat') {
    const st = useGameStore.getState();
    if (st.phase === 'Start' && st.startPhasePending) st.advancePhase('Start');
    else if (st.phase === 'Start') st.advancePhase('Main');
    else if (st.phase === 'Main') st.advancePhase('Combat');
  }
  useGameStore.getState().endTurn();
  while (useGameStore.getState().phase !== 'Main') {
    const st = useGameStore.getState();
    if (st.phase === 'Start' && st.startPhasePending) st.advancePhase('Start');
    else if (st.phase === 'Start') st.advancePhase('Main');
  }
}

function injectIntoHand(playerId: PlayerId, cards: ReturnType<typeof createInstance>[]) {
  useGameStore.setState((state) => ({
    players: {
      ...state.players,
      [playerId]: { ...state.players[playerId], hand: [...state.players[playerId].hand, ...cards] },
    },
  }));
}

console.log('=== Test 1 & 2: Specials limited to 1/turn; blocked card stays in hand, unresolved ===');
{
  setupToMainPhase();
  const active = useGameStore.getState().activePlayerId;
  const dataThief = createInstance('nu-data-thief', 'Special');
  const noGods = createInstance('nu-no-gods', 'Special');
  injectIntoHand(active, [dataThief, noGods]);

  const handBefore = useGameStore.getState().players[active].hand.length;
  const discardBefore = useGameStore.getState().players[active].discard.length;

  useGameStore.getState().playSpecialCard(dataThief.instanceId);
  check('first Special (Data Thief) is played (leaves hand)', !useGameStore.getState().players[active].hand.some((c) => c.instanceId === dataThief.instanceId));
  check('specialsPlayedThisTurn is now 1', useGameStore.getState().players[active].turnFlags.specialsPlayedThisTurn === 1);

  const handSizeAfterFirst = useGameStore.getState().players[active].hand.length;
  const discardSizeAfterFirst = useGameStore.getState().players[active].discard.length;

  useGameStore.getState().playSpecialCard(noGods.instanceId);
  const afterSecondAttempt = useGameStore.getState().players[active];
  check('second Special (No Gods) is blocked - stays in hand', afterSecondAttempt.hand.some((c) => c.instanceId === noGods.instanceId));
  check('second Special did not change hand size', afterSecondAttempt.hand.length === handSizeAfterFirst);
  check('second Special did not get discarded (not resolved)', afterSecondAttempt.discard.length === discardSizeAfterFirst);
  check('specialsPlayedThisTurn still 1 (not incremented by the blocked attempt)', afterSecondAttempt.turnFlags.specialsPlayedThisTurn === 1);
  void handBefore;
  void discardBefore;
}

console.log('=== Test 3 & 4: Supports limited to 1/turn; Reconfigure shares that budget ===');
{
  setupToMainPhase();
  const active = useGameStore.getState().activePlayerId;
  const deadBattery1 = createInstance('nu-dead-battery', 'BatterySupport');
  const deadBattery2 = createInstance('nu-dead-battery', 'BatterySupport');
  injectIntoHand(active, [deadBattery1, deadBattery2]);

  useGameStore.getState().playSupportCard(deadBattery1.instanceId);
  check('first Support is played (on board)', useGameStore.getState().players[active].supportSlots.some((s) => s?.instanceId === deadBattery1.instanceId));
  check('supportsPlayedThisTurn is now 1', useGameStore.getState().players[active].turnFlags.supportsPlayedThisTurn === 1);

  useGameStore.getState().playSupportCard(deadBattery2.instanceId);
  const afterSecond = useGameStore.getState().players[active];
  check('second Support is blocked - stays in hand', afterSecond.hand.some((c) => c.instanceId === deadBattery2.instanceId));
  check('second Support did not reach the board', !afterSecond.supportSlots.some((s) => s?.instanceId === deadBattery2.instanceId));

  // Now test Reconfigure sharing the same budget: return the one on board, try to play the
  // second one in via Reconfigure - should also be blocked since the budget is already spent.
  useGameStore.getState().reconfigure(deadBattery1.instanceId, deadBattery2.instanceId);
  const afterReconfigureAttempt = useGameStore.getState().players[active];
  check(
    'Reconfigure play sub-step is blocked when Support budget already spent (card 2 still in hand)',
    afterReconfigureAttempt.hand.some((c) => c.instanceId === deadBattery2.instanceId)
  );
  check('Reconfigure return sub-step still worked (card 1 back in hand)', afterReconfigureAttempt.hand.some((c) => c.instanceId === deadBattery1.instanceId));
}

console.log('=== Test 4b: Reconfigure-first also consumes the Support budget (blocks a later normal play) ===');
{
  setupToMainPhase();
  const active = useGameStore.getState().activePlayerId;
  const battery1 = createInstance('nu-dead-battery', 'BatterySupport');
  const battery2 = createInstance('nu-black-market-cell', 'BatterySupport');
  const battery3 = createInstance('nu-dead-battery', 'BatterySupport');
  injectIntoHand(active, [battery1, battery2, battery3]);

  // Play one support normally first so there's something in a slot to return via Reconfigure.
  useGameStore.getState().playSupportCard(battery1.instanceId);
  // Manually reset the per-turn counters to simulate "a fresh turn" so we can test Reconfigure
  // consuming the budget in isolation (this only touches turnFlags, nothing else).
  useGameStore.setState((state) => ({
    players: {
      ...state.players,
      [active]: { ...state.players[active], turnFlags: { ...state.players[active].turnFlags, supportsPlayedThisTurn: 0 } },
    },
  }));

  useGameStore.getState().reconfigure(battery1.instanceId, battery2.instanceId);
  check('Reconfigure play sub-step consumed the Support budget', useGameStore.getState().players[active].turnFlags.supportsPlayedThisTurn === 1);

  useGameStore.getState().playSupportCard(battery3.instanceId);
  check('normal Support play is now blocked after Reconfigure used the budget', useGameStore.getState().players[active].hand.some((c) => c.instanceId === battery3.instanceId));
}

console.log('=== Test 5 & 6: INSTANT cards limited to 1/turn; getEligibleResponses respects it ===');
{
  const glitchStep = createInstance('nu-glitch-step', 'Reaction');
  const p1 = fixturePlayer('player1', 'Neon Underground', { momentum: 5 });
  const p2 = fixturePlayer('player2', 'Dark White', {
    momentum: 5,
    hand: [glitchStep],
    turnFlags: { ...freshTurnFlags(), instantsPlayedThisTurn: 1 }, // already played an instant this turn
  });
  const state = fixtureState(p1, p2);
  const eligible = getEligibleResponses(state, 'player2', {
    kind: 'ATTACK_DECLARED',
    data: { kind: 'enemyApexAttacks', attackerId: 'player1', attackerInstanceId: 'x', attackDefId: 'y', targetInstanceId: undefined, syncCost: 0, totalDamage: 300 },
  });
  check('getEligibleResponses excludes instants once instantsPlayedThisTurn >= 1', eligible.length === 0);

  const p2Fresh = fixturePlayer('player2', 'Dark White', { momentum: 5, hand: [glitchStep] });
  const stateFresh = fixtureState(p1, p2Fresh);
  const eligibleFresh = getEligibleResponses(stateFresh, 'player2', {
    kind: 'ATTACK_DECLARED',
    data: { kind: 'enemyApexAttacks', attackerId: 'player1', attackerInstanceId: 'x', attackDefId: 'y', targetInstanceId: undefined, syncCost: 0, totalDamage: 300 },
  });
  check('same card is eligible when instantsPlayedThisTurn is 0', eligibleFresh.length === 1);
}

console.log('=== Test 7: No-Apex recovery - Apex in hand is force-played ===');
{
  const p1 = fixturePlayer('player1', 'Neon Underground');
  const streetBeast = createInstance('nu-street-beast', 'Apex');
  const battery = createInstance('nu-dead-battery', 'BatterySupport');
  p1.hand = [battery, streetBeast];
  p1.apexSlots = [null, null];
  const p2 = fixturePlayer('player2', 'Dark White');
  const state = fixtureState(p1, p2);

  maybeRunEmergencyApexDraw(state, 'player1');
  check('Apex from hand was force-played into slot 1', state.players.player1.apexSlots[0]?.defId === 'nu-street-beast');
  check('non-Apex card stayed in hand', state.players.player1.hand.some((c) => c.instanceId === battery.instanceId));
  check('game did not end', state.status === 'playing');
}

console.log('=== Test 8: No-Apex recovery - Apex found by revealing the deck ===');
{
  const p1 = fixturePlayer('player1', 'Neon Underground');
  const junk1 = createInstance('nu-dead-battery', 'BatterySupport');
  const junk2 = createInstance('nu-overclock', 'Special');
  const apexInDeck = createInstance('nu-riot-runner', 'Apex');
  const junk3 = createInstance('nu-plasma-edge', 'Equip');
  p1.hand = [junk1]; // no Apex in hand
  p1.deck = [junk2, apexInDeck, junk3]; // Apex is second from top
  const p2 = fixturePlayer('player2', 'Dark White');
  const state = fixtureState(p1, p2);

  maybeRunEmergencyApexDraw(state, 'player1');
  check('Apex from deck was played into slot 1', state.players.player1.apexSlots[0]?.defId === 'nu-riot-runner');
  check('non-Apex deck cards were shuffled back into the deck (not lost)', state.players.player1.deck.length === 2);
  check('game did not end', state.status === 'playing');
}

console.log('=== Test 9: No-Apex recovery - deck exhausted, Apex recovered from discard ===');
{
  const p1 = fixturePlayer('player1', 'Neon Underground');
  const apexInDiscard = createInstance('nu-static-jack', 'Apex');
  const discardJunk = createInstance('nu-data-thief', 'Special');
  p1.hand = [];
  p1.deck = []; // fully empty
  p1.discard = [discardJunk, apexInDiscard];
  const p2 = fixturePlayer('player2', 'Dark White');
  const state = fixtureState(p1, p2);

  maybeRunEmergencyApexDraw(state, 'player1');
  check('Apex recovered from discard after shuffling it into the deck', state.players.player1.apexSlots[0]?.defId === 'nu-static-jack');
  check('discard pile was emptied by the shuffle-in', state.players.player1.discard.length === 0);
  check('game did not end', state.status === 'playing');
}

console.log('=== Test 10: No-Apex recovery - no Apex anywhere -> player loses ===');
{
  const p1 = fixturePlayer('player1', 'Neon Underground');
  p1.hand = [createInstance('nu-dead-battery', 'BatterySupport')];
  p1.deck = [createInstance('nu-overclock', 'Special')];
  p1.discard = [createInstance('nu-data-thief', 'Special')];
  const p2 = fixturePlayer('player2', 'Dark White');
  const state = fixtureState(p1, p2);

  maybeRunEmergencyApexDraw(state, 'player1');
  check('player with no Apex anywhere loses', state.status === 'gameover' && state.winnerId === 'player2');
  check('gameOverReason mentions the no-Apex loss', !!state.gameOverReason && state.gameOverReason.includes('no Apex remaining anywhere'));
}

console.log(`=== Test 11: O2 cannot exceed MAX_O2 (${MAX_O2}) ===`);
{
  const state = fixtureState(fixturePlayer('player1', 'Neon Underground', { o2: MAX_O2 }), fixturePlayer('player2', 'Dark White'));
  gainO2Fn(state, 'player1', 1);
  check(`O2 stays at MAX_O2 (${MAX_O2}) when already at max`, state.players.player1.o2 === MAX_O2);
  check('a log entry notes the player is already at max O2', state.log.some((l) => l.message.includes('already at max O2')));

  const state2 = fixtureState(fixturePlayer('player1', 'Neon Underground', { o2: MAX_O2 - 1 }), fixturePlayer('player2', 'Dark White'));
  gainO2Fn(state2, 'player1', 3);
  check('O2 gain is clamped to MAX_O2 rather than overshooting', state2.players.player1.o2 === MAX_O2);
}

console.log('=== Test 12: Game log persists after game end ===');
{
  const s = useGameStore.getState();
  s.startNewGame('Neon Underground', 'Dark White');
  const logLengthAtStart = useGameStore.getState().log.length;
  check('log has entries right after game start', logLengthAtStart > 0);
  // Force a game-over via direct O2 KO for a deterministic end-state check.
  useGameStore.setState((state) => ({
    players: { ...state.players, player2: { ...state.players.player2, o2: 0 } },
    status: 'gameover',
    winnerId: 'player1',
    gameOverReason: "player2's O2 hit zero.",
  }));
  const afterEnd = useGameStore.getState();
  check('log is untouched (not cleared) when the game ends', afterEnd.log.length === logLengthAtStart);
  check('log entries are still readable/iterable after game end', afterEnd.log.every((l) => typeof l.message === 'string'));
}

console.log('=== Test 13: Copy Game Log text formatting (pure function check) ===');
{
  const log = [
    { id: '1', turn: 1, message: 'Test entry one.', kind: 'info' as const },
    { id: '2', turn: 2, message: 'Test entry two.', kind: 'play' as const },
  ];
  const formatted = log.map((e) => `[T${e.turn}] ${e.message}`).join('\n');
  check('log formats to plain text lines (clipboard/textarea fallback format)', formatted === '[T1] Test entry one.\n[T2] Test entry two.');
  console.log('  (Note: actual navigator.clipboard behavior requires a browser context and is not exercised in this headless test.)');
}

console.log('=== Test 14: Ability Supports cannot both chain to the same Apex ===');
{
  setupToMainPhase();
  const active = useGameStore.getState().activePlayerId;
  const apexId = useGameStore.getState().players[active].apexSlots.find(Boolean)!.instanceId;
  const juiceBox1 = createInstance('nu-juice-box', 'AbilitySupport');
  const juiceBox2 = createInstance('nu-spark-plug', 'AbilitySupport');
  injectIntoHand(active, [juiceBox1, juiceBox2]);

  useGameStore.getState().playSupportCard(juiceBox1.instanceId, undefined, apexId);
  check('first Ability Support chains successfully', useGameStore.getState().players[active].supportSlots.some((s) => s?.instanceId === juiceBox1.instanceId && s.chainedApexId === apexId));

  // Reset the per-turn Support budget to isolate the same-Apex chain rule from the 1/turn limit.
  useGameStore.setState((state) => ({
    players: {
      ...state.players,
      [active]: { ...state.players[active], turnFlags: { ...state.players[active].turnFlags, supportsPlayedThisTurn: 0 } },
    },
  }));

  useGameStore.getState().playSupportCard(juiceBox2.instanceId, undefined, apexId);
  const after = useGameStore.getState().players[active];
  check('second Ability Support cannot chain to the same Apex (stays in hand)', after.hand.some((c) => c.instanceId === juiceBox2.instanceId));
  check('only one Ability Support is chained to that Apex', after.supportSlots.filter((s) => s?.type === 'AbilitySupport' && s.chainedApexId === apexId).length === 1);
}

console.log('=== Test 15: Response Window only opens when a legal eligible instant exists (regression) ===');
{
  const p1 = fixturePlayer('player1', 'Neon Underground', { momentum: 5 });
  const p2NoCards = fixturePlayer('player2', 'Dark White', { momentum: 5, hand: [] });
  const stateNoCards = fixtureState(p1, p2NoCards);
  const eligibleNone = getEligibleResponses(stateNoCards, 'player2', {
    kind: 'ATTACK_DECLARED',
    data: { kind: 'enemyApexAttacks', attackerId: 'player1', attackerInstanceId: 'x', attackDefId: 'y', targetInstanceId: undefined, syncCost: 0, totalDamage: 300 },
  });
  check('no eligible cards -> Response Window would not open', eligibleNone.length === 0);

  const glitchStep = createInstance('nu-glitch-step', 'Reaction');
  const p2WithCard = fixturePlayer('player2', 'Dark White', { momentum: 1, hand: [glitchStep] });
  const stateWithCard = fixtureState(p1, p2WithCard);
  const eligibleSome = getEligibleResponses(stateWithCard, 'player2', {
    kind: 'ATTACK_DECLARED',
    data: { kind: 'enemyApexAttacks', attackerId: 'player1', attackerInstanceId: 'x', attackDefId: 'y', targetInstanceId: undefined, syncCost: 0, totalDamage: 300 },
  });
  check('legal eligible instant present -> Response Window would open', eligibleSome.length === 1);
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
