import type {
  AbilitySupportDef,
  CardInstance,
  CounterType,
  EngineHelpers,
  GameState,
  LogKind,
  PlayerId,
  ResponseEvent,
} from '@/types/game';
import { RESPONSE_EVENT_TAG } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { shuffle } from '@/data/decks';

export const MAX_SYNC = 3;
// Rebalanced per request: 100 damage = 1 O2 loss (was 200), with the total O2 pool
// doubled to 12 (was 6) so the overall damage-to-kill budget stays the same
// (6 * 200 = 1200 == 12 * 100 = 1200) - just at twice the resolution, so smaller
// overflow amounts (like 100) actually register instead of rounding down to 0.
// The direct-attack cap is scaled proportionally too (2 -> 4) so direct attacks
// keep the same effective per-turn damage ceiling (2 * 200 == 4 * 100 = 400) rather
// than being silently nerfed by the finer granularity.
export const OVERFLOW_O2_DIVISOR = 100;
export const DIRECT_O2_DIVISOR = 100;
export const DIRECT_O2_CAP_PER_TURN = 4;
export const STARTING_O2 = 12;
export const MAX_O2 = 12;
export const MAX_MOMENTUM = 3;
export const STARTING_HAND_SIZE = 5;
export const DECK_SIZE_TARGET = 30;
export const MAX_ABILITY_SUPPORTS = 2;
export const MAX_GLITCH_COUNTERS = 3;

export function findApexAnywhere(
  state: GameState,
  apexInstanceId: string
): { apex: CardInstance; ownerId: PlayerId } | undefined {
  for (const pid of ['player1', 'player2'] as PlayerId[]) {
    const apex = state.players[pid].apexSlots.find((a) => a?.instanceId === apexInstanceId);
    if (apex) return { apex, ownerId: pid };
  }
  return undefined;
}

export function findSupportAnywhere(
  state: GameState,
  supportInstanceId: string
): { support: CardInstance; ownerId: PlayerId } | undefined {
  for (const pid of ['player1', 'player2'] as PlayerId[]) {
    const s = state.players[pid].supportSlots.find((c) => c?.instanceId === supportInstanceId);
    if (s) return { support: s, ownerId: pid };
  }
  return undefined;
}

export function findAnyCardInstance(
  state: GameState,
  instanceId: string
): { card: CardInstance; ownerId: PlayerId; zone: 'apex' | 'support' | 'equip' } | undefined {
  const apexHit = findApexAnywhere(state, instanceId);
  if (apexHit) return { card: apexHit.apex, ownerId: apexHit.ownerId, zone: 'apex' };
  const supportHit = findSupportAnywhere(state, instanceId);
  if (supportHit) return { card: supportHit.support, ownerId: supportHit.ownerId, zone: 'support' };
  for (const pid of ['player1', 'player2'] as PlayerId[]) {
    for (const apex of state.players[pid].apexSlots) {
      if (apex?.equip?.instanceId === instanceId) return { card: apex.equip, ownerId: pid, zone: 'equip' };
    }
  }
  return undefined;
}

/** Effective DEF = baseDef + equip bonus + active temp buffs + apex passive DEF bonus - glitch counter penalty */
export function getEffectiveDef(state: GameState, apexInstanceId: string): number {
  const hit = findApexAnywhere(state, apexInstanceId);
  if (!hit) return 0;
  const { apex, ownerId } = hit;
  const def = getCardDef(apex.defId);
  if (def.type !== 'Apex') return 0;

  if (typeof apex.survivorDefOverride === 'number') {
    return Math.max(0, apex.survivorDefOverride);
  }

  let total = def.baseDef;

  if (apex.equip) {
    const equipDef = getCardDef(apex.equip.defId);
    if (equipDef.type === 'Equip' && equipDef.defBonus) total += equipDef.defBonus;
  }

  const activeBuffs = (apex.tempDefBuffs ?? []).filter((b) => state.turnNumber <= b.expiresAfterTurn);
  for (const buff of activeBuffs) total += buff.amount;

  if (def.passiveDefBonus) total += def.passiveDefBonus(apex, state);

  const glitch = apex.counters?.glitch ?? 0;
  total -= glitch * 100;

  void ownerId;
  return Math.max(0, total);
}

