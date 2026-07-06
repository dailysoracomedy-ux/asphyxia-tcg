/* Targeted tests for the Apex Break Reward rule:
   "When an attacking Apex destroys an enemy Apex and that attack deals 0 O2 damage,
    the attacking player gains 1 Momentum."
   Builds precise combat fixtures via useGameStore.setState so exact damage/DEF numbers
   are deterministic, then drives the real declareAttack/resolveResponse actions. */
import { useGameStore } from '../store/gameStore';
import { createInstance } from '../data/decks';
import { getCardDef } from '../data/cards';
import { destroyApexFn, getEligibleResponses, MAX_O2 } from '../game/rules';
import type { GameState, PlayerState, PlayerId, Faction, PendingResponseItem, ResponseEvent } from '../types/game';

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
    discard: [],
    apexSlots: [apex, null],
    supportSlots: [null, null, null],
    o2: MAX_O2,
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

/** Builds a deterministic 2-apex Combat Phase fixture and installs it as the live store state. */
function setupCombat(opts: {
  p1DefId: string;
  p2DefId: string | null;
  p1Overrides?: Partial<PlayerState>;
  p2Overrides?: Partial<PlayerState>;
}) {
  const p1Apex = createInstance(opts.p1DefId, 'Apex');
  const p1Faction = getCardDef(opts.p1DefId).faction;
  const p2Apex = opts.p2DefId ? createInstance(opts.p2DefId, 'Apex') : null;
  const p2Faction = opts.p2DefId ? getCardDef(opts.p2DefId).faction : 'Dark White';

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
  return { p1ApexId: p1Apex.instanceId, p2ApexId: p2Apex?.instanceId };
}

function eventForItem(item: PendingResponseItem) {
  if (item.stage === 'reactionChoice') {
    const t = item.trigger;
    if (t.kind === 'ownApexWouldBeDestroyed') return { respondingPlayerId: item.respondingPlayerId, event: { kind: 'APEX_WOULD_BE_DESTROYED', data: t } as ResponseEvent };
  }
  return null;
}

console.log('=== Test 1: Exact lethal damage destroys Apex and grants +1 Momentum ===');
{
  // Riot Runner's Mob Charge (400 dmg, 1 Sync) vs Overseer Prime (400 DEF) - exact lethal, 0 overflow.
  const { p1ApexId, p2ApexId } = setupCombat({ p1DefId: 'nu-riot-runner', p2DefId: 'dw-overseer-prime' });
  const momentumBefore = useGameStore.getState().players.player1.momentum;
  useGameStore.getState().declareAttack(p1ApexId, 'mob-charge', p2ApexId);
  const after = useGameStore.getState();
  check('Overseer Prime was destroyed', after.players.player2.apexSlots[0] === null);
  check('Attacker (player1) gained +1 Momentum', after.players.player1.momentum === momentumBefore + 1);
  check('log mentions Apex Break Reward', after.log.some((l) => l.message.includes('Apex Break Reward')));
  check('log mentions no O2 damage was dealt', after.log.some((l) => l.message.includes('No O2 damage was dealt')));
}

console.log('=== Test 2: Destroying with overflow O2 damage does NOT grant the reward ===');
{
  // Riot Runner's Last Breath Rush (700 dmg, 3 Sync) vs Overseer Prime (400 DEF) -> 300 overflow -> 1 O2 lost.
  const { p1ApexId, p2ApexId } = setupCombat({ p1DefId: 'nu-riot-runner', p2DefId: 'dw-overseer-prime' });
  const momentumBefore = useGameStore.getState().players.player1.momentum;
  useGameStore.getState().declareAttack(p1ApexId, 'last-breath-rush', p2ApexId);
  const after = useGameStore.getState();
  check('Overseer Prime was destroyed', after.players.player2.apexSlots[0] === null);
  check('O2 damage was actually dealt (overflow)', after.players.player2.o2 < MAX_O2);
  check('Attacker did NOT gain Momentum from Apex Break Reward', after.players.player1.momentum === momentumBefore);
  check('log does not claim Apex Break Reward fired', !after.log.some((l) => l.message.includes('gains 1 Momentum from Apex Break Reward')));
}

