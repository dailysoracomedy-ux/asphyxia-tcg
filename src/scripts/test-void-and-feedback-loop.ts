/* Targeted tests for Commit 11's Void zone, Void Recycle, and Feedback Loop rewrite. */
import { useGameStore } from '../store/gameStore';
import { createInstance } from '../data/decks';
import { getCardDef } from '../data/cards';
import { drawOneCard } from '../game/rules';
import { produce } from 'immer';
import type { GameState, PlayerState, PlayerId, Faction, NegateDef } from '../types/game';

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
    ...extra,
  };
}

console.log('=== Test 1 & 2: Destroyed Apex and its attached Equip both go to Void ===');
{
  const plasmaEdge = createInstance('nu-plasma-edge', 'Equip');
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  p1Apex.equip = plasmaEdge;
  const p2Apex = createInstance('dw-overseer-prime', 'Apex'); // 400 DEF, exact match
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex), fixturePlayer('player2', 'Dark White', p2Apex)));
  useGameStore.getState().declareAttack(p1Apex.instanceId, 'mob-charge', p2Apex.instanceId);
  const after = useGameStore.getState();
  check('the target was destroyed', after.players.player2.apexSlots[0] === null);
  check("the destroyed Apex is now in player2's Void", after.players.player2.voidZone.some((c) => c.instanceId === p2Apex.instanceId));
  check('the target had no equip attached to worry about here (sanity)', !p2Apex.equip);

  // Redo with the DEFENDER equipped this time to check the equip-follows-to-void rule directly.
  const shieldedApex = createInstance('dw-glass-warden', 'Apex');
  const shield = createInstance('dw-monomolecular-blade', 'Equip');
  shieldedApex.equip = shield;
  const attacker = createInstance('nu-riot-runner', 'Apex');
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', attacker), fixturePlayer('player2', 'Dark White', shieldedApex)));
  useGameStore.getState().declareAttack(attacker.instanceId, 'last-breath-rush', shieldedApex.instanceId); // 700+ dmg vs 600 DEF, destroys
  const after2 = useGameStore.getState();
  check('the equipped defender was destroyed', after2.players.player2.apexSlots[0] === null);
  check("the destroyed Apex's Equip followed it into Void", after2.players.player2.voidZone.some((c) => c.instanceId === shield.instanceId));
}

console.log('=== Test 3: Chained Ability Support stays on field and becomes Unchained when its Apex dies ===');
{
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  const sparkPlug = createInstance('nu-spark-plug', 'AbilitySupport');
  sparkPlug.chainedApexId = p1Apex.instanceId;
  const p2Apex = createInstance('dw-overseer-prime', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, { supportSlots: [sparkPlug, null, null] });
  // Use the real engine path: have player2 destroy player1's Riot Runner. fixtureState always
  // maps its first argument to the player1 key and second to player2, so player1's setup must
  // stay first regardless of who's active; activePlayerId controls who actually attacks.
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', p2Apex), { activePlayerId: 'player2' }));
  useGameStore.getState().declareAttack(p2Apex.instanceId, 'absolute-command', p1Apex.instanceId); // 700 dmg vs 400 DEF, destroys
  const after = useGameStore.getState();
  const p1After = after.players.player1;
  check('Riot Runner was destroyed', p1After.apexSlots[0] === null);
  check('Riot Runner is now in Void', p1After.voidZone.some((c) => c.instanceId === p1Apex.instanceId));
  check('Spark-Plug is NOT sent to Void - it stays on the field', p1After.supportSlots[0]?.instanceId === sparkPlug.instanceId);
  check('Spark-Plug is now Unchained', p1After.supportSlots[0]?.chainedApexId == null);
}

console.log('=== Test 4, 5, 6: Resolved Special/Reaction/Negate all go to Void ===');
{
  const dataThief = createInstance('nu-data-thief', 'Special');
  const filler = createInstance('nu-glitch-step', 'Reaction'); // just deck filler so the draw doesn't trigger Void Recycle
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { hand: [dataThief], deck: [filler] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex')), { phase: 'Main' }));
  useGameStore.getState().playSpecialCard(dataThief.instanceId);
  check('resolved Special (Data Thief) goes to Void', useGameStore.getState().players.player1.voidZone.some((c) => c.instanceId === dataThief.instanceId));
}
{
  // Reaction: Glitch Step responds to an attack declaration, then goes to Void.
  const glitchStep = createInstance('nu-glitch-step', 'Reaction');
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  const p2 = fixturePlayer('player2', 'Dark White', p2Apex, { hand: [glitchStep], momentum: 2 });
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex), p2));
  useGameStore.getState().declareAttack(p1Apex.instanceId, 'mob-charge', p2Apex.instanceId);
  const item = useGameStore.getState().pendingResponseQueue[0];
  if (item?.stage === 'reactionChoice') {
    useGameStore.getState().resolveResponse({ type: 'reaction', cardInstanceId: glitchStep.instanceId });
  }
  check('a reaction window opened', item?.stage === 'reactionChoice');
  check('resolved Reaction (Glitch Step) goes to Void', useGameStore.getState().players.player2.voidZone.some((c) => c.instanceId === glitchStep.instanceId));
}
{
  // Negate: Absolute Refusal cancels a Special, then both go to Void.
  const noGods = createInstance('nu-no-gods', 'Special');
  const absoluteRefusal = createInstance('dw-absolute-refusal', 'Negate');
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { hand: [noGods] });
  const p2 = fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex'), { hand: [absoluteRefusal], momentum: 2 });
  useGameStore.setState(fixtureState(p1, p2, { phase: 'Main' }));
  useGameStore.getState().playSpecialCard(noGods.instanceId);
  const negateItem = useGameStore.getState().pendingResponseQueue[0];
  check('a negate window opened', negateItem?.stage === 'negateWindow');
  if (negateItem?.stage === 'negateWindow') {
    useGameStore.getState().resolveResponse({ type: 'negate', cardInstanceId: absoluteRefusal.instanceId });
  }
  const after = useGameStore.getState();
  check('the Negate (Absolute Refusal) goes to Void', after.players.player2.voidZone.some((c) => c.instanceId === absoluteRefusal.instanceId));
  check('Test 7 (canceled card goes to Void): the canceled Special (No Gods) goes to Void', after.players.player1.voidZone.some((c) => c.instanceId === noGods.instanceId));
}

