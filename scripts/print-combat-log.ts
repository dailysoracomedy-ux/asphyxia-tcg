/* Prints a real combat sequence's log lines so the exact wording can be eyeballed. */
import { useGameStore } from '@/store/gameStore';
import { getCardDef } from '@/data/cards';
import { getEligibleResponses } from '@/game/rules';
import type { PendingResponseItem, PlayerId, ResponseEvent, GameState } from '@/types/game';

function eventForItem(item: PendingResponseItem) {
  if (item.stage === 'reactionChoice') {
    const t = item.trigger;
    if (t.kind === 'enemyApexAttacks') return { respondingPlayerId: item.respondingPlayerId, event: { kind: 'ATTACK_DECLARED', data: t } as ResponseEvent };
    if (t.kind === 'opponentAttackDealsO2Damage') return { respondingPlayerId: item.respondingPlayerId, event: { kind: 'O2_DAMAGE_PENDING', data: t } as ResponseEvent };
    if (t.kind === 'ownApexWouldBeDestroyed') return { respondingPlayerId: item.respondingPlayerId, event: { kind: 'APEX_WOULD_BE_DESTROYED', data: t } as ResponseEvent };
  }
  if (item.stage === 'negateWindow') {
    const kind = item.cardType === 'Special' ? 'SPECIAL_PLAYED' : item.cardType === 'Equip' ? 'EQUIP_PLAYED' : 'REACTION_PLAYED';
    return { respondingPlayerId: item.negatingPlayerId, event: { kind, data: { cardType: item.cardType, cardFaction: item.cardFaction, cardOwnerId: item.cardOwnerId, cardInstanceId: item.cardInstanceId } } as ResponseEvent };
  }
  return null;
}
function resolvePending() {
  const s = useGameStore.getState();
  const item = s.pendingResponseQueue[0];
  if (!item) return false;
  if (item.stage === 'reactionChoice' || item.stage === 'negateWindow') {
    const built = eventForItem(item)!;
    const eligible = getEligibleResponses(s as unknown as GameState, built.respondingPlayerId, built.event);
    const respondType = item.stage === 'reactionChoice' ? 'reaction' : 'negate';
    if (eligible.length > 0 && Math.random() < 0.5) s.resolveResponse({ type: respondType, cardInstanceId: eligible[0].instanceId } as never);
    else s.resolveResponse({ type: 'pass' });
  } else if (item.stage === 'humanErrorChoice') s.resolveResponse({ type: 'humanError', pick: 'momentum' });
  else if (item.stage === 'civilWarChoice') s.resolveResponse({ type: 'civilWar', pick: 'momentum' });
  return true;
}
function rand<T>(arr: T[]): T | undefined { return arr.length === 0 ? undefined : arr[Math.floor(Math.random() * arr.length)]; }

const s = useGameStore.getState();
s.startNewGame('Dark White', 'Neon Underground');
let guard = 0;
while (useGameStore.getState().status === 'selectingOpeningApex' && guard < 5) {
  guard += 1;
  const st = useGameStore.getState();
  const pid = st.openingApexSelectionPlayerId!;
  const apex = st.players[pid].hand.find((c) => c.type === 'Apex')!;
  st.selectOpeningApex(pid, apex.instanceId);
}

let turns = 0;
while (useGameStore.getState().status === 'playing' && turns < 40) {
  const st = useGameStore.getState();
  if (st.pendingResponseQueue.length > 0) { resolvePending(); continue; }
  if (st.phase === 'Start' && st.startPhasePending) { st.advancePhase('Start'); continue; }
  if (st.phase === 'Start') { st.advancePhase('Main'); continue; }
  if (st.phase === 'Main') {
    const pid = st.activePlayerId;
    let g = 0;
    while (g < 15) {
      g += 1;
      const st2 = useGameStore.getState();
      if (st2.pendingResponseQueue.length > 0) { resolvePending(); continue; }
      const player = st2.players[pid];
      const card = rand(player.hand);
      if (!card) break;
      const def = getCardDef(card.defId);
      if (def.type === 'Apex') st2.playApexCard(card.instanceId);
      else if (def.type === 'AbilitySupport') { const apex = rand(player.apexSlots.filter(Boolean)); if (apex) st2.playSupportCard(card.instanceId, undefined, apex.instanceId); }
      else if (def.type === 'BatterySupport') st2.playSupportCard(card.instanceId);
      else if (def.type === 'Equip') { const apex = rand(player.apexSlots.filter((a) => a && !a.equip)); if (apex) st2.playEquipCard(card.instanceId, apex.instanceId); }
      else if (def.type === 'Special') {
        const oppId: PlayerId = pid === 'player1' ? 'player2' : 'player1';
        const opp = useGameStore.getState().players[oppId];
        let target: string | undefined;
        if (def.requiresTarget === 'enemyApex') target = rand(opp.apexSlots.filter(Boolean))?.instanceId;
        else if (def.requiresTarget === 'ownApex') target = rand(player.apexSlots.filter(Boolean))?.instanceId;
        if (!def.requiresTarget || target) st2.playSpecialCard(card.instanceId, target);
      }
    }
    st.advancePhase('Combat');
    continue;
  }
  if (st.phase === 'Combat') {
    const pid = st.activePlayerId;
    const oppId: PlayerId = pid === 'player1' ? 'player2' : 'player1';
    let g = 0;
    let anyDestroyed = false;
    while (g < 6) {
      g += 1;
      const st2 = useGameStore.getState();
      if (st2.pendingResponseQueue.length > 0) { resolvePending(); continue; }
      const player = st2.players[pid];
      const opp = st2.players[oppId];
      const attacker = rand(player.apexSlots.filter((a) => a && !a.hasAttacked));
      if (!attacker) break;
      const apexDef = getCardDef(attacker.defId);
      if (apexDef.type !== 'Apex') break;
      const affordable = apexDef.attacks.filter((a) => a.syncCost <= player.availableSync);
      const attack = rand(affordable);
      if (!attack) break;
      const target = opp.apexSlots.some(Boolean) ? rand(opp.apexSlots.filter(Boolean))?.instanceId : undefined;
      st2.declareAttack(attacker.instanceId, attack.id, target);
      while (useGameStore.getState().pendingResponseQueue.length > 0) resolvePending();
      if (useGameStore.getState().log.some((l) => l.kind === 'destroy')) anyDestroyed = true;
    }
    turns += 1;
    if (anyDestroyed && turns > 3) {
      // Found a turn with a destruction - print its log and stop.
      const log = useGameStore.getState().log;
      const startIdx = Math.max(0, log.length - 20);
      console.log(`\n=== Sample combat log (turn ${turns}) ===`);
      for (const l of log.slice(startIdx)) console.log(`[T${l.turn}][${l.kind}] ${l.message}`);
      process.exit(0);
    }
    useGameStore.getState().endTurn();
    continue;
  }
}
console.log('No destruction found in this run - re-run for another sample.');
