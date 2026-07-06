import type {
  CardInstance,
  CounterType,
  EngineHelpers,
  GameState,
  LogKind,
  NegateDef,
  PlayerId,
  ResponseEvent,
} from '@/types/game';
import { RESPONSE_EVENT_TAG } from '@/types/game';
import { getCardDef } from '@/data/cards';

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
export function getApexAttackBonusPreview(state: GameState, apexInstanceId: string): number {
  const hit = findApexAnywhere(state, apexInstanceId);
  if (!hit) return 0;
  const { apex, ownerId } = hit;
  const def = getCardDef(apex.defId);
  if (def.type !== 'Apex') return 0;

  let bonus = apex.armedBonus ?? 0;
  const helpers = createHelpers(state);
  const previewCtx = {
    helpers,
    ownerId,
    attackerInstanceId: apexInstanceId,
    targetInstanceId: undefined,
    syncCost: 0 as const,
    baseDamage: 0,
  };

  if (def.passiveDamageBonus) {
    bonus += def.passiveDamageBonus(previewCtx);
  }
  if (apex.equip) {
    const equipDef = getCardDef(apex.equip.defId);
    if (equipDef.type === 'Equip' && equipDef.damageBonus) {
      bonus += equipDef.damageBonus(previewCtx);
    }
  }
  return bonus;
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
  player.momentum += amount;
  logMsg(draft, `${playerId} gains ${amount} Momentum (now ${player.momentum}).`, 'momentum');

  // Recursive Failure rift: first Momentum gain from a card effect each turn places a Glitch Counter.
  if (draft.riftSpace?.id === 'RecursiveFailure' && !player.turnFlags.recursiveGlitchPlacedThisTurn) {
    player.turnFlags.recursiveGlitchPlacedThisTurn = true;
    const targetApex = player.apexSlots.find(Boolean);
    if (targetApex) {
      addCounterFn(draft, targetApex.instanceId, 'glitch', 1, playerId);
      logMsg(draft, `Recursive Failure punishes the Momentum gain with a Glitch Counter.`, 'rift');
    }
  }
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

  // Echo Riot: first self-inflicted O2 loss each turn deals 1 additional O2 loss.
  if (opts?.fromOwnEffect && draft.riftSpace?.id === 'EchoRiot' && !player.turnFlags.ownEffectO2LossThisTurn) {
    player.turnFlags.ownEffectO2LossThisTurn = true;
    amount += 1;
    logMsg(draft, 'Echo Riot punishes the self-inflicted O2 loss with 1 additional O2 lost.', 'rift');
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

  // White Room Collapse rift: first Choke Counter placement each turn by a player costs a card/Momentum/O2.
  if (type === 'choke' && draft.riftSpace?.id === 'WhiteRoomCollapse' && placedByPlayerId) {
    const placer = draft.players[placedByPlayerId];
    if (!placer.turnFlags.chokeCounterPlacedThisTurn) {
      placer.turnFlags.chokeCounterPlacedThisTurn = true;
      if (placer.hand.length > 0) {
        const discarded = placer.hand.shift()!;
        placer.discard.push(discarded);
        logMsg(draft, `White Room Collapse forces ${placedByPlayerId} to discard a card.`, 'rift');
      } else if (placer.momentum > 0) {
        loseMomentumFn(draft, placedByPlayerId, 1);
        logMsg(draft, `White Room Collapse costs ${placedByPlayerId} 1 Momentum (no card to discard).`, 'rift');
      } else {
        loseO2Fn(draft, placedByPlayerId, 1);
        logMsg(draft, `White Room Collapse costs ${placedByPlayerId} 1 O2 (no card or Momentum).`, 'rift');
      }
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
  player.discard.push(card);
  return true;
}

/** Unchain any supports pointed at an apex that is leaving play. They remain in play, unchained. */
function unchainSupportsFor(draft: GameState, ownerId: PlayerId, apexInstanceId: string) {
  for (const support of draft.players[ownerId].supportSlots) {
    if (support && support.chainedApexId === apexInstanceId) {
      support.chainedApexId = null;
    }
  }
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
    player.discard.push(apex.equip);
  }

  unchainSupportsFor(draft, ownerId, apexInstanceId);

  const slotIdx = player.apexSlots.findIndex((a) => a?.instanceId === apexInstanceId);
  if (slotIdx !== -1) player.apexSlots[slotIdx] = null;
  player.discard.push({ ...apex, equip: undefined });

  logMsg(draft, `${def.name} is destroyed.`, 'destroy');
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
    if (card.type !== 'Reaction' && card.type !== 'Negate') return false;
    const def = getCardDef(card.defId);
    if (def.type !== 'Reaction' && def.type !== 'Negate') return false;

    const tags = def.tags ?? [];
    if (!tags.includes('INSTANT')) return false;
    if (!tags.includes(requiredTag)) return false;
    if (player.momentum < def.cost) return false;
    // Each player may play only 1 INSTANT-tagged card per their own turn cycle
    // (whether played on their own turn or in response to the opponent's).
    if (player.turnFlags.instantsPlayedThisTurn >= 1) return false;

    // Target/effect legality checks beyond simple tag + cost matching:
    if (def.type === 'Negate' && (event.kind === 'SPECIAL_PLAYED' || event.kind === 'EQUIP_PLAYED' || event.kind === 'REACTION_PLAYED')) {
      const negateDef = def as NegateDef;
      if (!negateDef.canCancel(event.data.cardType, event.data.cardFaction)) return false;
    }
    if (def.type === 'Reaction' && event.kind === 'O2_DAMAGE_PENDING') {
      if (event.data.amount <= 0) return false; // must actually deal at least 1 O2 damage
    }

    return true;
  });
}

/** Convenience boolean form of getEligibleResponses, for gating whether to open a Response Window at all. */
export function isResponseWindowEligible(state: GameState, respondingPlayerId: PlayerId, event: ResponseEvent): boolean {
  return getEligibleResponses(state, respondingPlayerId, event).length > 0;
}