/**
 * Best-effort preview of the flat damage bonus currently "loaded" on an Apex, for UI
 * boost/nerf coloring. Combines: the apex's armed one-shot bonus (Spark-Plug, Overclock,
 * Static Jack, Drone Choir...), any target-independent passive trait bonus (Riot Runner,
 * Virex, Halcyon Maw), and the equipped Equip's flat damage bonus. Conditional bonuses
 * that depend on the eventual target (e.g. Monomolecular Blade's choke check) are
 * previewed at their base/lower value since no target is known yet - the real value at
 * attack-declare time may be equal or higher, never lower, so this never overstates a boost.
 * This is a read-only preview: it never mutates state, even though it borrows createHelpers.
 */
// NOTE: getApexAttackBonusPreview was retired in favor of getPreviewAttackDamage, which
// is now the single source of truth for attack damage everywhere (board display, attack
// selector, outcome preview, and actual combat resolution) - see getPreviewAttackDamage
// below. The old helper only summed a subset of modifiers (passive + equip + armed) and
// applied the same number to every attack line uniformly, which both duplicated logic
// and produced inaccurate numbers (it never accounted for Choke Counters or each
// attack's own conditional bonus).


export interface DamageModifier {
  label: string;
  amount: number;
}

export interface AttackDamagePreview {
  baseDamage: number;
  modifiedDamage: number;
  modifiers: DamageModifier[];
}

/**
 * Single source of truth for "what will this attack actually deal right now" - used both
 * by the Combat Phase attack selector (as a preview, before anything is spent) and by
 * declareAttack itself (to compute the real damage), so the two can never drift apart.
 * Reads apex.armedBonus / player.pendingAttackBonus / player.pendingTargetedAttackBonus
 * without consuming them - the caller (declareAttack) is responsible for zeroing out
 * whichever one-shot bonuses actually got used once the attack is committed.
 * If a modifier depends on the target (e.g. Monomolecular Blade's choke check) and no
 * target is given yet, it's evaluated as if untargeted (matching each card's own
 * target-independent fallback), consistent with "before target modifiers" from the request.
 */
export function getPreviewAttackDamage(
  state: GameState,
  attackerInstanceId: string,
  attackId: string,
  targetInstanceId?: string
): AttackDamagePreview | null {
  const hit = findApexAnywhere(state, attackerInstanceId);
  if (!hit) return null;
  const { apex, ownerId } = hit;
  const def = getCardDef(apex.defId);
  if (def.type !== 'Apex') return null;
  const attackDef = def.attacks.find((a) => a.id === attackId);
  if (!attackDef) return null;

  const helpers = createHelpers(state);
  const ctx = {
    helpers,
    ownerId,
    attackerInstanceId,
    targetInstanceId,
    syncCost: attackDef.syncCost,
    baseDamage: attackDef.baseDamage,
  };

  const modifiers: DamageModifier[] = [];
  let total = attackDef.baseDamage;

  if (attackDef.bonusDamage) {
    const bonus = attackDef.bonusDamage(ctx);
    if (bonus) {
      total += bonus;
      modifiers.push({ label: `${attackDef.name} bonus condition met`, amount: bonus });
    }
  }

  if (def.passiveDamageBonus) {
    const bonus = def.passiveDamageBonus(ctx);
    if (bonus) {
      total += bonus;
      modifiers.push({ label: 'passive trait', amount: bonus });
    }
  }

  if (apex.equip) {
    const equipDef = getCardDef(apex.equip.defId);
    if (equipDef.type === 'Equip' && equipDef.damageBonus) {
      const bonus = equipDef.damageBonus(ctx);
      if (bonus) {
        total += bonus;
        modifiers.push({ label: equipDef.name, amount: bonus });
      }
    }
  }

  if (apex.armedBonus) {
    total += apex.armedBonus;
    modifiers.push({ label: 'armed bonus', amount: apex.armedBonus });
  }

  const player = state.players[ownerId];
  if (player.pendingAttackBonus) {
    total += player.pendingAttackBonus;
    modifiers.push({ label: 'primed effect', amount: player.pendingAttackBonus });
  }
  if (player.pendingTargetedAttackBonus && targetInstanceId && player.pendingTargetedAttackBonus.targetInstanceId === targetInstanceId) {
    total += player.pendingTargetedAttackBonus.amount;
    modifiers.push({ label: 'primed effect vs this target', amount: player.pendingTargetedAttackBonus.amount });
  }

  // Ability Support chainedAttackBonus: an immediate bonus applied to this exact attack
  // (e.g. Spark-Plug), only while validly chained, unlocked, and not Reconfigure-locked.
  for (const support of player.supportSlots) {
    if (!support || support.type !== 'AbilitySupport') continue;
    if (support.chainedApexId !== attackerInstanceId) continue;
    if (support.lockedByControlConflict) continue;
    if (support.enteredViaReconfigureTurn === state.turnNumber) continue;
    const supportDef = getCardDef(support.defId) as AbilitySupportDef;
    if (!supportDef.chainedAttackBonus) continue;
    const bonus = supportDef.chainedAttackBonus(ctx);
    if (bonus) {
      total += bonus;
      modifiers.push({ label: supportDef.name, amount: bonus });
    }
  }

  // Choke Counter penalty: -100 damage per Choke Counter (0 CHK: none, 1: -100, 2: -200,
  // 3: -300, ...). Defined in the original card-pool spec but never actually wired into
  // damage resolution until this patch made it visible/testable.
  const chokeCount = apex.counters?.choke ?? 0;
  if (chokeCount > 0) {
    const chokePenalty = -100 * chokeCount;
    total += chokePenalty;
    modifiers.push({ label: `Choke Counter x${chokeCount}`, amount: chokePenalty });
  }

  return { baseDamage: attackDef.baseDamage, modifiedDamage: Math.max(0, total), modifiers };
}

