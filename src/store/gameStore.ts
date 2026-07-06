import { create } from 'zustand';
import { produce } from 'immer';
import type {
  ApexDef,
  AbilitySupportDef,
  AttackTriggerData,
  CardInstance,
  DestroyTriggerData,
  Faction,
  GameState,
  NegateDef,
  O2DamageTriggerData,
  Phase,
  PlayerId,
  PlayerState,
  ReactionDef,
  SpecialDef,
  TriggerData,
} from '@/types/game';
import { freshTurnFlags } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { buildStarterDeck, shuffle } from '@/data/decks';
import { determineRiftSpace } from '@/game/rifts';
import {
  DIRECT_O2_CAP_PER_TURN,
  MAX_ABILITY_SUPPORTS,
  STARTING_HAND_SIZE,
  STARTING_O2,
  createHelpers,
  destroyApexFn,
  directDamageToO2Loss,
  drawCardsFn,
  findApexAnywhere,
  getEffectiveDef,
  gainMomentumFn,
  logMsg,
  loseMomentumFn,
  otherPlayer,
  pruneExpiredModifiers,
  applyTempDefBuffFn,
  computeAvailableSync,
  addCounterFn,
} from '@/game/rules';

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

// --------------------------------------------------------------------------
// Response choice types (what the UI sends back into resolveResponse)
// --------------------------------------------------------------------------

export type ResponseChoice =
  | { type: 'pass' }
  | { type: 'reaction'; cardInstanceId: string }
  | { type: 'negate'; cardInstanceId: string }
  | { type: 'humanError'; pick: 'momentum' | 'damage' }
  | { type: 'alleyWraithCancel' }
  | { type: 'alleyWraithDecline' };

function freshPlayer(id: PlayerId, faction: Faction): PlayerState {
  return {
    id,
    faction,
    deck: [],
    hand: [],
    discard: [],
    apexSlots: [null, null],
    supportSlots: [null, null, null],
    o2: STARTING_O2,
    momentum: 0,
    availableSync: 0,
    turnFlags: freshTurnFlags(),
    pendingAttackBonus: 0,
    pendingTargetedAttackBonus: null,
    reserveGridShield: 0,
    lockedSupportInstanceId: null,
  };
}

function initialState(): GameState {
  return {
    status: 'menu',
    players: {
      player1: freshPlayer('player1', 'Neon Underground'),
      player2: freshPlayer('player2', 'Dark White'),
    },
    activePlayerId: 'player1',
    firstPlayerId: null,
    turnNumber: 0,
    phase: 'Start',
    riftSpace: null,
    log: [],
    winnerId: null,
    pendingResponseQueue: [],
    isFirstTurnOverall: false,
    selectedFactions: { player1: null, player2: null },
    openingApexSelectionPlayerId: null,
    reconfigureAwaitingPlay: false,
    startPhasePending: false,
  };
}

// ==========================================================================
// Helper predicates
// ==========================================================================

function hasEligibleReaction(
  draft: GameState,
  playerId: PlayerId,
  triggerKind: 'enemyApexAttacks' | 'opponentAttackDealsO2Damage' | 'ownApexWouldBeDestroyed'
): boolean {
  const player = draft.players[playerId];
  return player.hand.some((c) => {
    if (c.type !== 'Reaction') return false;
    const def = getCardDef(c.defId) as ReactionDef;
    return def.trigger === triggerKind && player.momentum >= def.cost;
  });
}

function hasEligibleNegate(draft: GameState, playerId: PlayerId, cardType: 'Special' | 'Equip' | 'Reaction', faction: Faction): boolean {
  const player = draft.players[playerId];
  return player.hand.some((c) => {
    if (c.type !== 'Negate') return false;
    const def = getCardDef(c.defId) as NegateDef;
    return player.momentum >= def.cost && def.canCancel(cardType, faction);
  });
}

// ==========================================================================
// Turn structure
// ==========================================================================

function runStartPhase(draft: GameState) {
  const playerId = draft.activePlayerId;
  const player = draft.players[playerId];
  const oppId = otherPlayer(playerId);
  const opp = draft.players[oppId];

  logMsg(draft, `--- Turn ${draft.turnNumber}: ${playerId} (${player.faction}) - Start Phase ---`, 'phase');

  drawCardsFn(draft, playerId, 1);

  if (draft.riftSpace) {
    switch (draft.riftSpace.id) {
      case 'CivilWar':
        if (player.o2 < opp.o2) {
          gainMomentumFn(draft, playerId, 1);
          logMsg(draft, 'Civil War grants Momentum for trailing on O2.', 'rift');
        }
        break;
      case 'ControlConflict':
        if (player.lockedSupportInstanceId) {
          const support = player.supportSlots.find((s) => s?.instanceId === player.lockedSupportInstanceId);
          if (support) support.lockedByControlConflict = false;
          player.lockedSupportInstanceId = null;
          logMsg(draft, 'Control Conflict unlocks the previously locked Support.', 'rift');
        }
        break;
      case 'EchoRiot':
        if (player.o2 <= 3 && opp.o2 <= 3) {
          gainMomentumFn(draft, playerId, 1);
          logMsg(draft, 'Echo Riot grants Momentum - both players are critical on O2.', 'rift');
        }
        break;
      default:
        break;
    }
  }

  pruneExpiredModifiers(draft);
  player.pendingAttackBonus = 0;
  player.pendingTargetedAttackBonus = null;

  for (const apex of player.apexSlots) {
    if (!apex) continue;
    apex.hasAttacked = false;
    apex.traitUsedThisTurn = false;
    if (apex.attackLockedForTurn !== null && apex.attackLockedForTurn !== undefined && apex.attackLockedForTurn < draft.turnNumber) {
      apex.attackLockedForTurn = null;
    }
  }

  player.turnFlags = freshTurnFlags();
  player.availableSync = 0;

  draft.startPhasePending = false;
}

