import { useGameStore, type ResponseChoice } from '@/store/gameStore';
import { getCardDef } from '@/data/cards';
import {
  getAttackOutcomePreview,
  MAX_ABILITY_SUPPORTS,
  MAX_MOMENTUM,
  getEligibleResponses,
  getOverdriveEligibility,
  directDamageToO2Loss,
  overflowToO2Loss,
} from '@/game/rules';
import type { PlayerId, CardInstance, ApexDef, PendingResponseItem, ResponseEvent } from '@/types/game';

function eventForItem(item: PendingResponseItem): { respondingPlayerId: PlayerId; event: ResponseEvent } | null {
  if (item.stage === 'reactionChoice') {
    const t = item.trigger;
    if (t.kind === 'enemyApexAttacks') return { respondingPlayerId: item.respondingPlayerId, event: { kind: 'ATTACK_DECLARED', data: t } };
    if (t.kind === 'opponentAttackDealsO2Damage') return { respondingPlayerId: item.respondingPlayerId, event: { kind: 'O2_DAMAGE_PENDING', data: t } };
    if (t.kind === 'ownApexWouldBeDestroyed') return { respondingPlayerId: item.respondingPlayerId, event: { kind: 'APEX_WOULD_BE_DESTROYED', data: t } };
  }
  if (item.stage === 'negateWindow') {
    const kind = item.cardType === 'Special' ? 'SPECIAL_PLAYED' : item.cardType === 'Equip' ? 'EQUIP_PLAYED' : 'REACTION_PLAYED';
    return {
      respondingPlayerId: item.negatingPlayerId,
      event: {
        kind,
        data: { cardType: item.cardType, cardFaction: item.cardFaction, cardOwnerId: item.cardOwnerId, cardInstanceId: item.cardInstanceId },
      } as ResponseEvent,
    };
  }
  return null;
}

/**
 * Simple, functional (not strong) AI. Every decision funnels through the exact same
 * store actions a human uses (playApexCard, declareAttack, resolveResponse, etc.) -
 * the AI never bypasses legality checks or duplicates combat math; it just picks
 * which legal action to take using greedy heuristics.
 */

function opponentOf(playerId: PlayerId): PlayerId {
  return playerId === 'player1' ? 'player2' : 'player1';
}

/** Attempts exactly one Main Phase action for the AI (priority: Apex > Support >
 *  Equip > Special). Returns true if it did something, false if there's nothing
 *  useful left to do (caller should move on to Combat). */
export function aiPlayOneMainPhaseAction(playerId: PlayerId): boolean {
  const store = useGameStore.getState();
  const player = store.players[playerId];
  if (store.status !== 'playing' || store.phase !== 'Main' || store.pendingResponseQueue.length > 0) return false;

  // 1. Play an Apex into an empty slot if one is available.
  const emptyApexSlot = player.apexSlots.findIndex((s) => s === null);
  if (emptyApexSlot !== -1) {
    const apexCard = player.hand.find((c) => c.type === 'Apex');
    if (apexCard) {
      store.playApexCard(apexCard.instanceId, emptyApexSlot);
      return true;
    }
  }

  // 2. Play one Support (once per turn), preferring a chained Ability Support.
  if (player.turnFlags.supportsPlayedThisTurn === 0 && player.supportSlots.some((s) => s === null)) {
    const abilityCount = player.supportSlots.filter((s) => s?.type === 'AbilitySupport').length;
    const supportCard = player.hand.find((c) => {
      if (c.type === 'BatterySupport') return true;
      if (c.type === 'AbilitySupport') return abilityCount < MAX_ABILITY_SUPPORTS;
      return false;
    });
    if (supportCard) {
      if (supportCard.type === 'AbilitySupport') {
        const chainTarget = player.apexSlots.find(
          (a) => a && !player.supportSlots.some((s) => s?.type === 'AbilitySupport' && s.chainedApexId === a.instanceId)
        );
        store.playSupportCard(supportCard.instanceId, undefined, chainTarget ? chainTarget.instanceId : undefined);
      } else {
        store.playSupportCard(supportCard.instanceId);
      }
      return true;
    }
  }

  // 3. Equip an Apex that doesn't already have one.
  const equipCard = player.hand.find((c) => c.type === 'Equip');
  if (equipCard) {
    const target = [...player.apexSlots].filter((a): a is CardInstance => !!a && !a.equip).sort((a, b) => a.instanceId.localeCompare(b.instanceId))[0];
    if (target) {
      store.playEquipCard(equipCard.instanceId, target.instanceId);
      return true;
    }
  }

  // 4. Play a Special (once per turn) if it has a legal target or needs none.
  if (player.turnFlags.specialsPlayedThisTurn === 0) {
    const specialCard = player.hand.find((c) => c.type === 'Special');
    if (specialCard) {
      const def = getCardDef(specialCard.defId);
      if (def.type === 'Special') {
        if (!def.requiresTarget) {
          store.playSpecialCard(specialCard.instanceId);
          return true;
        }
        const opponent = store.players[opponentOf(playerId)];
        let targetId: string | undefined;
        if (def.requiresTarget === 'enemyApex') targetId = opponent.apexSlots.find(Boolean)?.instanceId;
        else if (def.requiresTarget === 'enemyApexWithChoke') targetId = opponent.apexSlots.find((a) => a && (a.counters?.choke ?? 0) > 0)?.instanceId;
        else if (def.requiresTarget === 'ownApex') targetId = player.apexSlots.find(Boolean)?.instanceId;
        else if (def.requiresTarget === 'ownApexWithUpgrade') targetId = player.apexSlots.find((a) => a && (a.counters?.upgrade ?? 0) > 0)?.instanceId;
        if (targetId) {
          store.playSpecialCard(specialCard.instanceId, targetId);
          return true;
        }
      }
    }
  }

  return false;
}

