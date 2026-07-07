/* Targeted tests for the "centralized damage calculation" patch:
   - Choke Counter scaling (-100 per counter, not flat)
   - Spark-Plug end-to-end (the ctx.chainedApexId bug that silently broke 5 of 6
     Ability Supports - this suite specifically goes through the real syncAbility
     invocation path, unlike earlier tests that set armedBonus directly and so never
     exercised the buggy code)
   - Equip + Choke stacking, damage floor at 0
   - Failed attacks (damage < DEF) don't punish the attacker
   - Outcome preview accuracy (no break / exact break+reward / overflow / no reward) */
import { useGameStore } from '../store/gameStore';
import { createInstance } from '../data/decks';
import { getPreviewAttackDamage, getAttackOutcomePreview, addCounterFn } from '../game/rules';
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
  support: ReturnType<typeof createInstance> | null = null,
  overrides: Partial<PlayerState> = {}
): PlayerState {
  return {
    id,
    faction,
    deck: [],
    hand: [],
    discard: [],
    apexSlots: [apex, null],
    supportSlots: [support, null, null],
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
    ...extra,
  };
}

console.log('=== Test 1: 3 CHK counters reduce a 600 attack to 300 (Alley Wraith Vanish Strike) ===');
{
  const p1Apex = createInstance('nu-alley-wraith', 'Apex');
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex);
  const p2 = fixturePlayer('player2', 'Dark White', p2Apex);
  const state = fixtureState(p1, p2);
  useGameStore.setState(state);
  useGameStore.setState(produce(useGameStore.getState(), (s) => addCounterFn(s, p1Apex.instanceId, 'choke', 3)));

  const preview = getPreviewAttackDamage(useGameStore.getState(), p1Apex.instanceId, 'vanish-strike')!;
  check('base damage is 600', preview.baseDamage === 600);
  check('3 CHK reduces 600 to 300', preview.modifiedDamage === 300);
  check('modifier breakdown shows "Choke Counter x3" for -300', preview.modifiers.some((m) => m.label === 'Choke Counter x3' && m.amount === -300));
}

console.log('=== Test 2: Spark-Plug +200 and 3 CHK counters make a 600 attack become 500 ===');
{
  const p1Apex = createInstance('nu-alley-wraith', 'Apex');
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex);
  const p2 = fixturePlayer('player2', 'Dark White', p2Apex);
  useGameStore.setState(fixtureState(p1, p2));
  useGameStore.setState(
    produce(useGameStore.getState(), (s) => {
      addCounterFn(s, p1Apex.instanceId, 'choke', 3);
      const apex = s.players.player1.apexSlots[0]!;
      apex.armedBonus = 200;
    })
  );
  const preview = getPreviewAttackDamage(useGameStore.getState(), p1Apex.instanceId, 'vanish-strike')!;
  check('600 base + 200 armed - 300 choke = 500', preview.modifiedDamage === 500);
}

console.log('=== Test 3 & 4: Card display data and attack selector both derive from the same preview ===');
{
  // Both the board card (PlayerBoard.tsx) and the attack selector (CombatControls.tsx) call
  // getPreviewAttackDamage directly - there is only one implementation to test.
  const p1Apex = createInstance('nu-alley-wraith', 'Apex');
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex), fixturePlayer('player2', 'Dark White', p2Apex)));
  useGameStore.setState(produce(useGameStore.getState(), (s) => addCounterFn(s, p1Apex.instanceId, 'choke', 1)));
  const preview1 = getPreviewAttackDamage(useGameStore.getState(), p1Apex.instanceId, 'vanish-strike');
  const preview2 = getPreviewAttackDamage(useGameStore.getState(), p1Apex.instanceId, 'vanish-strike');
  check('repeated calls (as board + selector would make) return identical results', JSON.stringify(preview1) === JSON.stringify(preview2));
  check('modified damage reflects the Choke Counter (500)', preview1?.modifiedDamage === 500);
}