/** Returns the Ability Support (if any) chained to the given Apex, for the "Chained
 *  Support: X" indicator on Apex cards. Only Ability Supports can be chained. */
export function getChainedSupportFor(state: GameState, playerId: PlayerId, apexInstanceId: string): CardInstance | null {
  const support = state.players[playerId].supportSlots.find(
    (s) => s?.type === 'AbilitySupport' && s.chainedApexId === apexInstanceId
  );
  return support ?? null;
}

/** Returns the display label for a Support's own chain indicator: "Chain -> X" for a
 *  chained Ability Support, "Unchained" for an unchained one, or null for a Battery
 *  Support (which is never chained and should show no chain info at all). */
export function getChainLabelForSupport(state: GameState, playerId: PlayerId, supportInstanceId: string): string | null {
  const support = state.players[playerId].supportSlots.find((s) => s?.instanceId === supportInstanceId);
  if (!support || support.type !== 'AbilitySupport') return null;
  if (!support.chainedApexId) return 'Unchained';
  const apex = state.players[playerId].apexSlots.find((a) => a?.instanceId === support.chainedApexId);
  if (!apex) return 'Unchained';
  return `Chain -> ${getCardDef(apex.defId).name}`;
}

export interface AttackOutcomePreview {
  finalDamage: number;
  targetDef: number | null; // null for a direct O2 attack
  willDestroy: boolean;
  overflow: number;
  o2Loss: number;
  apexBreakRewardWouldTrigger: boolean;
  isDirect: boolean;
}

/**
 * Full "what would happen if I attacked this right now" preview: final damage (via
 * getPreviewAttackDamage), the target's current DEF, whether it would be destroyed,
 * expected overflow, expected O2 loss, and whether Apex Break Reward would trigger.
 * This never disables an attack for being "weak" - it's purely informational, matching
 * "do not disable legal attacks just because they are weak."
 */
export function getAttackOutcomePreview(
  state: GameState,
  attackerInstanceId: string,
  attackId: string,
  targetInstanceId?: string
): AttackOutcomePreview | null {
  const dmgPreview = getPreviewAttackDamage(state, attackerInstanceId, attackId, targetInstanceId);
  if (!dmgPreview) return null;
  const attackerHit = findApexAnywhere(state, attackerInstanceId);
  if (!attackerHit) return null;
  const attackDef = getCardDef(attackerHit.apex.defId);
  if (attackDef.type !== 'Apex') return null;
  const atk = attackDef.attacks.find((a) => a.id === attackId);
  if (!atk) return null;

  if (targetInstanceId) {
    const targetHit = findApexAnywhere(state, targetInstanceId);
    if (!targetHit) return null;
    const targetCardDef = getCardDef(targetHit.apex.defId);
    if (targetCardDef.type !== 'Apex') return null;

    let dmg = dmgPreview.modifiedDamage;
    if (targetCardDef.incomingDamageReduction) dmg = targetCardDef.incomingDamageReduction(atk.syncCost, dmg);

    const targetDef = getEffectiveDef(state, targetInstanceId);
    const willDestroy = dmg >= targetDef;
    let overflow = willDestroy ? dmg - targetDef : 0;
    if (willDestroy && targetHit.apex.equip) {
      const eqDef = getCardDef(targetHit.apex.equip.defId);
      if (eqDef.type === 'Equip' && eqDef.onOverflowDamage) overflow = eqDef.onOverflowDamage(overflow);
    }
    const o2Loss = willDestroy ? overflowToO2Loss(overflow) : 0;
    const apexBreakRewardWouldTrigger = willDestroy && overflow === 0;

    return { finalDamage: dmg, targetDef, willDestroy, overflow, o2Loss, apexBreakRewardWouldTrigger, isDirect: false };
  }

  // Direct O2 attack preview
  const rawLoss = directDamageToO2Loss(dmgPreview.modifiedDamage);
  const attackerPlayer = state.players[attackerHit.ownerId];
  const remainingCap = Math.max(0, DIRECT_O2_CAP_PER_TURN - attackerPlayer.turnFlags.directO2LossThisTurn);
  const o2Loss = Math.min(rawLoss, remainingCap);

  return {
    finalDamage: dmgPreview.modifiedDamage,
    targetDef: null,
    willDestroy: false,
    overflow: 0,
    o2Loss,
    apexBreakRewardWouldTrigger: false,
    isDirect: true,
  };
}