function runEndPhase(draft: GameState) {
  const playerId = draft.activePlayerId;
  const player = draft.players[playerId];
  logMsg(draft, `--- ${playerId} - End Phase ---`, 'phase');

  for (const apex of player.apexSlots) {
    if (!apex) continue;
    if (apex.pendingEndPhaseDefBuff) {
      applyTempDefBuffFn(draft, apex.instanceId, apex.pendingEndPhaseDefBuff, draft.turnNumber + 1);
      logMsg(draft, `${getCardDef(apex.defId).name} gains +${apex.pendingEndPhaseDefBuff} DEF until the end of the opponent's next turn.`, 'support');
      apex.pendingEndPhaseDefBuff = 0;
    }
    if (apex.pendingEndPhaseProtection) {
      if (!apex.protections) apex.protections = [];
      apex.protections.push({
        id: newId('prot'),
        reduction: apex.pendingEndPhaseProtection,
        expiresAfterTurn: draft.turnNumber + 1,
        label: `-${apex.pendingEndPhaseProtection} incoming dmg`,
      });
      logMsg(draft, `${getCardDef(apex.defId).name} gains protection until the end of the opponent's next turn.`, 'support');
      apex.pendingEndPhaseProtection = 0;
    }
  }

  if (draft.riftSpace?.id === 'RecursiveFailure' && player.turnFlags.cardsPlayedThisTurn <= 2) {
    const candidate = [...player.apexSlots]
      .filter((a): a is CardInstance => !!a)
      .sort((a, b) => (b.counters?.glitch ?? 0) - (a.counters?.glitch ?? 0))[0];
    if (candidate && candidate.counters && candidate.counters.glitch > 0) {
      candidate.counters.glitch -= 1;
      logMsg(draft, `Recursive Failure lets ${getCardDef(candidate.defId).name} shed a Glitch Counter.`, 'rift');
    }
  }
}

function advanceToNextTurn(draft: GameState) {
  draft.turnNumber += 1;
  draft.activePlayerId = otherPlayer(draft.activePlayerId);
  draft.phase = 'Start';
  draft.startPhasePending = true;
  draft.isFirstTurnOverall = false;
  draft.reconfigureAwaitingPlay = false;
}

function maybeRunEmergencyApexDraw(draft: GameState, playerId: PlayerId) {
  const player = draft.players[playerId];
  if (player.apexSlots.some(Boolean)) return;
  const hasApexInHand = player.hand.some((c) => c.type === 'Apex');
  if (hasApexInHand) return;

  logMsg(draft, `${playerId} controls no Apex and has none in hand - revealing hand and drawing for one.`, 'info');
  const revealed = [...player.hand];
  player.hand = [];
  let found: CardInstance | null = null;
  let safety = 0;
  const searchPile = [...revealed, ...player.deck];
  player.deck = [];
  while (searchPile.length > 0 && safety < 200) {
    safety += 1;
    const card = searchPile.shift()!;
    if (!found && card.type === 'Apex') {
      found = card;
    } else {
      player.deck.push(card);
    }
  }
  player.deck = shuffle(player.deck);
  if (found) {
    player.apexSlots[0] = found;
    const def = getCardDef(found.defId) as ApexDef;
    if (def.onEnterPlay) def.onEnterPlay({ helpers: createHelpers(draft), ownerId: playerId, apexInstanceId: found.instanceId });
    logMsg(draft, `${playerId} plays ${def.name} into Apex Slot 1.`, 'play');
  } else {
    logMsg(draft, `${playerId} found no Apex anywhere - this shouldn't happen with a legal deck!`, 'info');
  }
}

// ==========================================================================
// Attack resolution pipeline
// ==========================================================================

function proceedWithDestruction(draft: GameState, trigger: AttackTriggerData, overflow: number) {
  const helpers = createHelpers(draft);
  const attackerHit = findApexAnywhere(draft, trigger.attackerInstanceId);
  const apexDef = attackerHit ? (getCardDef(attackerHit.apex.defId) as ApexDef) : null;

  destroyApexFn(draft, trigger.targetInstanceId!);
  if (apexDef?.onDestroyEnemyApex) {
    apexDef.onDestroyEnemyApex({
      helpers,
      ownerId: trigger.attackerId,
      attackerInstanceId: trigger.attackerInstanceId,
      targetInstanceId: trigger.targetInstanceId,
      syncCost: trigger.syncCost,
      baseDamage: trigger.totalDamage,
      destroyedApexInstanceId: trigger.targetInstanceId!,
    });
  }

  if (overflow > 0) {
    resolveO2LossWindow(draft, {
      kind: 'opponentAttackDealsO2Damage',
      attackerId: trigger.attackerId,
      defenderId: otherPlayer(trigger.attackerId),
      amount: overflow,
      isOverflow: true,
      attackerInstanceId: trigger.attackerInstanceId,
      attackDefId: trigger.attackDefId,
      targetInstanceId: trigger.targetInstanceId,
      destroyedTarget: true,
    });
  } else {
    finalizeAttackEffects(draft, trigger, true, false);
  }
}