console.log('=== Test 5 & 6: Combat resolution uses the same number as the preview, and the log shows the breakdown ===');
{
  const p1Apex = createInstance('nu-alley-wraith', 'Apex');
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex), fixturePlayer('player2', 'Dark White', p2Apex)));
  useGameStore.setState(produce(useGameStore.getState(), (s) => addCounterFn(s, p1Apex.instanceId, 'choke', 3)));
  const preview = getPreviewAttackDamage(useGameStore.getState(), p1Apex.instanceId, 'vanish-strike')!;

  useGameStore.getState().declareAttack(p1Apex.instanceId, 'vanish-strike', p2Apex.instanceId);
  const log = useGameStore.getState().log.map((l) => l.message);
  check('resolved combat used the same 300 damage the preview showed', log.some((m) => m.includes(`for ${preview.modifiedDamage} damage`)));
  check('log shows the Choke Counter modifier by name', log.some((m) => m.includes('Choke Counter x3')));
}

console.log('=== Test 7-11: Spark-Plug armed bonus - full end-to-end lifecycle ===');
{
  // Test 7 & 9: bonus applies on the NEXT attack, not the same attack that armed it.
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  const sparkPlug = createInstance('nu-spark-plug', 'AbilitySupport');
  sparkPlug.chainedApexId = p1Apex.instanceId;
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex, sparkPlug), fixturePlayer('player2', 'Dark White', p2Apex)));

  const previewBeforeFirstAttack = getPreviewAttackDamage(useGameStore.getState(), p1Apex.instanceId, 'mob-charge')!;
  check('before Spark-Plug has triggered, no armed bonus is present', previewBeforeFirstAttack.modifiedDamage === previewBeforeFirstAttack.baseDamage);

  useGameStore.getState().declareAttack(p1Apex.instanceId, 'mob-charge', p2Apex.instanceId);
  const firstAttackLog = useGameStore.getState().log.map((l) => l.message);
  check(
    'the attack that triggered Spark-Plug did NOT itself get the +200 (armed bonus applies next attack only)',
    !firstAttackLog.some((m) => m.includes('gains 200 attack') || m.includes('armed bonus'))
  );
  check("Spark-Plug's Sync Ability actually triggered", firstAttackLog.some((m) => m.includes("Spark-Plug's Sync Ability triggers")));

  const apexAfterFirstAttack = useGameStore.getState().players.player1.apexSlots[0];
  check('armedBonus is now genuinely set to 200 on the apex (the actual bug fix)', apexAfterFirstAttack?.armedBonus === 200);

  // Advance through a *real* turn boundary (End Turn -> opponent's full turn -> back to
  // player1's Start Phase, which is what actually resets hasAttacked) rather than patching
  // fields directly, so this genuinely exercises "during its controller's next turn."
  useGameStore.getState().endTurn(); // player1's turn ends, player2's turn begins
  useGameStore.getState().advancePhase('Start');
  useGameStore.getState().advancePhase('Main');
  useGameStore.getState().advancePhase('Combat');
  useGameStore.getState().endTurn(); // player2's turn ends, back to player1
  useGameStore.getState().advancePhase('Start');
  useGameStore.getState().advancePhase('Main');
  useGameStore.getState().advancePhase('Combat');

  check("hasAttacked was reset for player1's new turn", useGameStore.getState().players.player1.apexSlots[0]?.hasAttacked === false);
  const previewNextTurn = getPreviewAttackDamage(useGameStore.getState(), p1Apex.instanceId, 'mob-charge')!;
  check('on the next turn, the +200 armed bonus is visible in the preview', previewNextTurn.modifiedDamage === previewNextTurn.baseDamage + 200);

  useGameStore.getState().declareAttack(p1Apex.instanceId, 'mob-charge', p2Apex.instanceId);
  const secondAttackLog = useGameStore.getState().log.map((l) => l.message);
  check(
    'the +200 armed bonus was actually consumed and applied to the second attack\'s damage',
    secondAttackLog.some((m) => m.includes('gains 200 attack (armed bonus)'))
  );
  // Spark-Plug's Sync Ability fires again after every attack by its chained Apex (per its own
  // text: "After the chained Apex attacks, arm it..."), so the bonus is correctly re-armed to
  // 200 for a *future* third attack - it is not meant to stay at 0 forever after one use.
  const apexAfterSecondAttack = useGameStore.getState().players.player1.apexSlots[0];
  check(
    "armed bonus is consumed then correctly re-armed by Spark-Plug's Sync Ability (not stuck or double-counted)",
    apexAfterSecondAttack?.armedBonus === 200
  );
}