export interface OverdriveEligibility {
  supportInstanceId: string;
  supportDefId: 'nu-spark-plug' | 'nu-juice-box';
  supportName: string;
}

/** Checks whether the given attacker has a chained, unlocked Spark-Plug or Juice-Box
 *  eligible to offer its optional Overdrive Momentum spend on this attack. Only one
 *  Ability Support can ever be chained to a given Apex, so at most one of these two
 *  cards can ever apply to a single attack. Returns null if not eligible (no such
 *  support chained, it's locked, or the player has 0 Momentum to spend). */
export function getOverdriveEligibility(state: GameState, attackerInstanceId: string): OverdriveEligibility | null {
  const hit = findApexAnywhere(state, attackerInstanceId);
  if (!hit) return null;
  const player = state.players[hit.ownerId];
  if (player.momentum < 1) return null;
  const support = player.supportSlots.find(
    (s) =>
      s?.type === 'AbilitySupport' &&
      s.chainedApexId === attackerInstanceId &&
      !s.lockedByControlConflict &&
      s.enteredViaReconfigureTurn !== state.turnNumber &&
      (s.defId === 'nu-spark-plug' || s.defId === 'nu-juice-box')
  );
  if (!support) return null;
  return { supportInstanceId: support.instanceId, supportDefId: support.defId as 'nu-spark-plug' | 'nu-juice-box', supportName: getCardDef(support.defId).name };
}

export function pruneExpiredModifiers(state: GameState) {
  for (const pid of ['player1', 'player2'] as PlayerId[]) {
    for (const apex of state.players[pid].apexSlots) {
      if (!apex) continue;
      apex.tempDefBuffs = (apex.tempDefBuffs ?? []).filter((b) => state.turnNumber <= b.expiresAfterTurn);
      apex.protections = (apex.protections ?? []).filter((p) => state.turnNumber <= p.expiresAfterTurn);
    }
  }
}

export function computeAvailableSync(state: GameState, playerId: PlayerId): number {
  const supportCount = state.players[playerId].supportSlots.filter(Boolean).length;
  return Math.min(MAX_SYNC, supportCount);
}

export function overflowToO2Loss(overflow: number): number {
  if (overflow <= 0) return 0;
  return Math.floor(overflow / OVERFLOW_O2_DIVISOR);
}

export function directDamageToO2Loss(damage: number): number {
  if (damage <= 0) return 0;
  return Math.floor(damage / DIRECT_O2_DIVISOR);
}

export function countAbilitySupports(state: GameState, playerId: PlayerId): number {
  return state.players[playerId].supportSlots.filter((s) => s?.type === 'AbilitySupport').length;
}

export function hasEmptyApexSlot(state: GameState, playerId: PlayerId): boolean {
  return state.players[playerId].apexSlots.some((a) => a === null);
}

export function hasEmptySupportSlot(state: GameState, playerId: PlayerId): boolean {
  return state.players[playerId].supportSlots.some((s) => s === null);
}

export function countApexes(state: GameState, playerId: PlayerId): number {
  return state.players[playerId].apexSlots.filter(Boolean).length;
}

// ==========================================================================
// Draft-mutating engine operations. These are called with an Immer draft
// (or the live Zustand state — both are plain mutable objects from the
// perspective of this module) and implement the shared game rules that
// individual card effects hook into via EngineHelpers.
// ==========================================================================

