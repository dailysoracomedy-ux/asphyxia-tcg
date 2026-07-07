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
  PlayedCardEventData,
  PlayerId,
  PlayerState,
  ReactionDef,
  ResponseEvent,
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
  overflowToO2Loss,
  drawCardsFn,
  findApexAnywhere,
  getEffectiveDef,
  getEligibleResponses,
  getPreviewAttackDamage,
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
  | { type: 'civilWar'; pick: 'momentum' | 'damage' };

function freshPlayer(id: PlayerId, faction: Faction): PlayerState {
  return {
    id,
    faction,
    deck: [],
    hand: [],
    voidZone: [],
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
    debugMode: false,
    gameOverReason: null,
  };
}

// ==========================================================================
// Helper predicates
// ==========================================================================

// ==========================================================================
// Response-window eligibility (Engine Tag System)
//
// All eligibility checks funnel through getEligibleResponses (rules.ts), which
// looks only at each card's engine tags (INSTANT + the matching ON_* trigger
// tag) plus Momentum/target legality - never card names or ad-hoc type checks.
// ==========================================================================

/** Checks eligibility for a response event. Only logs the "none found" debug trail when
 *  debugMode is on - in normal play this check happens on nearly every attack/play and
 *  would otherwise spam the log with lines that mean nothing to a player. */
function checkEligibleResponses(draft: GameState, respondingPlayerId: PlayerId, event: ResponseEvent): CardInstance[] {
  const eligible = getEligibleResponses(draft, respondingPlayerId, event);
  if (eligible.length === 0 && draft.debugMode) {
    logMsg(draft, 'Checked for eligible responses: none found.', 'response');
  }
  return eligible;
}

/** Opens a Response Window (pushing to the queue) only if eligible responses exist.
 *  Returns true if a window was opened (caller should stop and wait), false otherwise. */
function maybeOpenResponseWindow(
  draft: GameState,
  respondingPlayerId: PlayerId,
  event: ResponseEvent,
  pushItem: (eligibleCount: number) => void
): boolean {
  const eligible = checkEligibleResponses(draft, respondingPlayerId, event);
  if (eligible.length === 0) return false;
  pushItem(eligible.length);
  logMsg(draft, `Response window opened for ${respondingPlayerId}.`, 'response');
  return true;
}

function playedCardEvent(
  kind: 'SPECIAL_PLAYED' | 'EQUIP_PLAYED' | 'REACTION_PLAYED',
  data: PlayedCardEventData
): ResponseEvent {
  return { kind, data } as ResponseEvent;
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
          draft.pendingResponseQueue.push({ id: newId('cw'), stage: 'civilWarChoice', playerId });
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
    if (apex.attackLockedForTurn !== null && apex.attackLockedForTurn !== undefined && apex.attackLockedForTurn < draft.turnNumber) {
      apex.attackLockedForTurn = null;
    }
  }

  player.turnFlags = freshTurnFlags();
  player.availableSync = 0;

  draft.startPhasePending = false;
}

function maybeTriggerHumanErrorChoice(draft: GameState, playerId: PlayerId) {
  // Human Error rift: only offered when a Special actually resolves - i.e. after any
  // negate window has already been checked/resolved and the Special was NOT negated.
  // Called from both the "no negate window opened" path and the "negate window
  // resolved with a pass" path, so a negated Special never reaches this at all.
  if (draft.riftSpace?.id !== 'HumanError') return;
  const player = draft.players[playerId];
  if (player.turnFlags.specialsPlayedThisTurn !== 1) return;
  draft.pendingResponseQueue.push({ id: newId('he'), stage: 'humanErrorChoice', playerId });
}