console.log('=== Test 3: Damaging but not destroying grants no reward ===');
{
  // Riot Runner's Mob Charge (400 dmg) vs Glass Warden (600 DEF) -> survives.
  const { p1ApexId, p2ApexId } = setupCombat({ p1DefId: 'nu-riot-runner', p2DefId: 'dw-glass-warden' });
  const momentumBefore = useGameStore.getState().players.player1.momentum;
  useGameStore.getState().declareAttack(p1ApexId, 'mob-charge', p2ApexId);
  const after = useGameStore.getState();
  check('Glass Warden survives', after.players.player2.apexSlots[0] !== null);
  check('Attacker gained no Momentum', after.players.player1.momentum === momentumBefore);
}

console.log('=== Test 4: Backup Consciousness preventing destruction grants no reward ===');
{
  const backupConsciousness = createInstance('sa-backup-consciousness', 'Reaction');
  const { p1ApexId, p2ApexId } = setupCombat({
    p1DefId: 'nu-riot-runner',
    p2DefId: 'sa-halcyon-maw', // 400 DEF, exact match for Mob Charge (400 dmg) -> would be exact lethal
    p2Overrides: { momentum: 1, hand: [backupConsciousness] },
  });
  const momentumBefore = useGameStore.getState().players.player1.momentum;
  useGameStore.getState().declareAttack(p1ApexId, 'mob-charge', p2ApexId);

  // Resolve the ownApexWouldBeDestroyed response window by playing Backup Consciousness.
  const item = useGameStore.getState().pendingResponseQueue[0];
  check('a response window opened for the defender', !!item && item.stage === 'reactionChoice');
  if (item && item.stage === 'reactionChoice') {
    const built = eventForItem(item);
    const eligible = built ? getEligibleResponses(useGameStore.getState(), built.respondingPlayerId, built.event) : [];
    check('Backup Consciousness is offered as an eligible response', eligible.some((c) => c.defId === 'sa-backup-consciousness'));
    useGameStore.getState().resolveResponse({ type: 'reaction', cardInstanceId: backupConsciousness.instanceId });
  }

  const after = useGameStore.getState();
  check('Halcyon Maw survived (destruction prevented)', after.players.player2.apexSlots[0] !== null);
  check('Attacker gained no Momentum from Apex Break Reward', after.players.player1.momentum === momentumBefore);
  check('log does not claim Apex Break Reward fired', !after.log.some((l) => l.message.includes('gains 1 Momentum from Apex Break Reward')));
}

console.log('=== Test 5: Direct attacks never trigger the reward ===');
{
  // No Apex on player2's board at all -> forces a direct O2 attack.
  const { p1ApexId } = setupCombat({ p1DefId: 'nu-riot-runner', p2DefId: null });
  const momentumBefore = useGameStore.getState().players.player1.momentum;
  useGameStore.getState().declareAttack(p1ApexId, 'mob-charge', undefined);
  const after = useGameStore.getState();
  check('O2 damage was dealt directly', after.players.player2.o2 < MAX_O2);
  check('Attacker gained no Momentum from Apex Break Reward', after.players.player1.momentum === momentumBefore);
  check('log does not claim Apex Break Reward fired', !after.log.some((l) => l.message.includes('gains 1 Momentum from Apex Break Reward')));
}