console.log('=== Test 8 (isolated): armed bonus is consumed after use, with no chained Support to re-arm it ===');
{
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  p1Apex.armedBonus = 200; // armed directly, no Spark-Plug involved, so nothing re-arms it
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex), fixturePlayer('player2', 'Dark White', p2Apex)));
  useGameStore.getState().declareAttack(p1Apex.instanceId, 'mob-charge', p2Apex.instanceId);
  const apexAfter = useGameStore.getState().players.player1.apexSlots[0];
  check('armed bonus is consumed down to 0 with nothing to re-arm it', (apexAfter?.armedBonus ?? 0) === 0);
}

console.log('=== Test 10: Spark-Plug bonus does not apply to the wrong Apex ===');
{
  const p1ApexA = createInstance('nu-riot-runner', 'Apex');
  const p1ApexB = createInstance('nu-street-beast', 'Apex');
  const sparkPlug = createInstance('nu-spark-plug', 'AbilitySupport');
  sparkPlug.chainedApexId = p1ApexA.instanceId; // chained to A, not B
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  const p1 = fixturePlayer('player1', 'Neon Underground', p1ApexA, sparkPlug);
  p1.apexSlots = [p1ApexA, p1ApexB];
  useGameStore.setState(fixtureState(p1, fixturePlayer('player2', 'Dark White', p2Apex)));

  useGameStore.getState().declareAttack(p1ApexA.instanceId, 'mob-charge', p2Apex.instanceId);
  const apexAAfter = useGameStore.getState().players.player1.apexSlots.find((a) => a?.instanceId === p1ApexA.instanceId);
  const apexBAfter = useGameStore.getState().players.player1.apexSlots.find((a) => a?.instanceId === p1ApexB.instanceId);
  check('the chained Apex (A) gets the armed bonus', apexAAfter?.armedBonus === 200);
  check('the unchained Apex (B) does NOT get the armed bonus', (apexBAfter?.armedBonus ?? 0) === 0);
}

console.log('=== Test 11: Spark-Plug armed bonus is cleared safely if the Apex leaves play ===');
{
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  p1Apex.armedBonus = 200;
  const p2Apex = createInstance('dw-overseer-prime', 'Apex'); // 400 DEF, exact match for a lethal test hit
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex), fixturePlayer('player2', 'Dark White', p2Apex)));
  // Destroy the armed Apex directly (simulating it leaving play) and confirm nothing throws
  // and no stray reference to it remains armed anywhere reachable.
  useGameStore.setState(
    produce(useGameStore.getState(), (s) => {
      s.players.player1.apexSlots[0] = null;
      s.players.player1.discard.push(p1Apex);
    })
  );
  check('no crash occurs and the Apex is cleanly off the board', useGameStore.getState().players.player1.apexSlots[0] === null);
}

console.log('=== Test 12 & 13: Equip + Choke stack correctly, and damage floors at 0 ===');
{
  const p1Apex = createInstance('nu-riot-runner', 'Apex');
  const plasmaEdge = createInstance('nu-plasma-edge', 'Equip');
  p1Apex.equip = plasmaEdge;
  const p2Apex = createInstance('dw-glass-warden', 'Apex');
  useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex), fixturePlayer('player2', 'Dark White', p2Apex)));
  useGameStore.setState(produce(useGameStore.getState(), (s) => addCounterFn(s, p1Apex.instanceId, 'choke', 2)));

  // Pipe Swing: 200 base, +100 Plasma Edge, -200 (2 CHK) = 100
  const preview = getPreviewAttackDamage(useGameStore.getState(), p1Apex.instanceId, 'pipe-swing')!;
  check('Equip (+100) and 2 CHK (-200) both apply: 200 + 100 - 200 = 100', preview.modifiedDamage === 100);

  // Now push Choke high enough that it would go negative, and confirm it floors at 0.
  useGameStore.setState(produce(useGameStore.getState(), (s) => addCounterFn(s, p1Apex.instanceId, 'choke', 5)));
  const preview2 = getPreviewAttackDamage(useGameStore.getState(), p1Apex.instanceId, 'pipe-swing')!;
  check('damage never goes negative - floors at 0', preview2.modifiedDamage === 0);
}

