import type { CardInstance, GameState, PlayerId } from '@/types/game';
import { canPlayCardFromHand } from '@/lib/cardPlayability';
import type { DragSource, DropZoneId } from './dragDropTypes';
import { zoneKey } from './dragDropTypes';

/**
 * Commit 30 - the only two functions that matter for correctness:
 * legalZonesFor (what glows) and resolveDrop (what happens on a valid drop).
 * Both are thin wrappers around existing validation and existing store
 * actions - see cardPlayability.ts's canPlayCardFromHand for the base
 * eligibility check this builds on, and each branch below for the exact same
 * store action the click flow already calls.
 */

export function legalZonesFor(state: GameState, source: DragSource): Set<string> {
  const zones = new Set<string>();
  const player = state.players[source.playerId];
  const opponentId: PlayerId = source.playerId === 'player1' ? 'player2' : 'player1';
  const opponent = state.players[opponentId];

  if (source.kind === 'apex-attack') {
    // Target-selection drag only, per the spec's guidance to keep the
    // existing click Apex -> choose attack flow and add drag for the final
    // target step. Legality here mirrors oppApexClick/GameBoard's own
    // attackAwaitingTarget handling exactly - any enemy Apex is a legal
    // target, and direct O2 attack is legal only when the opponent controls
    // no Apex at all.
    opponent.apexSlots.forEach((a, i) => {
      if (a) zones.add(zoneKey({ kind: 'enemy-apex', playerId: opponentId, instanceId: a.instanceId, slotIndex: i }));
    });
    if (!opponent.apexSlots.some(Boolean)) {
      zones.add(zoneKey({ kind: 'enemy-o2', playerId: opponentId }));
    }
    return zones;
  }

  if (source.kind === 'board-equip' || source.kind === 'board-engine') {
    // Commit 52 - a board Equip (attached to an Apex) or Engine (Ability
    // Support in a slot) can be dragged back into hand. The only legal
    // destination is the player's own hand zone. Legality of WHICH card can
    // move is validated in resolveDrop / the store action (e.g. Control
    // Conflict locks), but the hand is always the drop target.
    zones.add(zoneKey({ kind: 'hand', playerId: source.playerId }));
    return zones;
  }

  // hand-card
  const card = player.hand.find((c) => c.instanceId === source.instanceId);
  if (!card || !canPlayCardFromHand(state, source.playerId, card)) return zones;

  if (card.type === 'Apex') {
    player.apexSlots.forEach((slot, i) => {
      if (slot === null) zones.add(zoneKey({ kind: 'apex-slot', playerId: source.playerId, slotIndex: i }));
    });
  } else if (card.type === 'AbilitySupport') {
    // Commit 30.3 - two distinct legal destinations, two distinct outcomes:
    // an empty Engine slot plays it unchained, while dropping directly onto
    // a friendly Apex auto-chains it to that Apex. Mirrors chainSupport's own
    // validation for which Apexes are legal chain targets (not already
    // chained to a different Ability Support).
    player.supportSlots.forEach((slot, i) => {
      if (slot === null) zones.add(zoneKey({ kind: 'support-slot', playerId: source.playerId, slotIndex: i }));
    });
    const alreadyChainedTo = new Set(player.supportSlots.filter((s) => s?.type === 'AbilitySupport' && s.chainedApexId).map((s) => s!.chainedApexId));
    player.apexSlots.forEach((a) => {
      if (a && !alreadyChainedTo.has(a.instanceId)) zones.add(zoneKey({ kind: 'own-apex', playerId: source.playerId, instanceId: a.instanceId }));
    });
  } else if (card.type === 'BatterySupport') {
    player.supportSlots.forEach((slot, i) => {
      if (slot === null) zones.add(zoneKey({ kind: 'support-slot', playerId: source.playerId, slotIndex: i }));
    });
  } else if (card.type === 'Equip') {
    player.apexSlots.forEach((a) => {
      if (!a) return;
      const freshAttach = !a.equip;
      const legalSwap = !!a.equip && a.equip.equippedTurn !== state.turnNumber && !player.turnFlags.equipSwapUsedThisTurn;
      if (freshAttach || legalSwap) zones.add(zoneKey({ kind: 'own-apex', playerId: source.playerId, instanceId: a.instanceId }));
    });
  } else if (card.type === 'Special') {
    // Commit 31.5 - every Special now plays into the Action Zone first,
    // regardless of whether it needs a follow-up target - see
    // GameBoard.tsx's handleDragDrop for how a targeted Special enters
    // specialReady mode (reviving the existing click-to-target flow) after
    // landing here, instead of resolving immediately.
    zones.add(zoneKey({ kind: 'action-zone', playerId: source.playerId }));
  }

  return zones;
}

export interface DropResolution {
  ok: boolean;
  reason?: string;
}