function resolveAttackAgainstTarget(draft: GameState, trigger: AttackTriggerData, damage: number) {
  const attackerHit = findApexAnywhere(draft, trigger.attackerInstanceId);
  if (!attackerHit) return;
  const apexDef = getCardDef(attackerHit.apex.defId) as ApexDef;
  const defenderId = otherPlayer(trigger.attackerId);

  if (trigger.targetInstanceId) {
    const targetHit = findApexAnywhere(draft, trigger.targetInstanceId);
    if (!targetHit) {
      finalizeAttackEffects(draft, trigger, false, false);
      return;
    }
    const targetDef = getCardDef(targetHit.apex.defId) as ApexDef;
    let dmg = damage;
    if (targetDef.incomingDamageReduction) dmg = targetDef.incomingDamageReduction(trigger.syncCost, dmg);

    const effectiveDef = getEffectiveDef(draft, trigger.targetInstanceId);
    if (dmg < effectiveDef) {
      logMsg(draft, `${apexDef.name} hits ${targetDef.name} for ${dmg} - not enough to break ${effectiveDef} DEF.`, 'damage');
      finalizeAttackEffects(draft, trigger, false, false);
      return;
    }

    let overflow = dmg - effectiveDef;
    if (targetHit.apex.equip) {
      const eqDef = getCardDef(targetHit.apex.equip.defId);
      if (eqDef.type === 'Equip' && eqDef.onOverflowDamage) overflow = eqDef.onOverflowDamage(overflow);
    }

    if (hasEligibleReaction(draft, defenderId, 'ownApexWouldBeDestroyed')) {
      draft.pendingResponseQueue.push({
        id: newId('rx'),
        stage: 'reactionChoice',
        respondingPlayerId: defenderId,
        trigger: {
          kind: 'ownApexWouldBeDestroyed',
          apexInstanceId: trigger.targetInstanceId,
          ownerId: defenderId,
          fromAttack: {
            attackerId: trigger.attackerId,
            attackerInstanceId: trigger.attackerInstanceId,
            attackDefId: trigger.attackDefId,
            syncCost: trigger.syncCost,
            totalDamage: damage,
            overflow,
          },
        },
      });
      logMsg(draft, `${targetDef.name} would be destroyed - ${defenderId} may respond.`, 'response');
      return;
    }

    proceedWithDestruction(draft, trigger, overflow);
    return;
  }

  const rawLoss = directDamageToO2Loss(damage);
  const attackerPlayer = draft.players[trigger.attackerId];
  const remainingCap = Math.max(0, DIRECT_O2_CAP_PER_TURN - attackerPlayer.turnFlags.directO2LossThisTurn);
  const cappedLoss = Math.min(rawLoss, remainingCap);

  if (cappedLoss <= 0) {
    logMsg(draft, `${apexDef.name} attacks O2 directly for ${damage} but the 2-per-turn direct O2 cap is already spent.`, 'damage');
    finalizeAttackEffects(draft, trigger, false, false);
    return;
  }

  resolveO2LossWindow(draft, {
    kind: 'opponentAttackDealsO2Damage',
    attackerId: trigger.attackerId,
    defenderId,
    amount: cappedLoss,
    isOverflow: false,
    attackerInstanceId: trigger.attackerInstanceId,
    attackDefId: trigger.attackDefId,
    targetInstanceId: undefined,
    destroyedTarget: false,
  });
}

function resolveO2LossWindow(draft: GameState, o2trigger: O2DamageTriggerData) {
  if (hasEligibleReaction(draft, o2trigger.defenderId, 'opponentAttackDealsO2Damage')) {
    draft.pendingResponseQueue.push({
      id: newId('rx'),
      stage: 'reactionChoice',
      respondingPlayerId: o2trigger.defenderId,
      trigger: o2trigger,
    });
    logMsg(draft, `${o2trigger.defenderId} may respond before losing ${o2trigger.amount} O2.`, 'response');
    return;
  }
  applyO2LossFinal(draft, o2trigger, 0);
}

function applyO2LossFinal(draft: GameState, o2trigger: O2DamageTriggerData, reduction: number) {
  const finalAmount = Math.max(0, o2trigger.amount - reduction);
  const helpers = createHelpers(draft);
  helpers.loseO2(o2trigger.defenderId, finalAmount);
  if (!o2trigger.isOverflow && finalAmount > 0) {
    draft.players[o2trigger.attackerId].turnFlags.directO2LossThisTurn += finalAmount;
  }
  const trigger: AttackTriggerData = {
    kind: 'enemyApexAttacks',
    attackerId: o2trigger.attackerId,
    attackerInstanceId: o2trigger.attackerInstanceId,
    attackDefId: o2trigger.attackDefId,
    targetInstanceId: o2trigger.targetInstanceId,
    syncCost: 0,
    totalDamage: 0,
  };
  finalizeAttackEffects(draft, trigger, o2trigger.destroyedTarget, finalAmount > 0);
}

function finishDestroyDecision(draft: GameState, trigger: DestroyTriggerData, prevented: boolean, survivorDef = 100) {
  const apexHit = findApexAnywhere(draft, trigger.apexInstanceId);
  const helpers = createHelpers(draft);

  if (prevented && apexHit) {
    apexHit.apex.survivorDefOverride = survivorDef;
    logMsg(draft, `${getCardDef(apexHit.apex.defId).name} survives at ${survivorDef} DEF (Backup Consciousness)!`, 'response');
    const owner = draft.players[trigger.ownerId];
    if (owner.o2 <= 2) {
      addCounterFn(draft, trigger.apexInstanceId, 'upgrade', 1);
      addCounterFn(draft, trigger.apexInstanceId, 'glitch', 1);
    }
    if (trigger.fromAttack) {
      const atk: AttackTriggerData = {
        kind: 'enemyApexAttacks',
        attackerId: trigger.fromAttack.attackerId,
        attackerInstanceId: trigger.fromAttack.attackerInstanceId,
        attackDefId: trigger.fromAttack.attackDefId,
        targetInstanceId: trigger.apexInstanceId,
        syncCost: trigger.fromAttack.syncCost,
        totalDamage: trigger.fromAttack.totalDamage,
      };
      finalizeAttackEffects(draft, atk, false, false);
    }
    return;
  }

  if (trigger.fromAttack) {
    const atk: AttackTriggerData = {
      kind: 'enemyApexAttacks',
      attackerId: trigger.fromAttack.attackerId,
      attackerInstanceId: trigger.fromAttack.attackerInstanceId,
      attackDefId: trigger.fromAttack.attackDefId,
      targetInstanceId: trigger.apexInstanceId,
      syncCost: trigger.fromAttack.syncCost,
      totalDamage: trigger.fromAttack.totalDamage,
    };
    proceedWithDestruction(draft, atk, trigger.fromAttack.overflow);
  } else if (apexHit) {
    helpers.destroyApex(trigger.apexInstanceId);
  }
}