console.log('=== Test 6: Non-attack destruction effects never trigger the reward ===');
{
  const { p2ApexId } = setupCombat({ p1DefId: 'nu-riot-runner', p2DefId: 'dw-overseer-prime' });
  const p1MomentumBefore = useGameStore.getState().players.player1.momentum;
  const p2MomentumBefore = useGameStore.getState().players.player2.momentum;

  // Directly invoke the low-level destroy function, bypassing the attack pipeline entirely -
  // this is what "an effect destroys an Apex outside attack damage" looks like mechanically.
  useGameStore.setState((state) => {
    const draft = { ...state };
    destroyApexFn(draft as unknown as GameState, p2ApexId!);
    return draft;
  });

  const after = useGameStore.getState();
  check('the Apex was destroyed', after.players.player2.apexSlots[0] === null);
  check('player1 Momentum unchanged (no attack occurred)', after.players.player1.momentum === p1MomentumBefore);
  check('player2 Momentum unchanged', after.players.player2.momentum === p2MomentumBefore);
  check('log does not claim Apex Break Reward fired', !after.log.some((l) => l.message.includes('gains 1 Momentum from Apex Break Reward')));
}

console.log('=== Test 7: Emergency Authority reduces overflow O2 loss all the way to 0 - reward still does NOT trigger ===');
{
  // Riot Runner Mob Charge (400) vs Pale Executioner (300 DEF) -> 100 overflow -> 1 O2 loss,
  // which Emergency Authority's -1 reduction absorbs completely. Even though the *final* O2
  // loss is 0, overflow damage genuinely occurred, so this must NOT count as a clean break.
  const emergencyAuthority = createInstance('dw-emergency-authority', 'Reaction');
  const { p1ApexId, p2ApexId } = setupCombat({
    p1DefId: 'nu-riot-runner',
    p2DefId: 'dw-pale-executioner',
    p2Overrides: { momentum: 1, hand: [emergencyAuthority] },
  });
  const momentumBefore = useGameStore.getState().players.player1.momentum;
  const o2Before = useGameStore.getState().players.player2.o2;

  useGameStore.getState().declareAttack(p1ApexId, 'mob-charge', p2ApexId);
  const item = useGameStore.getState().pendingResponseQueue[0];
  check('a response window opened for the O2 loss', !!item && item.stage === 'reactionChoice');
  if (item && item.stage === 'reactionChoice') {
    useGameStore.getState().resolveResponse({ type: 'reaction', cardInstanceId: emergencyAuthority.instanceId });
  }

  const after = useGameStore.getState();
  check('Pale Executioner was destroyed', after.players.player2.apexSlots[0] === null);
  check('final O2 loss is 0 (fully absorbed by Emergency Authority)', after.players.player2.o2 === o2Before);
  check('Attacker gained NO Momentum from Apex Break Reward', after.players.player1.momentum === momentumBefore);
  check(
    'log explains the reward was denied because overflow was prevented by a Reaction',
    after.log.some((l) => l.message.includes('Apex Break Reward does not trigger'))
  );
  check('log does not claim the reward actually fired', !after.log.some((l) => l.message.includes('gains 1 Momentum from Apex Break Reward')));
}

console.log('=== Test 8 (exact requested scenario): Riot Runner deals 400 damage to Pale Executioner (300 DEF) ===');
{
  // Expected: Pale Executioner destroyed, 100 overflow, player2 loses 1 O2, no Apex Break Reward.
  const { p1ApexId, p2ApexId } = setupCombat({ p1DefId: 'nu-riot-runner', p2DefId: 'dw-pale-executioner' });
  const momentumBefore = useGameStore.getState().players.player1.momentum;
  const o2Before = useGameStore.getState().players.player2.o2;

  useGameStore.getState().declareAttack(p1ApexId, 'mob-charge', p2ApexId);

  const after = useGameStore.getState();
  check('Pale Executioner was destroyed', after.players.player2.apexSlots[0] === null);
  check('log records exactly 100 overflow', after.log.some((l) => l.message.includes('100 overflow')));
  check('player2 loses exactly 1 O2', o2Before - after.players.player2.o2 === 1);
  check('Apex Break Reward does NOT trigger', after.players.player1.momentum === momentumBefore);
  check('log does not claim the reward fired', !after.log.some((l) => l.message.includes('gains 1 Momentum from Apex Break Reward')));
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