/** actions is the exact same store-action bundle GameBoard.tsx already reads
 *  from useGameStore() - passed in rather than imported directly so this stays
 *  a pure function callable from tests without a live store.
 *
 *  Deliberately does NOT resolve 'apex-attack' drags - declaring an attack
 *  needs the same Overdrive-eligibility check the existing click flow
 *  (oppApexClick in GameBoard.tsx) already makes before calling
 *  declareAttack, and that's real UI-mode logic this pure function has no
 *  business owning. GameBoard.tsx's drop handler checks legalZonesFor
 *  directly for attack-target legality, then reuses the exact same overdrive
 *  check the click flow already has. */
export function resolveDrop(
  state: GameState,
  source: DragSource,
  target: DropZoneId,
  actions: {
    playApexCard: (id: string, slotIndex?: number) => void;
    playSupportCard: (id: string, slotIndex?: number, chainedApexId?: string) => void;
    playEquipCard: (id: string, apexId: string) => void;
    equipSwap: (apexId: string, newCardId: string) => void;
    playSpecialCard: (id: string, targetId?: string) => void;
    returnEquipToHand?: (equipId: string) => void;
    returnEngineToHand?: (supportId: string) => void;
  }
): DropResolution {
  const legal = legalZonesFor(state, source);
  if (!legal.has(zoneKey(target))) return { ok: false, reason: 'Not a legal destination for this card right now.' };
  if (source.kind === 'apex-attack') return { ok: false, reason: 'Attack drops are resolved separately.' };

  // Commit 52 - dragging a board Equip/Engine back to hand. These sources have
  // no hand card; they act on a board card and only target the hand zone.
  if (source.kind === 'board-equip') {
    if (target.kind !== 'hand') return { ok: false, reason: 'Drop it into your hand to pull it back.' };
    actions.returnEquipToHand?.(source.instanceId);
    return { ok: true };
  }
  if (source.kind === 'board-engine') {
    if (target.kind !== 'hand') return { ok: false, reason: 'Drop it into your hand to pull it back.' };
    actions.returnEngineToHand?.(source.instanceId);
    return { ok: true };
  }

  const player = state.players[source.playerId];
  const card = player.hand.find((c) => c.instanceId === source.instanceId) as CardInstance | undefined;
  if (!card) return { ok: false, reason: 'Card no longer in hand.' };

  if (target.kind === 'apex-slot') {
    actions.playApexCard(source.instanceId, target.slotIndex);
    return { ok: true };
  }
  if (target.kind === 'support-slot') {
    // Commit 30.2 - always play unchained, regardless of card type. A real,
    // reported mismatch: dragging an AbilitySupport used to auto-chain when
    // exactly one friendly Apex existed, while clicking the same card always
    // defaulted to playing unchained - two input methods producing two
    // different real game outcomes for the identical action. Chaining
    // afterward is already fully supported once the Engine is in play (see
    // ownSupportClick's rechainSelectApex mode in GameBoard.tsx) - unaffected
    // by any of this, since it's a separate input path entirely.
    // Commit 30.3: this branch is specifically the Engine-slot drop, which
    // always plays unchained by design (the "chain immediately" version is
    // the own-apex branch below, for AbilitySupport dragged straight onto an
    // Apex instead of an empty slot - two different targets, two different,
    // intentional outcomes).
    actions.playSupportCard(source.instanceId, target.slotIndex);
    return { ok: true };
  }
  if (target.kind === 'own-apex' && target.instanceId) {
    if (card.type === 'Equip') {
      // Commit 30.3 - the actual reported bug fix: playEquipCard silently
      // rejects if the target Apex already has an Equip attached (a fresh
      // attach is a completely different real action from a swap). Drag onto
      // an Apex that already has one now correctly routes to equipSwap
      // instead - the old Equip returns to hand, the new one attaches - per
      // the requested flow: drag the new Equip onto the old one (or the Apex
      // wearing it) and it swaps automatically.
      const targetApex = player.apexSlots.find((a) => a?.instanceId === target.instanceId);
      if (targetApex?.equip) {
        actions.equipSwap(target.instanceId, source.instanceId);
      } else {
        actions.playEquipCard(source.instanceId, target.instanceId);
      }
      return { ok: true };
    }
    if (card.type === 'Special') {
      actions.playSpecialCard(source.instanceId, target.instanceId);
      return { ok: true };
    }
    if (card.type === 'AbilitySupport') {
      // Commit 30.3 - dragging an Ability Engine directly onto an Apex plays
      // it chained to that Apex immediately, per the requested flow ("drag it
      // onto the Apex and it'll auto-chain").
      actions.playSupportCard(source.instanceId, undefined, target.instanceId);
      return { ok: true };
    }
  }
  if (target.kind === 'enemy-apex' && target.instanceId && card.type === 'Special') {
    actions.playSpecialCard(source.instanceId, target.instanceId);
    return { ok: true };
  }
  if (target.kind === 'action-zone' && card.type === 'Special') {
    actions.playSpecialCard(source.instanceId);
    return { ok: true };
  }

  return { ok: false, reason: 'Not a legal destination for this card right now.' };
}