let logCounter = 0;
export function logMsg(draft: GameState, message: string, kind: LogKind = 'info') {
  logCounter += 1;
  draft.log.push({ id: `log-${logCounter}`, turn: draft.turnNumber, message, kind });
  // Keep the log from growing unbounded during long sessions
  if (draft.log.length > 500) draft.log.splice(0, draft.log.length - 500);
}

export function otherPlayer(playerId: PlayerId): PlayerId {
  return playerId === 'player1' ? 'player2' : 'player1';
}

export function drawOneCard(draft: GameState, playerId: PlayerId): CardInstance | null {
  const player = draft.players[playerId];
  if (player.deck.length === 0) {
    if (player.voidZone.length > 0) {
      logMsg(draft, `${playerId} would draw from an empty Deck.`, 'draw');
      logMsg(draft, `Void Recycle: ${playerId} shuffles their Void into their Deck.`, 'rift');
      player.deck = shuffle(player.voidZone);
      player.voidZone = [];
    } else {
      logMsg(draft, `${playerId} has no cards in Deck or Void and loses.`, 'draw');
      if (draft.status !== 'gameover') {
        draft.status = 'gameover';
        draft.winnerId = otherPlayer(playerId);
        draft.gameOverReason = `${playerId} had no cards left in Deck or Void.`;
        logMsg(draft, `${draft.winnerId} wins! ${playerId} ran out of cards.`, 'win');
      }
      return null;
    }
  }
  const card = player.deck.shift();
  if (!card) {
    logMsg(draft, `${player.faction} (${playerId}) has no cards left to draw!`, 'draw');
    return null;
  }
  player.hand.push(card);
  return card;
}

export function drawCardsFn(draft: GameState, playerId: PlayerId, count: number) {
  for (let i = 0; i < count; i++) {
    const card = drawOneCard(draft, playerId);
    if (card) {
      const def = getCardDef(card.defId);
      logMsg(draft, `${playerId} draws ${def.name}.`, 'draw');
    }
  }
}

export function gainMomentumFn(draft: GameState, playerId: PlayerId, amount: number) {
  if (amount <= 0) return;
  const player = draft.players[playerId];

  if (player.momentum >= MAX_MOMENTUM) {
    logMsg(draft, `${playerId} is already at max Momentum.`, 'momentum');
    return;
  }

  const newMomentum = Math.min(MAX_MOMENTUM, player.momentum + amount);
  const actualGain = newMomentum - player.momentum;
  const wasCapped = actualGain < amount;
  player.momentum = newMomentum;
  logMsg(
    draft,
    `${playerId} gains ${actualGain} Momentum (now ${player.momentum}).${wasCapped ? ` Momentum capped at ${MAX_MOMENTUM}.` : ''}`,
    'momentum'
  );
}

export function loseMomentumFn(draft: GameState, playerId: PlayerId, amount: number) {
  if (amount <= 0) return;
  const player = draft.players[playerId];
  const before = player.momentum;
  player.momentum = Math.max(0, player.momentum - amount);
  if (before !== player.momentum) {
    logMsg(draft, `${playerId} loses ${before - player.momentum} Momentum (now ${player.momentum}).`, 'momentum');
  }
}

export function gainO2Fn(draft: GameState, playerId: PlayerId, amount: number) {
  if (amount <= 0) return;
  const player = draft.players[playerId];
  if (player.o2 >= MAX_O2) {
    logMsg(draft, `${playerId} is already at max O2.`, 'o2');
    return;
  }
  const newO2 = Math.min(MAX_O2, player.o2 + amount);
  const actualGain = newO2 - player.o2;
  player.o2 = newO2;
  logMsg(draft, `${playerId} gains ${actualGain} O2 (now ${player.o2}).`, 'o2');
}

export function loseO2Fn(
  draft: GameState,
  playerId: PlayerId,
  amount: number,
  opts?: { fromOwnEffect?: boolean }
) {
  if (amount <= 0) return;
  const player = draft.players[playerId];

  // Echo Riot: the first time each turn a player loses O2 from their own card effect
  // (e.g. Overclock), they gain 1 Momentum.
  if (opts?.fromOwnEffect && draft.riftSpace?.id === 'EchoRiot' && !player.turnFlags.ownEffectO2LossThisTurn) {
    player.turnFlags.ownEffectO2LossThisTurn = true;
    gainMomentumFn(draft, playerId, 1);
    logMsg(draft, 'Echo Riot grants 1 Momentum for the self-inflicted O2 loss.', 'rift');
  }

  // Reserve Grid shield: reduces the next O2 loss this turn by 1 per stored charge.
  if (player.reserveGridShield > 0 && amount > 0) {
    const reduced = Math.min(player.reserveGridShield, amount);
    player.reserveGridShield -= reduced;
    amount -= reduced;
    logMsg(draft, `Reserve Grid absorbs ${reduced} O2 loss.`, 'support');
  }

  if (amount <= 0) return;
  player.o2 = Math.max(0, player.o2 - amount);
  logMsg(draft, `${playerId} loses ${amount} O2 (now ${player.o2}).`, 'o2');

  checkWinCondition(draft);
}