console.log('=== Test 8: Reconfigure return-to-hand does NOT send the Support to Void ===');
{
  const juiceBox = createInstance('nu-juice-box', 'AbilitySupport');
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { supportSlots: [juiceBox, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex')), { phase: 'Main' }));
  useGameStore.getState().reconfigure(juiceBox.instanceId);
  const after = useGameStore.getState();
  check('Juice-Box returned to hand', after.players.player1.hand.some((c) => c.instanceId === juiceBox.instanceId));
  check('Juice-Box did NOT go to Void', !after.players.player1.voidZone.some((c) => c.instanceId === juiceBox.instanceId));
}

console.log('=== Test 9: Locked Support stays on field and does not go to Void ===');
{
  const juiceBox = createInstance('nu-juice-box', 'AbilitySupport');
  juiceBox.lockedByControlConflict = true;
  const p1 = fixturePlayer('player1', 'Dark White', createInstance('dw-glass-warden', 'Apex'), { supportSlots: [juiceBox, null, null] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Synth Ascendancy', createInstance('sa-halcyon-maw', 'Apex')), { phase: 'Main' }));
  useGameStore.getState().reconfigure(juiceBox.instanceId);
  const after = useGameStore.getState();
  check('locked Support was not returned (blocked)', after.players.player1.supportSlots[0]?.instanceId === juiceBox.instanceId);
  check('locked Support did not go to Void', !after.players.player1.voidZone.some((c) => c.instanceId === juiceBox.instanceId));
}

console.log('=== Test 10: No-Apex Recovery revealed non-Apex cards shuffle back into Deck, not Void ===');
{
  const junk1 = createInstance('nu-data-thief', 'Special');
  const junk2 = createInstance('nu-glitch-step', 'Reaction');
  const bench = createInstance('nu-riot-runner', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', null, { deck: [junk1, junk2, bench] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex')), { phase: 'Start', startPhasePending: false }));
  useGameStore.getState().advancePhase('Main');
  const after = useGameStore.getState();
  check('the Apex found was played', after.players.player1.apexSlots[0]?.instanceId === bench.instanceId);
  check('the non-Apex junk cards are back in the Deck', after.players.player1.deck.some((c) => c.instanceId === junk1.instanceId) && after.players.player1.deck.some((c) => c.instanceId === junk2.instanceId));
  check('the non-Apex junk cards did NOT go to Void', after.players.player1.voidZone.length === 0);
}

console.log('=== Test 11-14: Deck/Void counters ===');
{
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), {
    deck: [createInstance('nu-data-thief', 'Special'), createInstance('nu-glitch-step', 'Reaction')],
  });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex'))));
  check('Deck counter starts at 2', useGameStore.getState().players.player1.deck.length === 2);
  useGameStore.setState(produce(useGameStore.getState(), (s) => { drawOneCard(s, 'player1'); }));
  check('drawing reduces Deck count by 1', useGameStore.getState().players.player1.deck.length === 1);
  check('Void counter starts at 0', useGameStore.getState().players.player1.voidZone.length === 0);
}

console.log('=== Test 15-16: Void Recycle on empty-Deck draw ===');
{
  const voidCards = [createInstance('nu-data-thief', 'Special'), createInstance('nu-glitch-step', 'Reaction')];
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { deck: [], voidZone: voidCards });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex'))));
  useGameStore.setState(produce(useGameStore.getState(), (s) => { drawOneCard(s, 'player1'); }));
  const after = useGameStore.getState();
  check('Void Recycle emptied the Void', after.players.player1.voidZone.length === 0);
  check('Void Recycle refilled the Deck (2 cards in, 1 drawn, 1 remains)', after.players.player1.deck.length === 1);
  check('a card was successfully drawn into hand', after.players.player1.hand.length === 1);
  check('log mentions Void Recycle', after.log.some((l) => l.message.includes('Void Recycle')));
}

