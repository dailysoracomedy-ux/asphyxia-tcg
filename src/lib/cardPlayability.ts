import type { CardInstance, GameState, PlayerId, SpecialDef, ReactionDef } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { MAX_ABILITY_SUPPORTS } from '@/game/rules';

/**
 * Read-only eligibility check for whether a hand card could currently be played -
 * used ONLY to decide hand-dimming brightness. This mirrors the exact conditions
 * each store play-action already checks (playApexCard, playSupportCard,
 * playEquipCard, equipSwap, playSpecialCard, and the response-window prompts in
 * ResponseModal.tsx), rather than inventing new logic - if a store action's own
 * rule ever changes, this can drift out of sync with it, but it can never be the
 * thing that decides what's actually legal. The store's own checks remain the only
 * authority; this never gates an actual play, only how dim a card looks.
 */
export function canPlayCardFromHand(state: GameState, playerId: PlayerId, card: CardInstance): boolean {
  if (state.status !== 'playing') return false;
  const player = state.players[playerId];
  const isActive = state.activePlayerId === playerId;
  const def = getCardDef(card.defId);

  // Reactions only ever get played through an open response window, never as a
  // direct "my turn, play this" action - mirrors ResponseModal.tsx's own eligible-
  // card logic exactly, since that's what actually determines what's clickable.
  if (card.type === 'Reaction') {
    const pending = state.pendingResponseQueue[0];
    if (!pending) return false;
    const rdef = def as ReactionDef;
    if (pending.stage === 'reactionChoice' && pending.respondingPlayerId === playerId) {
      return rdef.trigger === pending.trigger.kind && player.momentum >= rdef.cost;
    }
    if (pending.stage === 'negateWindow' && pending.negatingPlayerId === playerId) {
      return typeof rdef.canCancel === 'function' && player.momentum >= rdef.cost && rdef.canCancel(pending.cardType, pending.cardFaction);
    }
    return false;
  }

  // Every non-Reaction play requires Main phase, no pending response window, and
  // it being this player's own active turn - matches every play-action's own
  // opening guard clause exactly.
  if (!isActive || (state.phase !== 'Main' && state.phase !== 'Combat') || state.pendingResponseQueue.length > 0) return false;

  switch (card.type) {
    case 'Apex':
      return player.apexSlots.some((s) => s === null);

    case 'AbilitySupport': {
      if (player.turnFlags.supportsPlayedThisTurn >= 1) return false;
      if (!player.supportSlots.some((s) => s === null)) return false;
      const currentAbilityCount = player.supportSlots.filter((s) => s?.type === 'AbilitySupport').length;
      return currentAbilityCount < MAX_ABILITY_SUPPORTS;
    }

    case 'BatterySupport':
      if (player.turnFlags.supportsPlayedThisTurn >= 1) return false;
      return player.supportSlots.some((s) => s === null);

    case 'Equip': {
      // Two independent ways an Equip can be legally played right now: a fresh
      // attach onto an Apex with no Equip yet, or an Equip Swap onto an Apex whose
      // current Equip wasn't attached this same turn (and the swap budget is free).
      const hasEmptyEquipTarget = player.apexSlots.some((a) => a && !a.equip);
      if (hasEmptyEquipTarget) return true;
      if (player.turnFlags.equipSwapUsedThisTurn) return false;
      return player.apexSlots.some((a) => a?.equip && a.equip.equippedTurn !== state.turnNumber);
    }

    case 'Special': {
      if (player.turnFlags.specialsPlayedThisTurn >= 1) return false;
      const sdef = def as SpecialDef;
      return sdef.canPlay ? sdef.canPlay(playerId, state) : true;
    }

    default:
      return false;
  }
}

/** Short human-readable reason a card is currently unplayable, for an optional
 *  hover tooltip. Returns null if the card IS playable. Deliberately a separate,
 *  much simpler pass rather than threading reason strings through every branch
 *  above - keeps the authoritative boolean check easy to audit on its own. */
export function getCardPlayabilityReason(state: GameState, playerId: PlayerId, card: CardInstance): string | null {
  if (canPlayCardFromHand(state, playerId, card)) return null;
  const player = state.players[playerId];
  const isActive = state.activePlayerId === playerId;

  if (card.type === 'Reaction') {
    const pending = state.pendingResponseQueue[0];
    const isMyWindow =
      pending && ((pending.stage === 'reactionChoice' && pending.respondingPlayerId === playerId) || (pending.stage === 'negateWindow' && pending.negatingPlayerId === playerId));
    if (!isMyWindow) return 'Can only play during a response window';
    const def = getCardDef(card.defId) as ReactionDef;
    if (player.momentum < def.cost) return `Need ${def.cost} Momentum`;
    return 'Not a legal response right now';
  }

  if (!isActive) return "Not your turn";
  if ((state.phase !== 'Main' && state.phase !== 'Combat')) return 'Not your turn to play cards right now';
  if (state.pendingResponseQueue.length > 0) return 'Waiting on a response window';

  switch (card.type) {
    case 'Apex':
      return 'No empty Apex slot';
    case 'AbilitySupport':
    case 'BatterySupport':
      if (player.turnFlags.supportsPlayedThisTurn >= 1) return 'Already played an Engine this turn';
      return 'No empty Engine slot';
    case 'Equip':
      if (player.turnFlags.equipSwapUsedThisTurn) return 'Equip Swap already used this turn';
      return 'No legal Apex to Equip';
    case 'Special': {
      if (player.turnFlags.specialsPlayedThisTurn >= 1) return 'Special already played this turn';
      return "Card's conditions aren't met";
    }
    default:
      return 'Cannot be played right now';
  }
}