export function checkWinCondition(draft: GameState) {
  if (draft.status === 'gameover') return;
  const p1Dead = draft.players.player1.o2 <= 0;
  const p2Dead = draft.players.player2.o2 <= 0;
  if (p1Dead || p2Dead) {
    draft.status = 'gameover';
    draft.winnerId = p1Dead && p2Dead ? null : p1Dead ? 'player2' : 'player1';
    draft.gameOverReason = p1Dead && p2Dead ? 'Both players hit 0 O2 simultaneously.' : `${p1Dead ? 'player1' : 'player2'}'s O2 hit zero.`;
    logMsg(
      draft,
      draft.winnerId
        ? `${draft.winnerId} wins! Opponent's O2 hit zero.`
        : 'Both players hit 0 O2 simultaneously — draw!',
      'win'
    );
  }
}

export function addCounterFn(
  draft: GameState,
  apexInstanceId: string,
  type: CounterType,
  amount = 1,
  placedByPlayerId?: PlayerId
) {
  const hit = findApexAnywhere(draft, apexInstanceId);
  if (!hit) return;
  const apex = hit.apex;
  if (!apex.counters) apex.counters = { choke: 0, upgrade: 0, glitch: 0 };
  if (type === 'glitch') {
    apex.counters.glitch = Math.min(MAX_GLITCH_COUNTERS, apex.counters.glitch + amount);
  } else {
    apex.counters[type] += amount;
  }
  logMsg(draft, `${getCardDef(apex.defId).name} gets ${amount} ${type} counter(s).`, 'counter');

  // White Room Collapse rift: the first Choke Counter a player places on an enemy Apex
  // each turn grants 1 Momentum.
  if (type === 'choke' && draft.riftSpace?.id === 'WhiteRoomCollapse' && placedByPlayerId) {
    const placer = draft.players[placedByPlayerId];
    const placedOnEnemyApex = !placer.apexSlots.some((a) => a?.instanceId === apexInstanceId);
    if (placedOnEnemyApex && !placer.turnFlags.chokeCounterPlacedThisTurn) {
      placer.turnFlags.chokeCounterPlacedThisTurn = true;
      gainMomentumFn(draft, placedByPlayerId, 1);
      logMsg(draft, `White Room Collapse grants ${placedByPlayerId} 1 Momentum for placing a Choke Counter.`, 'rift');
    }
  }
}

export function removeCounterFn(draft: GameState, apexInstanceId: string, type: CounterType, amount = 1) {
  const hit = findApexAnywhere(draft, apexInstanceId);
  if (!hit) return;
  const apex = hit.apex;
  if (!apex.counters) return;
  apex.counters[type] = Math.max(0, apex.counters[type] - amount);
}

export function armAttackBonusFn(draft: GameState, apexInstanceId: string, amount: number) {
  const hit = findApexAnywhere(draft, apexInstanceId);
  if (!hit) return;
  hit.apex.armedBonus = (hit.apex.armedBonus ?? 0) + amount;
}

export function armOverclockBonusFn(draft: GameState, apexInstanceId: string, amount: number) {
  const hit = findApexAnywhere(draft, apexInstanceId);
  if (!hit) return;
  hit.apex.armedBonus = (hit.apex.armedBonus ?? 0) + amount;
  hit.apex.armedBonusIsOverclock = true;
}

export function markPendingEndPhaseBuffFn(draft: GameState, apexInstanceId: string, amount: number) {
  const hit = findApexAnywhere(draft, apexInstanceId);
  if (!hit) return;
  hit.apex.pendingEndPhaseDefBuff = (hit.apex.pendingEndPhaseDefBuff ?? 0) + amount;
}

export function markPendingEndPhaseProtectionFn(draft: GameState, apexInstanceId: string, reduction: number) {
  const hit = findApexAnywhere(draft, apexInstanceId);
  if (!hit) return;
  hit.apex.pendingEndPhaseProtection = Math.max(hit.apex.pendingEndPhaseProtection ?? 0, reduction);
}