function maybeTriggerRecursiveFailureSecondCard(draft: GameState, playerId: PlayerId) {
  if (draft.riftSpace?.id !== 'RecursiveFailure') return;
  const player = draft.players[playerId];
  if (player.turnFlags.cardsPlayedThisTurn !== 2) return;
  if (player.turnFlags.recursiveGlitchPlacedThisTurn) return;
  player.turnFlags.recursiveGlitchPlacedThisTurn = true;
  gainMomentumFn(draft, playerId, 1);
  const targetApex = player.apexSlots.find(Boolean);
  if (targetApex) {
    addCounterFn(draft, targetApex.instanceId, 'glitch', 1, playerId);
    logMsg(draft, `Recursive Failure places 1 Glitch Counter on ${getCardDef(targetApex.defId).name}.`, 'rift');
  } else {
    logMsg(draft, `Recursive Failure would place a Glitch Counter, but ${playerId} controls no Apex.`, 'rift');
  }
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

  if (draft.riftSpace?.id === 'WhiteRoomCollapse') {
    for (const pid of ['player1', 'player2'] as const) {
      for (const apex of draft.players[pid].apexSlots) {
        if (apex && (apex.counters?.choke ?? 0) >= 3) {
          apex.counters!.choke -= 1;
          logMsg(draft, `White Room Collapse removes 1 Choke Counter from ${getCardDef(apex.defId).name}.`, 'rift');
        }
      }
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

export function searchPileForApex(pile: CardInstance[]): { apex: CardInstance | null; remainder: CardInstance[] } {
  const remainder: CardInstance[] = [];
  let apex: CardInstance | null = null;
  for (const card of pile) {
    if (!apex && card.type === 'Apex') {
      apex = card;
    } else {
      remainder.push(card);
    }
  }
  return { apex, remainder: shuffle(remainder) };
}

/** No-Apex Recovery Rule: if the active player controls zero Apexes at the start of their
 *  Main Phase, force-recover one from hand, then deck, then voidZone (reshuffled in), or
 *  else they lose - this is a safety valve against a permanent no-board death spiral. */
export function maybeRunEmergencyApexDraw(draft: GameState, playerId: PlayerId) {
  const player = draft.players[playerId];
  if (player.apexSlots.some(Boolean)) return; // still controls at least one Apex - nothing to do

  // Step 1: an Apex in hand must be force-played.
  const handApexIdx = player.hand.findIndex((c) => c.type === 'Apex');
  if (handApexIdx !== -1) {
    const [found] = player.hand.splice(handApexIdx, 1);
    player.apexSlots[0] = found;
    const def = getCardDef(found.defId) as ApexDef;
    if (def.onEnterPlay) def.onEnterPlay({ helpers: createHelpers(draft), ownerId: playerId, apexInstanceId: found.instanceId });
    logMsg(draft, `${playerId} controls no Apex - forced to play ${def.name} from hand into Apex Slot 1.`, 'info');
    return;
  }

  // Step 2: reveal from the Deck until an Apex turns up; everything else is shuffled back in.
  logMsg(draft, `${playerId} controls no Apex and has none in hand - revealing from the Deck.`, 'info');
  let result = searchPileForApex(player.deck);
  player.deck = result.remainder;

  // Step 3: Deck exhausted with no Apex found - Void Recycle, then continue the search.
  if (!result.apex) {
    const voidHasApex = player.voidZone.some((c) => c.type === 'Apex');
    if (voidHasApex) {
      logMsg(draft, `${playerId} has no Apex in hand or Deck.`, 'info');
      logMsg(draft, `Void Recycle: ${playerId} shuffles their Void into their Deck.`, 'rift');
      const combined = shuffle([...player.deck, ...player.voidZone]);
      player.voidZone = [];
      result = searchPileForApex(combined);
      player.deck = result.remainder;
    }
  }

  if (result.apex) {
    player.apexSlots[0] = result.apex;
    const def = getCardDef(result.apex.defId) as ApexDef;
    if (def.onEnterPlay) def.onEnterPlay({ helpers: createHelpers(draft), ownerId: playerId, apexInstanceId: result.apex.instanceId });
    logMsg(draft, `${playerId} finds ${def.name} and plays it into Apex Slot 1.`, 'play');
    return;
  }

  // Step 4: no Apex in hand, Deck, or Void - safety-valve loss.
  draft.status = 'gameover';
  draft.winnerId = otherPlayer(playerId);
  draft.gameOverReason = `${playerId} has no Apex remaining anywhere and loses.`;
  logMsg(draft, `${playerId} has no Apex in hand, Deck, or Void and loses.`, 'win');
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

  const o2Loss = overflowToO2Loss(overflow);
  if (o2Loss > 0) {
    resolveO2LossWindow(draft, {
      kind: 'opponentAttackDealsO2Damage',
      attackerId: trigger.attackerId,
      defenderId: otherPlayer(trigger.attackerId),
      amount: o2Loss,
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
      logMsg(draft, `${targetDef.name} defends with ${effectiveDef} DEF and survives ${dmg} damage.`, 'damage');
      finalizeAttackEffects(draft, trigger, false, false);
      return;
    }

    let overflow = dmg - effectiveDef;
    if (targetHit.apex.equip) {
      const eqDef = getCardDef(targetHit.apex.equip.defId);
      if (eqDef.type === 'Equip' && eqDef.onOverflowDamage) {
        const reduced = eqDef.onOverflowDamage(overflow);
        if (reduced !== overflow) {
          logMsg(draft, `${eqDef.name} reduces the overflow from ${overflow} to ${reduced}.`, 'damage');
        }
        overflow = reduced;
      }
    }

    const destroyTrigger: DestroyTriggerData = {
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
    };
    logMsg(
      draft,
      `${targetDef.name} defends with ${effectiveDef} DEF but is destroyed by ${dmg} damage${
        overflow > 0 ? ` (${overflow} overflow)` : ''
      }.`,
      'damage'
    );
    const opened = maybeOpenResponseWindow(
      draft,
      defenderId,
      { kind: 'APEX_WOULD_BE_DESTROYED', data: destroyTrigger },
      () => {
        draft.pendingResponseQueue.push({
          id: newId('rx'),
          stage: 'reactionChoice',
          respondingPlayerId: defenderId,
          trigger: destroyTrigger,
        });
      }
    );
    if (opened) return;

    proceedWithDestruction(draft, trigger, overflow);
    return;
  }

  const rawLoss = directDamageToO2Loss(damage);
  const attackerPlayer = draft.players[trigger.attackerId];
  const remainingCap = Math.max(0, DIRECT_O2_CAP_PER_TURN - attackerPlayer.turnFlags.directO2LossThisTurn);
  const cappedLoss = Math.min(rawLoss, remainingCap);

  if (cappedLoss <= 0) {
    logMsg(
      draft,
      `${apexDef.name} attacks ${defenderId}'s O2 directly for ${damage} damage (would cost ${rawLoss} O2), but the 2-per-turn direct O2 cap is already spent - 0 O2 lost.`,
      'damage'
    );
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
  logMsg(
    draft,
    `${o2trigger.isOverflow ? 'Overflow damage' : 'Direct attack'} would deal ${o2trigger.amount} O2 loss to ${o2trigger.defenderId}.`,
    'o2'
  );
  const opened = maybeOpenResponseWindow(
    draft,
    o2trigger.defenderId,
    { kind: 'O2_DAMAGE_PENDING', data: o2trigger },
    () => {
      draft.pendingResponseQueue.push({
        id: newId('rx'),
        stage: 'reactionChoice',
        respondingPlayerId: o2trigger.defenderId,
        trigger: o2trigger,
      });
    }
  );
  if (opened) return;
  applyO2LossFinal(draft, o2trigger, 0);
}

function applyO2LossFinal(draft: GameState, o2trigger: O2DamageTriggerData, reduction: number) {
  const finalAmount = Math.max(0, o2trigger.amount - reduction);
  const helpers = createHelpers(draft);
  if (reduction > 0) {
    logMsg(draft, `O2 loss reduced by ${reduction} (from ${o2trigger.amount} to ${finalAmount}).`, 'o2');
  }
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
  finalizeAttackEffects(draft, trigger, o2trigger.destroyedTarget, finalAmount > 0, o2trigger.isOverflow);
}

function finishDestroyDecision(draft: GameState, trigger: DestroyTriggerData, prevented: boolean, survivorDef = 100) {
  const apexHit = findApexAnywhere(draft, trigger.apexInstanceId);
  const helpers = createHelpers(draft);

  if (prevented && apexHit) {
    apexHit.apex.survivorDefOverride = survivorDef;
    logMsg(draft, `${getCardDef(apexHit.apex.defId).name} survives at ${survivorDef} DEF (Backup Consciousness)!`, 'response');
    const owner = draft.players[trigger.ownerId];
    if (owner.o2 <= 4) {
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
  dealtO2Damage: boolean,
  hadOverflowDamage: boolean = dealtO2Damage
) {
  // If this attack's O2 loss (applied just before this function runs) already ended the
  // game, stop here: no further onResolve/Overclock/Sync Ability/Apex Break Reward
  // triggers should fire once a winner has been declared (e.g. Oxygen Siphon should not
  // heal O2 back for the winner after the loser has already hit 0).
  const gameAlreadyOver = draft.status === 'gameover';

  if (!gameAlreadyOver) {
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
        if (supportDef.chainedAttackBonus) continue; // already applied live during damage calculation
        supportDef.syncAbility({ ...ctx, chainedApexId: trigger.attackerInstanceId });
        if (support.defId === 'sa-drone-choir' && apexDef.faction === 'Synth Ascendancy') {
          helpers.armAttackBonus(trigger.attackerInstanceId, 100);
        }
        logMsg(draft, `${supportDef.name}'s Sync Ability triggers.`, 'support');
      }
    }

    // Apex Break Reward: destroying an enemy Apex with an attack that had exactly 0
    // overflow damage (a "clean break") rewards the attacker with 1 Momentum. This
    // function is only ever called as the terminal step of the attack-resolution
    // pipeline, so this naturally excludes direct attacks (destroyedTarget is always
    // false for those), non-attack destruction effects (they never route through here),
    // and destructions that were prevented (Backup Consciousness passes destroyedTarget=false).
    //
    // Uses hadOverflowDamage (the mechanical fact that overflow occurred), not
    // dealtO2Damage (the final post-reduction amount) - if a Reaction like Emergency
    // Authority absorbs the overflow's O2 loss all the way down to 0, that still isn't a
    // clean break: overflow damage genuinely happened, a Reaction just prevented its cost.
    if (destroyedTarget && trigger.targetInstanceId) {
      if (!dealtO2Damage) {
        logMsg(draft, 'No O2 damage was dealt.', 'o2');
      }
      if (!hadOverflowDamage) {
        const opponentId = otherPlayer(trigger.attackerId);
        const echoRiotBoost =
          draft.riftSpace?.id === 'EchoRiot' && draft.players[trigger.attackerId].o2 <= 6 && draft.players[opponentId].o2 <= 6;
        const rewardAmount = echoRiotBoost ? 2 : 1;
        helpers.gainMomentum(trigger.attackerId, rewardAmount);
        if (echoRiotBoost) {
          logMsg(draft, `Echo Riot increases Apex Break Reward to +2 Momentum for ${trigger.attackerId}.`, 'rift');
        } else {
          logMsg(draft, `${trigger.attackerId} gains 1 Momentum from Apex Break Reward.`, 'momentum');
        }
      } else if (!dealtO2Damage) {
        logMsg(draft, 'Apex Break Reward does not trigger - overflow damage was prevented by a Reaction.', 'momentum');
      }
    }

    // Civil War rift: once per turn, destroying an enemy Apex while behind on O2 arms
    // +100 damage for the attacker's next attack this turn.
    if (destroyedTarget && draft.riftSpace?.id === 'CivilWar') {
      const attackerPlayer = draft.players[trigger.attackerId];
      if (!attackerPlayer.turnFlags.civilWarBonusArmedThisTurn) {
        const opponentId = otherPlayer(trigger.attackerId);
        if (attackerPlayer.o2 < draft.players[opponentId].o2) {
          attackerPlayer.turnFlags.civilWarBonusArmedThisTurn = true;
          attackerPlayer.pendingAttackBonus += 100;
          logMsg(draft, `Civil War arms +100 damage for ${trigger.attackerId}'s next attack this turn.`, 'rift');
        }
      }
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
    if (reduction > 0) {
      logMsg(draft, `${reactionDef.name} reduces the attack by ${reduction} (now ${newDamage} damage).`, 'response');
    }
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
      if (defender.o2 <= 4) {
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

/** Logs "Action resolved." only once a response-window-driven trigger chain has truly
 *  terminated (i.e. it didn't just open another nested window, such as a Negate-the-Reaction
 *  layer or Alley Wraith's follow-up prompt). */
function maybeLogActionResolved(draft: GameState) {
  if (draft.pendingResponseQueue.length === 0) {
    logMsg(draft, 'Action resolved.', 'response');
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
  chainSupport: (supportInstanceId: string, apexInstanceId: string) => void;
  declareAttack: (attackerInstanceId: string, attackId: string, targetInstanceId?: string) => void;
  resolveResponse: (choice: ResponseChoice) => void;
  lockSupportControlConflict: (supportInstanceId: string) => void;
  resetToMenu: () => void;
  toggleDebugMode: () => void;
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
        const statusAfterRecovery = draft.status as GameState['status'];
        if (statusAfterRecovery === 'gameover') return;
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
      maybeTriggerRecursiveFailureSecondCard(draft, playerId);
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

      if (player.turnFlags.supportsPlayedThisTurn >= 1) {
        logMsg(draft, `${playerId} has already played a Support this turn.`, 'info');
        return;
      }

      if (card.type === 'AbilitySupport') {
        const currentAbilityCount = player.supportSlots.filter((s) => s?.type === 'AbilitySupport').length;
        if (currentAbilityCount >= MAX_ABILITY_SUPPORTS) {
          logMsg(draft, 'Cannot control more than 2 Ability Supports.', 'info');
          return;
        }
        // Chaining is now optional: an Ability Support can be played unchained/vanilla as a
        // pure +1 Sync source (e.g. no legal chain target, or the player simply doesn't want
        // to commit it yet). Only validate the target if one was actually provided.
        if (chainedApexId) {
          if (!player.apexSlots.some((a) => a?.instanceId === chainedApexId)) {
            logMsg(draft, 'Ability Support must be chained to an Apex you control.', 'info');
            return;
          }
          if (player.supportSlots.some((s) => s?.type === 'AbilitySupport' && s.chainedApexId === chainedApexId)) {
            logMsg(draft, 'That Apex already has an Ability Support chained to it.', 'info');
            return;
          }
        }
      }

      const targetSlot = slotIndex ?? player.supportSlots.findIndex((s) => s === null);
      if (targetSlot === -1 || player.supportSlots[targetSlot] !== null) {
        logMsg(draft, 'No empty Support slot available.', 'info');
        return;
      }

      player.hand.splice(idx, 1);
      card.chainedApexId = card.type === 'AbilitySupport' ? chainedApexId ?? null : null;
      player.supportSlots[targetSlot] = card;
      player.turnFlags.cardsPlayedThisTurn += 1;
      player.turnFlags.supportsPlayedThisTurn += 1;
      const def = getCardDef(card.defId);
      const chainSuffix = card.type === 'AbilitySupport' ? (card.chainedApexId ? ' (chained)' : ' (unchained)') : '';
      logMsg(draft, `${playerId} plays ${def.name} into Support Slot ${targetSlot + 1}${chainSuffix}.`, 'play');
      maybeTriggerRecursiveFailureSecondCard(draft, playerId);
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
      const negatingPlayerId = otherPlayer(playerId);

      logMsg(draft, `${playerId} plays ${def.name}.`, 'play');
      maybeTriggerRecursiveFailureSecondCard(draft, playerId);
      const opened = maybeOpenResponseWindow(
        draft,
        negatingPlayerId,
        playedCardEvent('EQUIP_PLAYED', { cardType: 'Equip', cardFaction: faction, cardOwnerId: playerId, cardInstanceId: card.instanceId }),
        () => {
          draft.pendingResponseQueue.push({
            id: newId('negate'),
            stage: 'negateWindow',
            negatingPlayerId,
            cardOwnerId: playerId,
            cardInstanceId: card.instanceId,
            cardDefId: card.defId,
            cardType: 'Equip',
            cardFaction: faction,
            continuation: { kind: 'resolveEquip', ownerId: playerId, apexInstanceId },
            pendingCardInstance: card,
          });
        }
      );
      if (opened) return;

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

      if (player.turnFlags.specialsPlayedThisTurn >= 1) {
        logMsg(draft, `${playerId} has already played a Special this turn.`, 'info');
        return;
      }

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
      player.voidZone.push(card);
      player.turnFlags.cardsPlayedThisTurn += 1;
      player.turnFlags.specialsPlayedThisTurn += 1;
      logMsg(draft, `${playerId} plays ${def.name}.`, 'play');
      maybeTriggerRecursiveFailureSecondCard(draft, playerId);

      const negatingPlayerId = otherPlayer(playerId);
      const opened = maybeOpenResponseWindow(
        draft,
        negatingPlayerId,
        playedCardEvent('SPECIAL_PLAYED', {
          cardType: 'Special',
          cardFaction: def.faction,
          cardOwnerId: playerId,
          cardInstanceId: card.instanceId,
        }),
        () => {
          draft.pendingResponseQueue.push({
            id: newId('negate'),
            stage: 'negateWindow',
            negatingPlayerId,
            cardOwnerId: playerId,
            cardInstanceId: card.instanceId,
            cardDefId: card.defId,
            cardType: 'Special',
            cardFaction: def.faction,
            continuation: { kind: 'resolveSpecial', ownerId: playerId, targetApexInstanceId },
          });
        }
      );
      if (opened) return;

      def.resolve({ helpers: createHelpers(draft), ownerId: playerId, targetApexInstanceId });
      maybeTriggerHumanErrorChoice(draft, playerId);
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
      if (returned.lockedByControlConflict) {
        logMsg(draft, `${getCardDef(returned.defId).name} is locked by Control Conflict and cannot be Reconfigured.`, 'info');
        return;
      }
      player.supportSlots[slotIdx] = null;
      player.hand.push(returned);
      player.turnFlags.reconfigureUsedThisTurn = true;

      const def = getCardDef(returned.defId);
      logMsg(draft, `${playerId} returns ${def.name} to hand (Reconfigure).`, 'support');

      if (def.type === 'BatterySupport' && def.onReconfigureReturn) {
        def.onReconfigureReturn({ helpers: createHelpers(draft), ownerId: playerId, cardInstanceId: returned.instanceId });
      }

      if (!playInstanceId) return;

      if (player.turnFlags.supportsPlayedThisTurn >= 1) {
        logMsg(draft, `${playerId} has already played a Support this turn - Reconfigure play skipped.`, 'info');
        return;
      }

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
        if (chainedApexId) {
          if (!player.apexSlots.some((a) => a?.instanceId === chainedApexId)) {
            logMsg(draft, 'Ability Support must be chained to an Apex you control.', 'info');
            return;
          }
          if (player.supportSlots.some((s) => s?.type === 'AbilitySupport' && s.chainedApexId === chainedApexId)) {
            logMsg(draft, 'That Apex already has an Ability Support chained to it.', 'info');
            return;
          }
        }
      }

      player.hand.splice(handIdx, 1);
      toPlay.chainedApexId = toPlay.type === 'AbilitySupport' ? chainedApexId ?? null : null;
      toPlay.enteredViaReconfigureTurn = draft.turnNumber;
      player.supportSlots[slotIdx] = toPlay;
      player.turnFlags.supportsPlayedThisTurn += 1;
      const chainSuffix = toPlay.type === 'AbilitySupport' ? (toPlay.chainedApexId ? ' (chained)' : ' (unchained)') : '';
      logMsg(draft, `${playerId} plays ${getCardDef(toPlay.defId).name} via Reconfigure${chainSuffix} (Sync Ability locked this turn).`, 'support');
    }),

  chainSupport: (supportInstanceId, apexInstanceId) =>
    mutate(set, (draft) => {
      // Free, optional (re)assignment of an already-unchained Ability Support to an eligible
      // Apex during Main Phase. Does not count as playing a new Support and does not touch
      // Reconfigure - it's purely fixing up an existing card already on the board.
      if (draft.status !== 'playing' || draft.phase !== 'Main' || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      const support = player.supportSlots.find((s) => s?.instanceId === supportInstanceId);
      if (!support || support.type !== 'AbilitySupport') return;
      if (support.chainedApexId) {
        logMsg(draft, `${getCardDef(support.defId).name} is already chained.`, 'info');
        return;
      }
      if (!player.apexSlots.some((a) => a?.instanceId === apexInstanceId)) {
        logMsg(draft, 'You can only chain to an Apex you control.', 'info');
        return;
      }
      if (player.supportSlots.some((s) => s?.type === 'AbilitySupport' && s.chainedApexId === apexInstanceId)) {
        logMsg(draft, 'That Apex already has an Ability Support chained to it.', 'info');
        return;
      }
      support.chainedApexId = apexInstanceId;
      const apexName = getCardDef(player.apexSlots.find((a) => a?.instanceId === apexInstanceId)!.defId).name;
      logMsg(draft, `${playerId} chains ${getCardDef(support.defId).name} to ${apexName}.`, 'support');
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
      logMsg(draft, `Control Conflict: ${draft.activePlayerId} locks ${getCardDef(support.defId).name} and gains 1 Momentum.`, 'rift');
      gainMomentumFn(draft, draft.activePlayerId, 1);
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
      logMsg(
        draft,
        `${apexDef.name} declares ${attackDef.name} (${attackDef.baseDamage} base damage, ${attackDef.syncCost} Sync).`,
        'attack'
      );

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

      // Single source of truth for damage math - the same helper the Combat Phase attack
      // selector uses to preview this exact number before anything is committed.
      const preview = getPreviewAttackDamage(draft, attackerInstanceId, attackId, targetInstanceId)!;
      for (const mod of preview.modifiers) {
        logMsg(
          draft,
          `${apexDef.name} ${mod.amount >= 0 ? 'gains' : 'loses'} ${Math.abs(mod.amount)} attack (${mod.label}).`,
          'attack'
        );
      }
      const total = preview.modifiedDamage;

      // Consume the one-shot bonuses the preview just read (mirrors exactly which ones
      // getPreviewAttackDamage included, so nothing is double-spent or left stale).
      if (apex.armedBonus) apex.armedBonus = 0;
      if (player.pendingAttackBonus) player.pendingAttackBonus = 0;
      if (player.pendingTargetedAttackBonus && targetInstanceId && player.pendingTargetedAttackBonus.targetInstanceId === targetInstanceId) {
        player.pendingTargetedAttackBonus = null;
      }

      const targetLabel = targetInstanceId
        ? getCardDef(findApexAnywhere(draft, targetInstanceId)!.apex.defId).name
        : `${opponentId}'s O2 directly`;
      logMsg(draft, `${apexDef.name} attacks ${targetLabel} for ${total} damage.`, 'attack');

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

      let opened = false;
      if (!attackDef.cannotBeRedirected) {
        opened = maybeOpenResponseWindow(draft, opponentId, { kind: 'ATTACK_DECLARED', data: trigger }, () => {
          draft.pendingResponseQueue.push({
            id: newId('rx'),
            stage: 'reactionChoice',
            respondingPlayerId: opponentId,
            trigger,
          });
        });
      }
      if (opened) return;

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
            logMsg(draft, `${item.respondingPlayerId} passed.`, 'response');
            continueTriggerUnmodified(draft, trigger);
            maybeLogActionResolved(draft);
            return;
          }
          const cardInstance = player.hand[idx];
          const reactionDef = getCardDef(cardInstance.defId) as ReactionDef;
          if (
            reactionDef.type !== 'Reaction' ||
            reactionDef.trigger !== trigger.kind ||
            player.momentum < reactionDef.cost ||
            player.turnFlags.instantsPlayedThisTurn >= 1
          ) {
            logMsg(draft, `${item.respondingPlayerId} passed.`, 'response');
            continueTriggerUnmodified(draft, trigger);
            maybeLogActionResolved(draft);
            return;
          }
          player.hand.splice(idx, 1);
          player.voidZone.push(cardInstance);
          loseMomentumFn(draft, item.respondingPlayerId, reactionDef.cost);
          player.turnFlags.instantsPlayedThisTurn += 1;
          logMsg(draft, `${item.respondingPlayerId} played ${reactionDef.name}.`, 'response');

          // A Negate may itself respond to this Reaction being played (ON_REACTION_PLAYED).
          // Single extra layer only - no arbitrary stacking.
          const negatingPlayerId = otherPlayer(item.respondingPlayerId);
          const negateOpened = maybeOpenResponseWindow(
            draft,
            negatingPlayerId,
            playedCardEvent('REACTION_PLAYED', {
              cardType: 'Reaction',
              cardFaction: reactionDef.faction,
              cardOwnerId: item.respondingPlayerId,
              cardInstanceId: cardInstance.instanceId,
            }),
            () => {
              draft.pendingResponseQueue.push({
                id: newId('negate'),
                stage: 'negateWindow',
                negatingPlayerId,
                cardOwnerId: item.respondingPlayerId,
                cardInstanceId: cardInstance.instanceId,
                cardDefId: reactionDef.id,
                cardType: 'Reaction',
                cardFaction: reactionDef.faction,
                continuation: {
                  kind: 'resolveReactionThenFinishTrigger',
                  reactionOwnerId: item.respondingPlayerId,
                  trigger,
                },
              });
            }
          );
          if (negateOpened) return;

          applyChosenReactionAndContinue(draft, trigger, reactionDef, item.respondingPlayerId);
          maybeLogActionResolved(draft);
          return;
        }

        logMsg(draft, `${item.respondingPlayerId} passed.`, 'response');
        continueTriggerUnmodified(draft, trigger);
        maybeLogActionResolved(draft);
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
            player.turnFlags.instantsPlayedThisTurn < 1 &&
            negateDef.canCancel(item.cardType, item.cardFaction)
          ) {
            player.hand.splice(idx, 1);
            player.voidZone.push(negateInstance);
            loseMomentumFn(draft, item.negatingPlayerId, negateDef.cost);
            player.turnFlags.instantsPlayedThisTurn += 1;
            logMsg(draft, `${item.negatingPlayerId} played ${negateDef.name}.`, 'response');
            logMsg(draft, `${negateDef.name} cancels ${getCardDef(item.cardDefId).name}.`, 'response');
            negateDef.resolve({
              helpers,
              ownerId: item.negatingPlayerId,
              cancelledCardInstanceId: item.cardInstanceId,
              cancelledFaction: item.cardFaction,
            });
            if (item.cardType === 'Equip' && item.pendingCardInstance) {
              draft.players[item.cardOwnerId].voidZone.push(item.pendingCardInstance);
            }
            if (item.continuation.kind === 'resolveReactionThenFinishTrigger') {
              // The Reaction itself never applies - the original event still needs to finish,
              // just as if the responding player had passed instead of playing it.
              continueTriggerUnmodified(draft, item.continuation.trigger);
            }
            maybeLogActionResolved(draft);
            return;
          }
        }

        logMsg(draft, `${item.negatingPlayerId} passed.`, 'response');
        if (item.continuation.kind === 'resolveSpecial') {
          const def = getCardDef(item.cardDefId) as SpecialDef;
          def.resolve({
            helpers,
            ownerId: item.continuation.ownerId,
            targetApexInstanceId: item.continuation.targetApexInstanceId,
          });
          maybeTriggerHumanErrorChoice(draft, item.continuation.ownerId);
        } else if (item.continuation.kind === 'resolveEquip' && item.pendingCardInstance) {
          const hit = findApexAnywhere(draft, item.continuation.apexInstanceId);
          if (hit) {
            hit.apex.equip = item.pendingCardInstance;
            logMsg(draft, `${getCardDef(item.pendingCardInstance.defId).name} attaches to ${getCardDef(hit.apex.defId).name}.`, 'play');
          }
        } else if (item.continuation.kind === 'resolveReactionThenFinishTrigger') {
          const reactionDef = getCardDef(item.cardDefId) as ReactionDef;
          applyChosenReactionAndContinue(draft, item.continuation.trigger, reactionDef, item.continuation.reactionOwnerId);
        }
        maybeLogActionResolved(draft);
        return;
      }

      if (item.stage === 'humanErrorChoice') {
        if (choice.type === 'humanError' && choice.pick === 'momentum') {
          gainMomentumFn(draft, item.playerId, 1);
          logMsg(draft, `Human Error: ${item.playerId} chooses +1 Momentum.`, 'rift');
        } else {
          draft.players[item.playerId].pendingAttackBonus += 100;
          logMsg(draft, `Human Error: ${item.playerId} primes their next Apex attack this turn for +100 damage.`, 'rift');
        }
        return;
      }

      if (item.stage === 'civilWarChoice') {
        if (choice.type === 'civilWar' && choice.pick === 'momentum') {
          gainMomentumFn(draft, item.playerId, 1);
          logMsg(draft, `Civil War: ${item.playerId} chooses +1 Momentum.`, 'rift');
        } else {
          draft.players[item.playerId].pendingAttackBonus += 100;
          logMsg(draft, `Civil War: ${item.playerId} chooses +100 damage for their first Apex attack this turn.`, 'rift');
        }
        return;
      }
    }),

  resetToMenu: () => mutate(set, (draft) => Object.assign(draft, initialState())),
  toggleDebugMode: () => mutate(set, (draft) => { draft.debugMode = !draft.debugMode; }),
}));

export type { GameStore };