function finalizeAttackEffects(
  draft: GameState,
  trigger: AttackTriggerData,
  destroyedTarget: boolean,
  dealtO2Damage: boolean
) {
  const attackerHit = findApexAnywhere(draft, trigger.attackerInstanceId);
  const helpers = createHelpers(draft);

  if (attackerHit) {
    const apexDef = getCardDef(attackerHit.apex.defId) as ApexDef;
    const attackDef = apexDef.attacks.find((a) => a.id === trigger.attackDefId);
    const ctx = {
      helpers,
      ownerId: trigger.attackerId,
      attackerInstanceId: trigger.attackerInstanceId,
      targetInstanceId: trigger.targetInstanceId,
      syncCost: trigger.syncCost,
      baseDamage: attackDef?.baseDamage ?? 0,
      destroyedTarget,
      dealtO2Damage,
    };

    if (attackDef?.onResolve) attackDef.onResolve(ctx);

    if (attackerHit.apex.armedBonusIsOverclock) {
      attackerHit.apex.armedBonusIsOverclock = false;
      helpers.loseO2(trigger.attackerId, dealtO2Damage ? 1 : 2, { fromOwnEffect: true });
      logMsg(draft, 'Overclock burns O2 as its damage resolves.', 'o2');
    }

    const player = draft.players[trigger.attackerId];
    for (const support of player.supportSlots) {
      if (!support || support.type !== 'AbilitySupport') continue;
      if (support.chainedApexId !== trigger.attackerInstanceId) continue;
      if (support.lockedByControlConflict) continue;
      if (support.enteredViaReconfigureTurn === draft.turnNumber) continue;
      const supportDef = getCardDef(support.defId) as AbilitySupportDef;
      supportDef.syncAbility({ ...ctx, chainedApexId: support.instanceId });
      if (support.defId === 'sa-drone-choir' && apexDef.faction === 'Synth Ascendancy') {
        helpers.armAttackBonus(trigger.attackerInstanceId, 100);
      }
      logMsg(draft, `${supportDef.name}'s Sync Ability triggers.`, 'support');
    }
  }

  logMsg(draft, 'Attack fully resolved.', 'attack');
}

function applyChosenReactionAndContinue(
  draft: GameState,
  trigger: TriggerData,
  reactionDef: ReactionDef,
  reactionOwnerId: PlayerId
) {
  const helpers = createHelpers(draft);
  const result = (reactionDef.resolve({ helpers, ownerId: reactionOwnerId }) ?? {}) as Record<string, unknown>;

  if (trigger.kind === 'enemyApexAttacks') {
    const reduction = (result.damageReduction as number) ?? 0;
    const newDamage = Math.max(0, trigger.totalDamage - reduction);
    if (reactionDef.id === 'nu-glitch-step') {
      const owner = draft.players[reactionOwnerId];
      const hasSmallNeon = owner.apexSlots.some(
        (a) => a && getCardDef(a.defId).faction === 'Neon Underground' && getEffectiveDef(draft, a.instanceId) <= 300
      );
      if (hasSmallNeon) gainMomentumFn(draft, reactionOwnerId, 1);
    }
    resolveAttackAgainstTarget(draft, trigger, newDamage);
    return;
  }

  if (trigger.kind === 'ownApexWouldBeDestroyed') {
    const prevented = !!result.preventDestruction;
    finishDestroyDecision(draft, trigger, prevented, (result.survivorDef as number) ?? 100);
    return;
  }

  if (trigger.kind === 'opponentAttackDealsO2Damage') {
    if (reactionDef.id === 'dw-emergency-authority') {
      const defender = draft.players[reactionOwnerId];
      if (defender.o2 <= 2) {
        addCounterFn(draft, trigger.attackerInstanceId, 'choke', 1, reactionOwnerId);
      }
    }
    const reduction = (result.o2Reduction as number) ?? 0;
    applyO2LossFinal(draft, trigger, reduction);
  }
}

function continueTriggerUnmodified(draft: GameState, trigger: TriggerData) {
  if (trigger.kind === 'enemyApexAttacks') {
    resolveAttackAgainstTarget(draft, trigger, trigger.totalDamage);
  } else if (trigger.kind === 'ownApexWouldBeDestroyed') {
    finishDestroyDecision(draft, trigger, false);
  } else if (trigger.kind === 'opponentAttackDealsO2Damage') {
    applyO2LossFinal(draft, trigger, 0);
  }
}

// ==========================================================================
// Store
// ==========================================================================

interface GameStore extends GameState {
  startNewGame: (p1: Faction, p2: Faction) => void;
  selectOpeningApex: (playerId: PlayerId, cardInstanceId: string) => void;
  advancePhase: (phase: Phase) => void;
  endTurn: () => void;
  playApexCard: (cardInstanceId: string, slotIndex?: number) => void;
  playSupportCard: (cardInstanceId: string, slotIndex?: number, chainedApexId?: string) => void;
  playEquipCard: (cardInstanceId: string, apexInstanceId: string) => void;
  playSpecialCard: (cardInstanceId: string, targetApexInstanceId?: string) => void;
  reconfigure: (returnInstanceId: string, playInstanceId?: string, chainedApexId?: string) => void;
  declareAttack: (attackerInstanceId: string, attackId: string, targetInstanceId?: string) => void;
  resolveResponse: (choice: ResponseChoice) => void;
  lockSupportControlConflict: (supportInstanceId: string) => void;
  resetToMenu: () => void;
}

function mutate(set: (fn: (state: GameStore) => Partial<GameStore> | GameStore) => void, mutator: (draft: GameState) => void) {
  set((state) => produce(state, (draft) => mutator(draft as unknown as GameState)) as GameStore);
}