export function applyTempDefBuffFn(draft: GameState, apexInstanceId: string, amount: number, expiresAfterTurn: number) {
  const hit = findApexAnywhere(draft, apexInstanceId);
  if (!hit) return;
  if (!hit.apex.tempDefBuffs) hit.apex.tempDefBuffs = [];
  hit.apex.tempDefBuffs.push({
    id: `buff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    amount,
    expiresAfterTurn,
    label: amount >= 0 ? `+${amount} DEF` : `${amount} DEF`,
  });
}

export function applyProtectionFn(draft: GameState, apexInstanceId: string, reduction: number, expiresAfterTurn: number) {
  const hit = findApexAnywhere(draft, apexInstanceId);
  if (!hit) return;
  if (!hit.apex.protections) hit.apex.protections = [];
  hit.apex.protections.push({
    id: `prot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    reduction,
    expiresAfterTurn,
    label: `-${reduction} incoming dmg`,
  });
}

export function discardFromHandFn(draft: GameState, playerId: PlayerId, cardInstanceId: string): boolean {
  const player = draft.players[playerId];
  const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId);
  if (idx === -1) return false;
  const [card] = player.hand.splice(idx, 1);
  player.voidZone.push(card);
  return true;
}

/** New core rule (Chained Support Destruction): when an Apex is destroyed, any
 *  Ability Support currently chained to it is destroyed too and sent to Void - not
 *  just unchained. Unchained Ability Supports and Battery Supports are unaffected,
 *  and this only ever looks at the ONE Ability Support chained to THIS apex (each
 *  Apex can have at most one chained). General-purpose - applies to any current or
 *  future Ability Support, nothing here is hardcoded to specific cards. */
function destroyChainedSupportForApex(draft: GameState, ownerId: PlayerId, apexInstanceId: string, apexName: string) {
  const player = draft.players[ownerId];
  const slotIdx = player.supportSlots.findIndex((s) => s?.type === 'AbilitySupport' && s.chainedApexId === apexInstanceId);
  if (slotIdx === -1) return;
  const support = player.supportSlots[slotIdx]!;
  const supportDef = getCardDef(support.defId);
  player.supportSlots[slotIdx] = null;
  // Clean copy to Void - same reasoning as Apex destruction: strip all transient state
  // (locked flags, Reconfigure-turn markers, etc.) so nothing survives as a ghost.
  player.voidZone.push({ instanceId: support.instanceId, defId: support.defId, type: support.type });
  logMsg(draft, `${supportDef.name} was chained to ${apexName} and is sent to the Void.`, 'destroy');
  // A Support disappearing can only ever reduce the Sync budget, never increase it - cap
  // the player's currently-remaining Sync to the new (lower) ceiling without touching the
  // rest of the Sync model, so a mid-Combat destruction can't leave "phantom" Sync behind.
  player.availableSync = Math.min(player.availableSync, computeAvailableSync(draft, ownerId));
}

export function destroyApexFn(draft: GameState, apexInstanceId: string) {
  const hit = findApexAnywhere(draft, apexInstanceId);
  if (!hit) return;
  const { apex, ownerId } = hit;
  const player = draft.players[ownerId];
  const def = getCardDef(apex.defId);

  if (apex.equip) {
    const equipDef = getCardDef(apex.equip.defId);
    if (equipDef.type === 'Equip' && equipDef.onEquippedDestroyed) {
      equipDef.onEquippedDestroyed({ helpers: createHelpers(draft), ownerId, apexInstanceId });
    }
    player.voidZone.push(apex.equip);
  }

  const slotIdx = player.apexSlots.findIndex((a) => a?.instanceId === apexInstanceId);
  if (slotIdx !== -1) player.apexSlots[slotIdx] = null;
  // Send a clean copy to Void - strip every piece of temporary/runtime state (counters,
  // armed bonuses, protections, hasAttacked, etc.) so nothing carries over as a ghost
  // buff/bug if this card is ever recovered from Void in the future.
  player.voidZone.push({ instanceId: apex.instanceId, defId: apex.defId, type: apex.type });

  logMsg(draft, `${def.name} is destroyed.`, 'destroy');

  destroyChainedSupportForApex(draft, ownerId, apexInstanceId, def.name);
}

