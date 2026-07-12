import type { CardInstance, GameState, PlayerId, SpecialDef } from '@/types/game';
import { getCardDef } from '@/data/cards';
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

  // hand-card
  const card = player.hand.find((c) => c.instanceId === source.instanceId);
  if (!card || !canPlayCardFromHand(state, source.playerId, card)) return zones;
  const def = getCardDef(card.defId);

  if (card.type === 'Apex') {
    player.apexSlots.forEach((slot, i) => {
      if (slot === null) zones.add(zoneKey({ kind: 'apex-slot', playerId: source.playerId, slotIndex: i }));
    });
  } else if (card.type === 'AbilitySupport' || card.type === 'BatterySupport') {
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
    const sdef = def as SpecialDef;
    if (!sdef.requiresTarget) {
      zones.add(zoneKey({ kind: 'action-zone', playerId: source.playerId }));
    } else if (sdef.requiresTarget === 'ownApex' || sdef.requiresTarget === 'ownApexWithUpgrade') {
      player.apexSlots.forEach((a) => {
        if (a) zones.add(zoneKey({ kind: 'own-apex', playerId: source.playerId, instanceId: a.instanceId }));
      });
    } else if (sdef.requiresTarget === 'enemyApex' || sdef.requiresTarget === 'enemyApexWithChoke') {
      opponent.apexSlots.forEach((a) => {
        if (!a) return;
        if (sdef.requiresTarget === 'enemyApexWithChoke' && (a.counters?.choke ?? 0) === 0) return;
        zones.add(zoneKey({ kind: 'enemy-apex', playerId: opponentId, instanceId: a.instanceId }));
      });
    }
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
    playSpecialCard: (id: string, targetId?: string) => void;
  }
): DropResolution {
  const legal = legalZonesFor(state, source);
  if (!legal.has(zoneKey(target))) return { ok: false, reason: 'Not a legal destination for this card right now.' };
  if (source.kind === 'apex-attack') return { ok: false, reason: 'Attack drops are resolved separately.' };

  const player = state.players[source.playerId];
  const card = player.hand.find((c) => c.instanceId === source.instanceId) as CardInstance | undefined;
  if (!card) return { ok: false, reason: 'Card no longer in hand.' };

  if (target.kind === 'apex-slot') {
    actions.playApexCard(source.instanceId, target.slotIndex);
    return { ok: true };
  }
  if (target.kind === 'support-slot') {
    if (card.type === 'AbilitySupport') {
      // Auto-chain only when there's exactly one friendly Apex to chain to -
      // a real, unambiguous choice. Otherwise play unchained; the existing
      // click flow (select the Support afterward) remains available for a
      // player who wants to choose a chain explicitly.
      const apexes = player.apexSlots.filter((a): a is CardInstance => !!a);
      const chainTarget = apexes.length === 1 ? apexes[0].instanceId : undefined;
      actions.playSupportCard(source.instanceId, target.slotIndex, chainTarget);
    } else {
      actions.playSupportCard(source.instanceId, target.slotIndex);
    }
    return { ok: true };
  }
  if (target.kind === 'own-apex' && target.instanceId) {
    if (card.type === 'Equip') {
      actions.playEquipCard(source.instanceId, target.instanceId);
      return { ok: true };
    }
    if (card.type === 'Special') {
      actions.playSpecialCard(source.instanceId, target.instanceId);
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