interface AttackCandidate {
  score: number;
  attackerId: string;
  attackId: string;
  targetId?: string;
}

/** Attempts exactly one Combat Phase attack for the AI, picking the single best
 *  (attacker, attack, target) combination across all legal options. Returns true if
 *  it attacked, false if nothing useful/legal remains (caller should end the turn). */
export function aiPlayOneCombatAction(playerId: PlayerId): boolean {
  const store = useGameStore.getState();
  if (store.status !== 'playing' || store.phase !== 'Combat' || store.pendingResponseQueue.length > 0) return false;
  if (store.isFirstTurnOverall && store.firstPlayerId === playerId) return false;

  const player = store.players[playerId];
  const oppId = opponentOf(playerId);
  const opponent = store.players[oppId];
  const availableSync = player.availableSync;
  const enemyApexes = opponent.apexSlots.filter((a): a is CardInstance => !!a);

  const candidates: AttackCandidate[] = [];

  for (const apex of player.apexSlots) {
    if (!apex || apex.hasAttacked) continue;
    const def = getCardDef(apex.defId);
    if (def.type !== 'Apex') continue;
    const apexDef = def as ApexDef;
    for (const atk of apexDef.attacks) {
      if (atk.syncCost > availableSync) continue;

      const targets: (string | undefined)[] = enemyApexes.length > 0 ? enemyApexes.map((a) => a.instanceId) : [undefined];
      for (const targetId of targets) {
        const preview = getAttackOutcomePreview(store, apex.instanceId, atk.id, targetId);
        if (!preview) continue;

        let score = 0;
        const wouldBeLethal = preview.isDirect
          ? opponent.o2 - preview.o2Loss <= 0
          : preview.willDestroy && opponent.o2 - preview.o2Loss <= 0;

        if (wouldBeLethal) score = 10000;
        else if (preview.willDestroy && preview.overflow > 0) score = 500 + preview.overflow;
        else if (preview.willDestroy) score = 300;
        else if (!preview.isDirect) score = 50 + preview.finalDamage / 100;
        else score = 10 + preview.o2Loss * 5;

        candidates.push({ score, attackerId: apex.instanceId, attackId: atk.id, targetId });
      }
    }
  }

  if (candidates.length === 0) return false;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best.score <= 0) return false;

  const overdriveSpend = aiDecideOverdrive(store, best);
  store.declareAttack(best.attackerId, best.attackId, best.targetId, overdriveSpend);
  return true;
}

/** Simplified Overdrive heuristic (per spec's "if too complex" fallback): Spark-Plug
 *  spends only if the extra +100 damage would flip a non-destroying attack into a
 *  destroying one, or turn a non-lethal hit into a lethal one. Juice-Box spends only
 *  when Momentum is already capped (otherwise saving it for something else is better). */