export function createHelpers(draft: GameState): EngineHelpers {
  return {
    log: (message, kind) => logMsg(draft, message, kind),
    drawCards: (playerId, count) => drawCardsFn(draft, playerId, count),
    gainMomentum: (playerId, amount) => gainMomentumFn(draft, playerId, amount),
    loseMomentum: (playerId, amount) => loseMomentumFn(draft, playerId, amount),
    gainO2: (playerId, amount) => gainO2Fn(draft, playerId, amount),
    loseO2: (playerId, amount, opts) => loseO2Fn(draft, playerId, amount, opts),
    addCounter: (apexInstanceId, type, amount, placedByPlayerId) =>
      addCounterFn(draft, apexInstanceId, type, amount, placedByPlayerId),
    removeCounter: (apexInstanceId, type, amount) => removeCounterFn(draft, apexInstanceId, type, amount),
    destroyApex: (apexInstanceId) => destroyApexFn(draft, apexInstanceId),
    discardFromHand: (playerId, cardInstanceId) => discardFromHandFn(draft, playerId, cardInstanceId),
    getApex: (apexInstanceId) => findApexAnywhere(draft, apexInstanceId)?.apex,
    getPlayer: (playerId) => draft.players[playerId],
    getOpponentId: (playerId) => otherPlayer(playerId),
    getState: () => draft,
    applyTempDefBuff: (apexInstanceId, amount, expiresAfterTurn) =>
      applyTempDefBuffFn(draft, apexInstanceId, amount, expiresAfterTurn),
    applyProtection: (apexInstanceId, reduction, expiresAfterTurn) =>
      applyProtectionFn(draft, apexInstanceId, reduction, expiresAfterTurn),
    armAttackBonus: (apexInstanceId, amount) => armAttackBonusFn(draft, apexInstanceId, amount),
    armOverclockBonus: (apexInstanceId, amount) => armOverclockBonusFn(draft, apexInstanceId, amount),
    markPendingEndPhaseBuff: (apexInstanceId, amount) => markPendingEndPhaseBuffFn(draft, apexInstanceId, amount),
    markPendingEndPhaseProtection: (apexInstanceId, reduction) =>
      markPendingEndPhaseProtectionFn(draft, apexInstanceId, reduction),
  };
}

// ==========================================================================
// Engine Tag System - response-window eligibility
//
// This is the single source of truth for "does the responding player have a
// legal instant-speed card for this event?" Nothing else in the engine should
// hand-check card names/types for this purpose - it should call
// getEligibleResponses (or isResponseWindowEligible) instead.
// ==========================================================================

/**
 * Returns every card in the responding player's hand that is a legal instant-speed
 * response to the given event: tagged INSTANT, tagged with the event's matching
 * trigger tag, affordable with current Momentum, and (for Negates) actually able to
 * cancel the specific card type/faction involved.
 */
export function getEligibleResponses(
  state: GameState,
  respondingPlayerId: PlayerId,
  event: ResponseEvent
): CardInstance[] {
  const player = state.players[respondingPlayerId];
  const requiredTag = RESPONSE_EVENT_TAG[event.kind];

  return player.hand.filter((card) => {
    if (card.type !== 'Reaction') return false;
    const def = getCardDef(card.defId);
    if (def.type !== 'Reaction') return false;

    const tags = def.tags ?? [];
    if (!tags.includes('INSTANT')) return false;
    if (!tags.includes(requiredTag)) return false;
    if (player.momentum < def.cost) return false;
    // Each player may play only 1 INSTANT-tagged card per their own turn cycle
    // (whether played on their own turn or in response to the opponent's).
    if (player.turnFlags.instantsPlayedThisTurn >= 1) return false;

    // Target/effect legality checks beyond simple tag + cost matching:
    if (def.canCancel && (event.kind === 'SPECIAL_PLAYED' || event.kind === 'EQUIP_PLAYED' || event.kind === 'REACTION_PLAYED')) {
      if (!def.canCancel(event.data.cardType, event.data.cardFaction)) return false;
    }
    if (def.type === 'Reaction' && !def.canCancel && event.kind === 'O2_DAMAGE_PENDING') {
      if (event.data.amount <= 0) return false; // must actually deal at least 1 O2 damage
    }

    return true;
  });
}

/** Convenience boolean form of getEligibleResponses, for gating whether to open a Response Window at all. */
export function isResponseWindowEligible(state: GameState, respondingPlayerId: PlayerId, event: ResponseEvent): boolean {
  return getEligibleResponses(state, respondingPlayerId, event).length > 0;
}