console.log('=== Test 17: No-Apex Recovery performs Void Recycle if Deck has no Apex but Void does ===');
{
  const voidApex = createInstance('sa-virex', 'Apex');
  const junk = createInstance('sa-compile-sequence', 'Special');
  const p1 = fixturePlayer('player1', 'Synth Ascendancy', null, { deck: [junk], voidZone: [voidApex] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex')), { phase: 'Start', startPhasePending: false }));
  useGameStore.getState().advancePhase('Main');
  const after = useGameStore.getState();
  check('the Apex from Void was found and played', after.players.player1.apexSlots[0]?.defId === 'sa-virex');
  check('Void is now empty after the recycle', after.players.player1.voidZone.length === 0);
  check('log mentions Void Recycle', after.log.some((l) => l.message.includes('Void Recycle')));
}

console.log('=== Test 18: No Apex anywhere (hand, Deck, or Void) causes a loss ===');
{
  const junk = createInstance('sa-compile-sequence', 'Special');
  const p1 = fixturePlayer('player1', 'Synth Ascendancy', null, { deck: [junk], voidZone: [] });
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', createInstance('dw-glass-warden', 'Apex')), { phase: 'Start', startPhasePending: false }));
  useGameStore.getState().advancePhase('Main');
  const after = useGameStore.getState();
  check('the game ends', after.status === 'gameover');
  check('player2 is declared the winner', after.winnerId === 'player2');
}

console.log('=== Test 19-24: Feedback Loop rewrite ===');
{
  // 19 & 21 & 22: cancels a Special and the controller loses 1 O2 (not 100 Apex damage).
  const noGods = createInstance('nu-no-gods', 'Special');
  const feedbackLoop = createInstance('nu-feedback-loop', 'Negate');
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { hand: [noGods], o2: 12 });
  const p2 = fixturePlayer('player2', 'Neon Underground', createInstance('nu-street-beast', 'Apex'), { hand: [feedbackLoop], momentum: 2 });
  useGameStore.setState(fixtureState(p1, p2, { phase: 'Main', selectedFactions: { player1: 'Neon Underground', player2: 'Neon Underground' } }));
  useGameStore.getState().playSpecialCard(noGods.instanceId);
  const negateItem = useGameStore.getState().pendingResponseQueue[0];
  check('a negate window opened for the Special', negateItem?.stage === 'negateWindow');
  const o2Before = useGameStore.getState().players.player1.o2;
  if (negateItem?.stage === 'negateWindow') {
    useGameStore.getState().resolveResponse({ type: 'negate', cardInstanceId: feedbackLoop.instanceId });
  }
  const after = useGameStore.getState();
  check('Feedback Loop canceled the Special', after.players.player1.hand.length === 0 && !after.pendingResponseQueue.some((i) => i.stage === 'negateWindow'));
  check("the canceled card's controller (player1) loses exactly 1 O2", o2Before - after.players.player1.o2 === 1);
  check('no 100 Apex-damage effect occurs (no Apex destroyed, no DEF-vs-damage log)', after.players.player1.apexSlots[0] !== null);
  check('24: both Feedback Loop and the canceled card go to Void', after.players.player2.voidZone.some((c) => c.instanceId === feedbackLoop.instanceId) && after.players.player1.voidZone.some((c) => c.instanceId === noGods.instanceId));
}
{
  // 20: cancels a Reaction too (canCancel includes 'Reaction').
  const feedbackLoop = createInstance('nu-feedback-loop', 'Negate');
  const feedbackLoopDef = getCardDef(feedbackLoop.defId) as NegateDef;
  check('Feedback Loop can still cancel a Reaction per canCancel', feedbackLoopDef.canCancel('Reaction', 'Neon Underground'));
}
{
  // 23: can cause lethal O2 loss.
  const noGods = createInstance('nu-no-gods', 'Special');
  const feedbackLoop = createInstance('nu-feedback-loop', 'Negate');
  const p1 = fixturePlayer('player1', 'Neon Underground', createInstance('nu-riot-runner', 'Apex'), { hand: [noGods], o2: 1 });
  const p2 = fixturePlayer('player2', 'Neon Underground', createInstance('nu-street-beast', 'Apex'), { hand: [feedbackLoop], momentum: 2 });
  useGameStore.setState(fixtureState(p1, p2, { phase: 'Main', selectedFactions: { player1: 'Neon Underground', player2: 'Neon Underground' } }));
  useGameStore.getState().playSpecialCard(noGods.instanceId);
  const negateItem = useGameStore.getState().pendingResponseQueue[0];
  if (negateItem?.stage === 'negateWindow') {
    useGameStore.getState().resolveResponse({ type: 'negate', cardInstanceId: feedbackLoop.instanceId });
  }
  const after = useGameStore.getState();
  check('Feedback Loop can cause lethal O2 loss and end the game', after.status === 'gameover' && after.winnerId === 'player2');
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