function aiDecideOverdrive(store: ReturnType<typeof useGameStore.getState>, candidate: AttackCandidate): boolean | undefined {
  const eligible = getOverdriveEligibility(store, candidate.attackerId);
  if (!eligible) return undefined;

  const activePlayer = store.players[store.activePlayerId];
  if (eligible.supportDefId === 'nu-juice-box') {
    return activePlayer.momentum >= MAX_MOMENTUM;
  }

  // Spark-Plug: compare the outcome with a hypothetical +100 against the current one.
  const preview = getAttackOutcomePreview(store, candidate.attackerId, candidate.attackId, candidate.targetId);
  if (!preview) return false;
  const oppId = opponentOf(store.activePlayerId);
  const opponent = store.players[oppId];

  if (preview.isDirect) {
    const currentLethal = opponent.o2 - preview.o2Loss <= 0;
    if (currentLethal) return false; // already lethal without spending
    const boostedO2Loss = Math.min(directDamageToO2Loss(preview.finalDamage + 100), 4 - opponent.turnFlags.directO2LossThisTurn);
    return opponent.o2 - boostedO2Loss <= 0;
  }

  if (preview.willDestroy) {
    if (preview.overflow <= 0) return false; // already a clean break, +100 only adds more overflow O2 loss, not worth it here
    const currentLethal = opponent.o2 - preview.o2Loss <= 0;
    if (currentLethal) return false;
    const boostedOverflow = preview.overflow + 100;
    return opponent.o2 - overflowToO2Loss(boostedOverflow) <= 0;
  }

  // Not currently destroying - would +100 flip it into a destroy?
  return preview.finalDamage + 100 >= (preview.targetDef ?? Infinity);
}

/** Decides the AI's Control Conflict lock choice at the start of its turn. Locks the
 *  first unchained (or otherwise least useful) Support if Momentum isn't already
 *  capped, otherwise skips straight to Main Phase. */
export function aiDecideControlConflict(playerId: PlayerId): void {
  const store = useGameStore.getState();
  const player = store.players[playerId];
  const supports = player.supportSlots.filter((s): s is CardInstance => !!s);
  const worthLocking = player.momentum < MAX_MOMENTUM && supports.length > 0;
  if (worthLocking) {
    const pick = [...supports].sort((a, b) => (a.chainedApexId ? 1 : 0) - (b.chainedApexId ? 1 : 0))[0];
    store.lockSupportControlConflict(pick.instanceId);
  }
  store.advancePhase('Main');
}

/** Decides a binary Civil War / Human Error style choice: prefer the attack bonus if
 *  the AI has an Apex that can plausibly attack this turn, otherwise take Momentum
 *  (unless Momentum is already capped, in which case take the attack bonus anyway). */
export function aiChooseBinaryRiftBonus(playerId: PlayerId): 'momentum' | 'damage' {
  const store = useGameStore.getState();
  const player = store.players[playerId];
  const hasAttacker = player.apexSlots.some((a) => a && !a.hasAttacked);
  if (player.momentum >= MAX_MOMENTUM) return 'damage';
  return hasAttacker ? 'damage' : 'momentum';
}

/** Decides how the AI responds to a reaction/negate window: uses a defensive card
 *  only for fairly obvious value (preventing lethal or a big O2 swing, saving an
 *  Apex from destruction, or canceling a Special/Reaction outright) - otherwise passes. */
export function aiChooseResponse(playerId: PlayerId, item: PendingResponseItem): ResponseChoice {
  const store = useGameStore.getState();
  if (item.stage !== 'reactionChoice' && item.stage !== 'negateWindow') return { type: 'pass' };

  // Reuse the exact same eligibility helper the human UI uses - no duplicated logic.
  const built = eventForItem(item);
  if (!built || built.respondingPlayerId !== playerId) return { type: 'pass' };

  const eligible = getEligibleResponses(store, playerId, built.event);
  if (eligible.length === 0) return { type: 'pass' };

  const player = store.players[playerId];
  const worthUsing = player.o2 <= 4 || player.apexSlots.some((a) => a && a.hasAttacked === false);
  if (!worthUsing) return { type: 'pass' };

  const choice = eligible[0];
  return item.stage === 'reactionChoice' ? { type: 'reaction', cardInstanceId: choice.instanceId } : { type: 'negate', cardInstanceId: choice.instanceId };
}