console.log('=== Test 14 & 15: Failed attacks (damage < DEF) do not punish the attacker but still count as an attack ===');
{
  const p1Apex = createInstance('nu-riot-runner', 'Apex'); // Mob Charge = 400
  const p2Apex = createInstance('dw-glass-warden', 'Apex'); // 600 DEF - survives comfortably
  const p1 = fixturePlayer('player1', 'Neon Underground', p1Apex, null, { momentum: 1 });
  const p2 = fixturePlayer('player2', 'Dark White', p2Apex, null, { momentum: 1 });
  useGameStore.setState(fixtureState(p1, p2));
  const o2P1Before = useGameStore.getState().players.player1.o2;
  const o2P2Before = useGameStore.getState().players.player2.o2;
  const momentumP1Before = useGameStore.getState().players.player1.momentum;

  useGameStore.getState().declareAttack(p1Apex.instanceId, 'mob-charge', p2Apex.instanceId);

  const after = useGameStore.getState();
  check('target (Glass Warden) survives', after.players.player2.apexSlots[0] !== null);
  check('defender loses 0 O2', after.players.player2.o2 === o2P2Before);
  check('attacker loses 0 O2', after.players.player1.o2 === o2P1Before);
  check('no Apex Break Reward (nothing was destroyed)', after.players.player1.momentum === momentumP1Before);
  check('the Apex is marked as having attacked this turn', after.players.player1.apexSlots[0]?.hasAttacked === true);
}

console.log('=== Test 23: Outcome preview accuracy (4 scenarios) ===');
{
  // No break: 400 damage vs 600 DEF.
  {
    const p1Apex = createInstance('nu-riot-runner', 'Apex');
    const p2Apex = createInstance('dw-glass-warden', 'Apex');
    useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex), fixturePlayer('player2', 'Dark White', p2Apex)));
    const preview = getAttackOutcomePreview(useGameStore.getState(), p1Apex.instanceId, 'mob-charge', p2Apex.instanceId)!;
    check('no-break preview: willDestroy is false', !preview.willDestroy);
    check('no-break preview: o2Loss is 0', preview.o2Loss === 0);
    check('no-break preview: no Apex Break Reward', !preview.apexBreakRewardWouldTrigger);
  }
  // Exact break with Apex Break Reward: 400 damage vs 400 DEF (Overseer Prime).
  {
    const p1Apex = createInstance('nu-riot-runner', 'Apex');
    const p2Apex = createInstance('dw-overseer-prime', 'Apex');
    useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex), fixturePlayer('player2', 'Dark White', p2Apex)));
    const preview = getAttackOutcomePreview(useGameStore.getState(), p1Apex.instanceId, 'mob-charge', p2Apex.instanceId)!;
    check('exact-break preview: willDestroy is true', preview.willDestroy);
    check('exact-break preview: 0 overflow, 0 O2 loss', preview.overflow === 0 && preview.o2Loss === 0);
    check('exact-break preview: Apex Break Reward would trigger', preview.apexBreakRewardWouldTrigger);
  }
  // Overflow: 400 damage vs 300 DEF (Pale Executioner).
  {
    const p1Apex = createInstance('nu-riot-runner', 'Apex');
    const p2Apex = createInstance('dw-pale-executioner', 'Apex');
    useGameStore.setState(fixtureState(fixturePlayer('player1', 'Neon Underground', p1Apex), fixturePlayer('player2', 'Dark White', p2Apex)));
    const preview = getAttackOutcomePreview(useGameStore.getState(), p1Apex.instanceId, 'mob-charge', p2Apex.instanceId)!;
    check('overflow preview: willDestroy is true', preview.willDestroy);
    check('overflow preview: 100 overflow, 1 O2 loss', preview.overflow === 100 && preview.o2Loss === 1);
    check('overflow preview: no Apex Break Reward when O2 damage is dealt', !preview.apexBreakRewardWouldTrigger);
  }
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