export const useGameStore = create<GameStore>((set) => ({
  ...initialState(),

  startNewGame: (p1Faction, p2Faction) =>
    mutate(set, (draft) => {
      Object.assign(draft, initialState());
      draft.selectedFactions = { player1: p1Faction, player2: p2Faction };

      for (const [pid, faction] of [
        ['player1', p1Faction],
        ['player2', p2Faction],
      ] as [PlayerId, Faction][]) {
        const player = freshPlayer(pid, faction);
        let deck = shuffle(buildStarterDeck(faction));
        let hand: CardInstance[] = [];
        let safety = 0;
        while (safety < 25) {
          safety += 1;
          hand = deck.slice(0, STARTING_HAND_SIZE);
          const rest = deck.slice(STARTING_HAND_SIZE);
          if (hand.some((c) => c.type === 'Apex')) {
            deck = rest;
            break;
          }
          logMsg(draft, `${pid} reveals a hand with no Apex - shuffling back and redrawing.`, 'info');
          deck = shuffle([...hand, ...rest]);
        }
        player.deck = deck;
        player.hand = hand;
        draft.players[pid] = player;
      }

      draft.riftSpace = determineRiftSpace(p1Faction, p2Faction);
      draft.status = 'selectingOpeningApex';
      draft.openingApexSelectionPlayerId = 'player1';
      logMsg(draft, `New game: ${p1Faction} vs ${p2Faction}. Rift Space: ${draft.riftSpace.name}.`, 'info');
      logMsg(draft, draft.riftSpace.description, 'rift');
    }),

  selectOpeningApex: (playerId, cardInstanceId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'selectingOpeningApex' || draft.openingApexSelectionPlayerId !== playerId) return;
      const player = draft.players[playerId];
      const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId && c.type === 'Apex');
      if (idx === -1) return;
      const [apex] = player.hand.splice(idx, 1);
      player.apexSlots[0] = apex;
      const def = getCardDef(apex.defId) as ApexDef;
      if (def.onEnterPlay) {
        def.onEnterPlay({ helpers: createHelpers(draft), ownerId: playerId, apexInstanceId: apex.instanceId });
      }
      logMsg(draft, `${playerId} opens with ${def.name}.`, 'play');

      if (playerId === 'player1') {
        draft.openingApexSelectionPlayerId = 'player2';
        return;
      }

      const p1Apex = draft.players.player1.apexSlots[0]!;
      const p2Apex = draft.players.player2.apexSlots[0]!;
      const p1Def = getCardDef(p1Apex.defId) as ApexDef;
      const p2Def = getCardDef(p2Apex.defId) as ApexDef;
      const p1Zero = p1Def.attacks.find((a) => a.syncCost === 0)?.baseDamage ?? 0;
      const p2Zero = p2Def.attacks.find((a) => a.syncCost === 0)?.baseDamage ?? 0;

      let first: PlayerId;
      if (p1Zero < p2Zero) first = 'player1';
      else if (p2Zero < p1Zero) first = 'player2';
      else first = Math.random() < 0.5 ? 'player1' : 'player2';

      draft.firstPlayerId = first;
      draft.activePlayerId = first;
      draft.turnNumber = 1;
      draft.isFirstTurnOverall = true;
      draft.status = 'playing';
      draft.phase = 'Start';
      draft.startPhasePending = true;
      logMsg(
        draft,
        `${first} goes first (0-Sync attack ${first === 'player1' ? p1Zero : p2Zero} vs ${first === 'player1' ? p2Zero : p1Zero}). They cannot attack this first turn.`,
        'info'
      );
    }),

  advancePhase: (phase) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || draft.pendingResponseQueue.length > 0) return;
      const player = draft.players[draft.activePlayerId];

      if (phase === 'Start') {
        if (draft.phase !== 'Start' || !draft.startPhasePending) return;
        runStartPhase(draft);
        return;
      }
      if (phase === 'Main') {
        if (draft.phase !== 'Start' || draft.startPhasePending) return;
        draft.phase = 'Main';
        maybeRunEmergencyApexDraw(draft, draft.activePlayerId);
        logMsg(draft, `${draft.activePlayerId} enters Main Phase.`, 'phase');
        return;
      }
      if (phase === 'Combat') {
        if (draft.phase !== 'Main') return;
        player.availableSync = computeAvailableSync(draft, draft.activePlayerId);
        draft.phase = 'Combat';
        logMsg(draft, `${draft.activePlayerId} enters Combat Phase with ${player.availableSync} Sync available.`, 'phase');
        return;
      }
    }),

  endTurn: () =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || draft.pendingResponseQueue.length > 0) return;
      if (draft.phase !== 'Combat') return;
      draft.phase = 'End';
      runEndPhase(draft);
      advanceToNextTurn(draft);
    }),

  playApexCard: (cardInstanceId, slotIndex) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || draft.phase !== 'Main' || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId);
      if (idx === -1 || player.hand[idx].type !== 'Apex') return;
      const targetSlot = slotIndex ?? player.apexSlots.findIndex((s) => s === null);
      if (targetSlot === -1 || player.apexSlots[targetSlot] !== null) {
        logMsg(draft, 'No empty Apex slot available.', 'info');
        return;
      }
      const [card] = player.hand.splice(idx, 1);
      player.apexSlots[targetSlot] = card;
      player.turnFlags.cardsPlayedThisTurn += 1;
      const def = getCardDef(card.defId) as ApexDef;
      if (def.onEnterPlay) {
        def.onEnterPlay({ helpers: createHelpers(draft), ownerId: playerId, apexInstanceId: card.instanceId });
      }
      logMsg(draft, `${playerId} plays ${def.name} into Apex Slot ${targetSlot + 1}.`, 'play');
    }),

  playSupportCard: (cardInstanceId, slotIndex, chainedApexId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || draft.phase !== 'Main' || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId);
      if (idx === -1) return;
      const card = player.hand[idx];
      if (card.type !== 'AbilitySupport' && card.type !== 'BatterySupport') return;

      if (card.type === 'AbilitySupport') {
        const currentAbilityCount = player.supportSlots.filter((s) => s?.type === 'AbilitySupport').length;
        if (currentAbilityCount >= MAX_ABILITY_SUPPORTS) {
          logMsg(draft, 'Cannot control more than 2 Ability Supports.', 'info');
          return;
        }
        if (!chainedApexId || !player.apexSlots.some((a) => a?.instanceId === chainedApexId)) {
          logMsg(draft, 'Ability Support must be chained to an Apex you control.', 'info');
          return;
        }
      }

      const targetSlot = slotIndex ?? player.supportSlots.findIndex((s) => s === null);
      if (targetSlot === -1 || player.supportSlots[targetSlot] !== null) {
        logMsg(draft, 'No empty Support slot available.', 'info');
        return;
      }

      player.hand.splice(idx, 1);
      card.chainedApexId = card.type === 'AbilitySupport' ? chainedApexId! : null;
      player.supportSlots[targetSlot] = card;
      player.turnFlags.cardsPlayedThisTurn += 1;
      const def = getCardDef(card.defId);
      logMsg(draft, `${playerId} plays ${def.name} into Support Slot ${targetSlot + 1}.`, 'play');
    }),

  playEquipCard: (cardInstanceId, apexInstanceId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || draft.phase !== 'Main' || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId);
      if (idx === -1 || player.hand[idx].type !== 'Equip') return;
      const apex = player.apexSlots.find((a) => a?.instanceId === apexInstanceId);
      if (!apex) {
        logMsg(draft, 'Equip target must be an Apex you control.', 'info');
        return;
      }
      if (apex.equip) {
        logMsg(draft, `${getCardDef(apex.defId).name} already has an Equip attached.`, 'info');
        return;
      }
      const [card] = player.hand.splice(idx, 1);
      player.turnFlags.cardsPlayedThisTurn += 1;
      const def = getCardDef(card.defId);
      const faction = def.faction;

      if (hasEligibleNegate(draft, otherPlayer(playerId), 'Equip', faction)) {
        draft.pendingResponseQueue.push({
          id: newId('negate'),
          stage: 'negateWindow',
          negatingPlayerId: otherPlayer(playerId),
          cardOwnerId: playerId,
          cardInstanceId: card.instanceId,
          cardDefId: card.defId,
          cardType: 'Equip',
          cardFaction: faction,
          continuation: { kind: 'resolveEquip', ownerId: playerId, apexInstanceId },
          pendingCardInstance: card,
        });
        logMsg(draft, `${playerId} plays ${def.name} - awaiting Negate response.`, 'play');
        return;
      }

      apex.equip = card;
      logMsg(draft, `${playerId} equips ${def.name} onto ${getCardDef(apex.defId).name}.`, 'play');
    }),

  playSpecialCard: (cardInstanceId, targetApexInstanceId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || draft.phase !== 'Main' || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId);
      if (idx === -1 || player.hand[idx].type !== 'Special') return;
      const card = player.hand[idx];
      const def = getCardDef(card.defId) as SpecialDef;

      if (def.canPlay && !def.canPlay(playerId, draft)) {
        logMsg(draft, `${def.name} cannot be played right now.`, 'info');
        return;
      }
      if (def.requiresTarget && !targetApexInstanceId) {
        logMsg(draft, `${def.name} requires a target.`, 'info');
        return;
      }
      if (targetApexInstanceId && def.requiresTarget) {
        const hit = findApexAnywhere(draft, targetApexInstanceId);
        if (!hit) return;
        if (def.requiresTarget === 'enemyApex' || def.requiresTarget === 'enemyApexWithChoke') {
          if (hit.ownerId === playerId) return;
          if (def.requiresTarget === 'enemyApexWithChoke' && (hit.apex.counters?.choke ?? 0) === 0) return;
        }
        if (def.requiresTarget === 'ownApex' || def.requiresTarget === 'ownApexWithUpgrade') {
          if (hit.ownerId !== playerId) return;
          if (def.requiresTarget === 'ownApexWithUpgrade' && (hit.apex.counters?.upgrade ?? 0) === 0) return;
        }
      }

      player.hand.splice(idx, 1);
      player.discard.push(card);
      player.turnFlags.cardsPlayedThisTurn += 1;
      player.turnFlags.specialsPlayedThisTurn += 1;
      logMsg(draft, `${playerId} plays ${def.name}.`, 'play');

      const isFirstSpecialThisTurn = player.turnFlags.specialsPlayedThisTurn === 1;
      if (isFirstSpecialThisTurn) {
        for (const apex of player.apexSlots) {
          if (apex && apex.defId === 'nu-static-jack') {
            const helpers = createHelpers(draft);
            helpers.armAttackBonus(apex.instanceId, 100);
            logMsg(draft, 'Static Jack primes +100 damage from its first Special this turn.', 'support');
          }
        }
        if (draft.riftSpace?.id === 'HumanError') {
          draft.pendingResponseQueue.push({ id: newId('he'), stage: 'humanErrorChoice', playerId });
        }
      }

      if (hasEligibleNegate(draft, otherPlayer(playerId), 'Special', def.faction)) {
        draft.pendingResponseQueue.push({
          id: newId('negate'),
          stage: 'negateWindow',
          negatingPlayerId: otherPlayer(playerId),
          cardOwnerId: playerId,
          cardInstanceId: card.instanceId,
          cardDefId: card.defId,
          cardType: 'Special',
          cardFaction: def.faction,
          continuation: { kind: 'resolveSpecial', ownerId: playerId, targetApexInstanceId },
        });
        return;
      }

      def.resolve({ helpers: createHelpers(draft), ownerId: playerId, targetApexInstanceId });
    }),

  reconfigure: (returnInstanceId, playInstanceId, chainedApexId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || draft.phase !== 'Main' || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      if (player.turnFlags.reconfigureUsedThisTurn) {
        logMsg(draft, 'Reconfigure already used this turn.', 'info');
        return;
      }
      const slotIdx = player.supportSlots.findIndex((s) => s?.instanceId === returnInstanceId);
      if (slotIdx === -1) return;
      const returned = player.supportSlots[slotIdx]!;
      player.supportSlots[slotIdx] = null;
      player.hand.push(returned);
      player.turnFlags.reconfigureUsedThisTurn = true;

      const def = getCardDef(returned.defId);
      logMsg(draft, `${playerId} returns ${def.name} to hand (Reconfigure).`, 'support');

      if (def.type === 'BatterySupport' && def.onReconfigureDiscard) {
        def.onReconfigureDiscard({ helpers: createHelpers(draft), ownerId: playerId, cardInstanceId: returned.instanceId });
      }

      if (!playInstanceId) return;

      const handIdx = player.hand.findIndex((c) => c.instanceId === playInstanceId);
      if (handIdx === -1) return;
      const toPlay = player.hand[handIdx];
      if (toPlay.type !== 'AbilitySupport' && toPlay.type !== 'BatterySupport') return;

      if (toPlay.type === 'AbilitySupport') {
        const abilityCount = player.supportSlots.filter((s) => s?.type === 'AbilitySupport').length;
        if (abilityCount >= MAX_ABILITY_SUPPORTS) {
          logMsg(draft, 'Cannot control more than 2 Ability Supports - Reconfigure play skipped.', 'info');
          return;
        }
        if (!chainedApexId || !player.apexSlots.some((a) => a?.instanceId === chainedApexId)) {
          logMsg(draft, 'Ability Support must be chained to an Apex you control.', 'info');
          return;
        }
      }

      player.hand.splice(handIdx, 1);
      toPlay.chainedApexId = toPlay.type === 'AbilitySupport' ? chainedApexId! : null;
      toPlay.enteredViaReconfigureTurn = draft.turnNumber;
      player.supportSlots[slotIdx] = toPlay;
      logMsg(draft, `${playerId} plays ${getCardDef(toPlay.defId).name} via Reconfigure (Sync Ability locked this turn).`, 'support');
    }),

  lockSupportControlConflict: (supportInstanceId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || draft.riftSpace?.id !== 'ControlConflict') return;
      if (draft.phase !== 'Start' || draft.startPhasePending) return;
      const player = draft.players[draft.activePlayerId];
      if (player.lockedSupportInstanceId) return;
      const support = player.supportSlots.find((s) => s?.instanceId === supportInstanceId);
      if (!support) return;
      support.lockedByControlConflict = true;
      player.lockedSupportInstanceId = support.instanceId;
      logMsg(draft, `${draft.activePlayerId} locks ${getCardDef(support.defId).name} (Control Conflict).`, 'rift');
    }),

  declareAttack: (attackerInstanceId, attackId, targetInstanceId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || draft.phase !== 'Combat' || draft.pendingResponseQueue.length > 0) return;
      if (draft.isFirstTurnOverall) {
        logMsg(draft, 'The first player cannot attack on their very first turn.', 'info');
        return;
      }
      const hit = findApexAnywhere(draft, attackerInstanceId);
      if (!hit || hit.ownerId !== draft.activePlayerId) return;
      const apex = hit.apex;
      if (apex.hasAttacked) {
        logMsg(draft, 'That Apex has already attacked this turn.', 'info');
        return;
      }
      if (apex.attackLockedForTurn === draft.turnNumber) {
        logMsg(draft, 'That Apex is attack-locked this turn.', 'info');
        return;
      }
      const apexDef = getCardDef(apex.defId) as ApexDef;
      const attackDef = apexDef.attacks.find((a) => a.id === attackId);
      if (!attackDef) return;

      const player = draft.players[draft.activePlayerId];
      if (player.availableSync < attackDef.syncCost) {
        logMsg(draft, 'Not enough Sync available for that attack.', 'info');
        return;
      }

      const opponentId = otherPlayer(draft.activePlayerId);
      const opponent = draft.players[opponentId];
      const opponentHasApex = opponent.apexSlots.some(Boolean);
      if (opponentHasApex && !targetInstanceId) {
        logMsg(draft, 'You must choose an enemy Apex to target.', 'info');
        return;
      }
      if (!opponentHasApex && targetInstanceId) {
        logMsg(draft, 'Opponent has no Apex in play - this must be a direct O2 attack.', 'info');
        return;
      }
      if (targetInstanceId) {
        const targetHit = findApexAnywhere(draft, targetInstanceId);
        if (!targetHit || targetHit.ownerId !== opponentId) return;
      }

      player.availableSync -= attackDef.syncCost;
      apex.hasAttacked = true;
      logMsg(draft, `${draft.activePlayerId}'s ${apexDef.name} uses ${attackDef.name} (${attackDef.syncCost} Sync).`, 'attack');

      const helpers = createHelpers(draft);
      const baseCtx = {
        helpers,
        ownerId: draft.activePlayerId,
        attackerInstanceId,
        targetInstanceId,
        syncCost: attackDef.syncCost,
        baseDamage: attackDef.baseDamage,
      };

      if (targetInstanceId) {
        const target = findApexAnywhere(draft, targetInstanceId)?.apex;
        if (target && (target.counters?.choke ?? 0) > 0 && apexDef.onAttackTargetWithChoke) {
          apexDef.onAttackTargetWithChoke(baseCtx);
        }
      }

      let total = attackDef.baseDamage;
      if (attackDef.bonusDamage) total += attackDef.bonusDamage(baseCtx);
      if (apexDef.passiveDamageBonus) total += apexDef.passiveDamageBonus(baseCtx);
      if (apex.equip) {
        const eqDef = getCardDef(apex.equip.defId);
        if (eqDef.type === 'Equip' && eqDef.damageBonus) total += eqDef.damageBonus(baseCtx);
      }
      if (apex.armedBonus) {
        total += apex.armedBonus;
        logMsg(draft, `Armed bonus adds +${apex.armedBonus} damage.`, 'attack');
        apex.armedBonus = 0;
      }
      if (player.pendingAttackBonus) {
        total += player.pendingAttackBonus;
        logMsg(draft, `Primed bonus adds +${player.pendingAttackBonus} damage.`, 'attack');
        player.pendingAttackBonus = 0;
      }
      if (player.pendingTargetedAttackBonus && player.pendingTargetedAttackBonus.targetInstanceId === targetInstanceId) {
        total += player.pendingTargetedAttackBonus.amount;
        player.pendingTargetedAttackBonus = null;
      }

      const trigger: AttackTriggerData = {
        kind: 'enemyApexAttacks',
        attackerId: draft.activePlayerId,
        attackerInstanceId,
        attackDefId: attackId,
        targetInstanceId,
        syncCost: attackDef.syncCost,
        totalDamage: total,
        cannotBeRedirected: attackDef.cannotBeRedirected,
      };

      if (!attackDef.cannotBeRedirected && hasEligibleReaction(draft, opponentId, 'enemyApexAttacks')) {
        draft.pendingResponseQueue.push({
          id: newId('rx'),
          stage: 'reactionChoice',
          respondingPlayerId: opponentId,
          trigger,
        });
        logMsg(draft, `${opponentId} may respond with a Reaction.`, 'response');
        return;
      }

      resolveAttackAgainstTarget(draft, trigger, total);
    }),

  resolveResponse: (choice) =>
    mutate(set, (draft) => {
      const item = draft.pendingResponseQueue[0];
      if (!item) return;
      draft.pendingResponseQueue.shift();
      const helpers = createHelpers(draft);

      if (item.stage === 'reactionChoice') {
        const trigger = item.trigger;

        if (choice.type === 'reaction') {
          const player = draft.players[item.respondingPlayerId];
          const idx = player.hand.findIndex((c) => c.instanceId === choice.cardInstanceId);
          if (idx === -1) {
            continueTriggerUnmodified(draft, trigger);
            return;
          }
          const cardInstance = player.hand[idx];
          const reactionDef = getCardDef(cardInstance.defId) as ReactionDef;
          if (reactionDef.type !== 'Reaction' || reactionDef.trigger !== trigger.kind || player.momentum < reactionDef.cost) {
            continueTriggerUnmodified(draft, trigger);
            return;
          }
          player.hand.splice(idx, 1);
          player.discard.push(cardInstance);
          loseMomentumFn(draft, item.respondingPlayerId, reactionDef.cost);
          logMsg(draft, `${item.respondingPlayerId} plays ${reactionDef.name} in response.`, 'response');

          if (trigger.kind === 'enemyApexAttacks') {
            const attackerHit = findApexAnywhere(draft, trigger.attackerInstanceId);
            if (attackerHit && attackerHit.apex.defId === 'nu-alley-wraith' && !attackerHit.apex.traitUsedThisTurn) {
              const attackerPlayer = draft.players[trigger.attackerId];
              if (attackerPlayer.momentum >= 1) {
                draft.pendingResponseQueue.unshift({
                  id: newId('aw'),
                  stage: 'alleyWraithChoice',
                  attackerId: trigger.attackerId,
                  attackerInstanceId: trigger.attackerInstanceId,
                  reactionDefId: reactionDef.id,
                  reactionOwnerId: item.respondingPlayerId,
                  trigger,
                });
                return;
              }
            }
          }

          applyChosenReactionAndContinue(draft, trigger, reactionDef, item.respondingPlayerId);
          return;
        }

        continueTriggerUnmodified(draft, trigger);
        return;
      }

      if (item.stage === 'alleyWraithChoice') {
        if (choice.type === 'alleyWraithCancel') {
          const attackerHit = findApexAnywhere(draft, item.attackerInstanceId);
          if (attackerHit) attackerHit.apex.traitUsedThisTurn = true;
          loseMomentumFn(draft, item.attackerId, 1);
          logMsg(draft, `Alley Wraith pays 1 Momentum to cancel the Reaction!`, 'response');
          continueTriggerUnmodified(draft, item.trigger);
        } else {
          const reactionDef = getCardDef(item.reactionDefId) as ReactionDef;
          applyChosenReactionAndContinue(draft, item.trigger, reactionDef, item.reactionOwnerId);
        }
        return;
      }

      if (item.stage === 'negateWindow') {
        if (choice.type === 'negate') {
          const player = draft.players[item.negatingPlayerId];
          const idx = player.hand.findIndex((c) => c.instanceId === choice.cardInstanceId);
          const negateInstance = idx !== -1 ? player.hand[idx] : undefined;
          const negateDef = negateInstance ? (getCardDef(negateInstance.defId) as NegateDef) : undefined;

          if (
            negateInstance &&
            negateDef &&
            negateDef.type === 'Negate' &&
            player.momentum >= negateDef.cost &&
            negateDef.canCancel(item.cardType, item.cardFaction)
          ) {
            player.hand.splice(idx, 1);
            player.discard.push(negateInstance);
            loseMomentumFn(draft, item.negatingPlayerId, negateDef.cost);
            logMsg(draft, `${item.negatingPlayerId} plays ${negateDef.name}, cancelling ${item.cardDefId}!`, 'response');
            negateDef.resolve({
              helpers,
              ownerId: item.negatingPlayerId,
              cancelledCardInstanceId: item.cardInstanceId,
              cancelledFaction: item.cardFaction,
            });
            if (item.cardType === 'Equip' && item.pendingCardInstance) {
              draft.players[item.cardOwnerId].discard.push(item.pendingCardInstance);
            }
            return;
          }
        }

        if (item.continuation.kind === 'resolveSpecial') {
          const def = getCardDef(item.cardDefId) as SpecialDef;
          def.resolve({
            helpers,
            ownerId: item.continuation.ownerId,
            targetApexInstanceId: item.continuation.targetApexInstanceId,
          });
        } else if (item.continuation.kind === 'resolveEquip' && item.pendingCardInstance) {
          const hit = findApexAnywhere(draft, item.continuation.apexInstanceId);
          if (hit) {
            hit.apex.equip = item.pendingCardInstance;
            logMsg(draft, `${getCardDef(item.pendingCardInstance.defId).name} attaches to ${getCardDef(hit.apex.defId).name}.`, 'play');
          }
        }
        return;
      }

      if (item.stage === 'humanErrorChoice') {
        if (choice.type === 'humanError' && choice.pick === 'momentum') {
          gainMomentumFn(draft, item.playerId, 1);
        } else {
          draft.players[item.playerId].pendingAttackBonus += 100;
          logMsg(draft, `${item.playerId} primes their next attack this turn for +100 damage (Human Error).`, 'rift');
        }
        return;
      }
    }),

  resetToMenu: () => mutate(set, (draft) => Object.assign(draft, initialState())),
}));

export type { GameStore };
