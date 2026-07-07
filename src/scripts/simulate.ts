/* Headless simulation harness - drives the real Zustand store with randomized legal-ish
   actions to shake out runtime crashes and check core invariants. Not a UI test. */
import { useGameStore } from '../store/gameStore';
import { getCardDef } from '../data/cards';
import { getEligibleResponses, MAX_O2, MAX_MOMENTUM } from '../game/rules';
import type { Faction, GameState, PendingResponseItem, PlayerId, ResponseEvent } from '../types/game';

const FACTIONS: Faction[] = ['Neon Underground', 'Dark White', 'Synth Ascendancy'];

function rand<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

function totalCards(playerId: PlayerId): number {
  const p = useGameStore.getState().players[playerId];
  const equips = p.apexSlots.filter(Boolean).reduce((n, a) => n + (a!.equip ? 1 : 0), 0);
  return p.deck.length + p.hand.length + p.discard.length + p.apexSlots.filter(Boolean).length + p.supportSlots.filter(Boolean).length + equips;
}

/** Builds the same ResponseEvent shape the real engine uses, from a pending queue item -
 *  so the simulator asks getEligibleResponses the exact question the UI would ask, instead
 *  of re-deriving eligibility itself (which could silently drift from the real rules). */
function eventForItem(item: PendingResponseItem): { respondingPlayerId: PlayerId; event: ResponseEvent } | null {
  if (item.stage === 'reactionChoice') {
    const t = item.trigger;
    if (t.kind === 'enemyApexAttacks') return { respondingPlayerId: item.respondingPlayerId, event: { kind: 'ATTACK_DECLARED', data: t } };
    if (t.kind === 'opponentAttackDealsO2Damage')
      return { respondingPlayerId: item.respondingPlayerId, event: { kind: 'O2_DAMAGE_PENDING', data: t } };
    if (t.kind === 'ownApexWouldBeDestroyed')
      return { respondingPlayerId: item.respondingPlayerId, event: { kind: 'APEX_WOULD_BE_DESTROYED', data: t } };
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

function resolvePending(): boolean {
  const s = useGameStore.getState();
  const item = s.pendingResponseQueue[0];
  if (!item) return false;

  if (item.stage === 'reactionChoice' || item.stage === 'negateWindow') {
    const built = eventForItem(item);
    const eligible = built ? getEligibleResponses(s as unknown as GameState, built.respondingPlayerId, built.event) : [];

    // Sanity check: getCardDef must agree these are actually Reaction/Negate cards (never Specials/Equips).
    for (const c of eligible) {
      const def = getCardDef(c.defId);
      if (item.stage === 'reactionChoice' && def.type !== 'Reaction') {
        throw new Error(`getEligibleResponses returned a non-Reaction card (${def.type}) for a reactionChoice window`);
      }
      if (item.stage === 'negateWindow' && def.type !== 'Negate') {
        throw new Error(`getEligibleResponses returned a non-Negate card (${def.type}) for a negateWindow`);
      }
    }

    const respondType = item.stage === 'reactionChoice' ? 'reaction' : 'negate';
    if (eligible.length > 0 && Math.random() < (item.stage === 'reactionChoice' ? 0.6 : 0.5)) {
      s.resolveResponse({ type: respondType, cardInstanceId: eligible[0].instanceId } as never);
    } else {
      s.resolveResponse({ type: 'pass' });
    }
  } else if (item.stage === 'humanErrorChoice') {
    s.resolveResponse({ type: 'humanError', pick: Math.random() < 0.5 ? 'momentum' : 'damage' });
  } else if (item.stage === 'alleyWraithChoice') {
    s.resolveResponse(Math.random() < 0.5 ? { type: 'alleyWraithCancel' } : { type: 'alleyWraithDecline' });
  }
  return true;
}

function playMainPhaseActions() {
  const s = useGameStore.getState();
  const pid = s.activePlayerId;
  let guard = 0;
  while (guard < 20) {
    guard += 1;
    const st = useGameStore.getState();
    if (st.pendingResponseQueue.length > 0) {
      resolvePending();
      continue;
    }
    const player = st.players[pid];
    // random chance to stop playing more cards this turn
    if (Math.random() < 0.35) break;

    const playable = [...player.hand];
    const card = rand(playable);
    if (!card) break;
    const def = getCardDef(card.defId);

    try {
      if (def.type === 'Apex') {
        st.playApexCard(card.instanceId);
      } else if (def.type === 'AbilitySupport') {
        const apex = rand(player.apexSlots.filter(Boolean));
        if (apex) st.playSupportCard(card.instanceId, undefined, apex.instanceId);
      } else if (def.type === 'BatterySupport') {
        st.playSupportCard(card.instanceId);
      } else if (def.type === 'Equip') {
        const apex = rand(player.apexSlots.filter((a) => a && !a.equip));
        if (apex) st.playEquipCard(card.instanceId, apex.instanceId);
      } else if (def.type === 'Special') {
        let target: string | undefined;
        const oppId: PlayerId = pid === 'player1' ? 'player2' : 'player1';
        const opp = useGameStore.getState().players[oppId];
        if (def.requiresTarget === 'enemyApex') target = rand(opp.apexSlots.filter(Boolean))?.instanceId;
        else if (def.requiresTarget === 'enemyApexWithChoke')
          target = rand(opp.apexSlots.filter((a) => a && (a.counters?.choke ?? 0) > 0))?.instanceId;
        else if (def.requiresTarget === 'ownApex') target = rand(player.apexSlots.filter(Boolean))?.instanceId;
        else if (def.requiresTarget === 'ownApexWithUpgrade')
          target = rand(player.apexSlots.filter((a) => a && (a.counters?.upgrade ?? 0) > 0))?.instanceId;
        if (!def.requiresTarget || target) st.playSpecialCard(card.instanceId, target);
      }
      // Reaction/Negate not played from hand directly - skip
    } catch (e) {
      console.error('CRASH during main phase action', def.type, def.id, e);
      throw e;
    }
  }

  // occasionally try a reconfigure
  if (Math.random() < 0.4) {
    const st = useGameStore.getState();
    const player = st.players[pid];
    const support = rand(player.supportSlots.filter(Boolean));
    if (support && !player.turnFlags.reconfigureUsedThisTurn) {
      try {
        st.reconfigure(support.instanceId);
      } catch (e) {
        console.error('CRASH during reconfigure', e);
        throw e;
      }
    }
  }
}

function playCombatPhaseActions() {
  const s = useGameStore.getState();
  const pid = s.activePlayerId;
  const oppId: PlayerId = pid === 'player1' ? 'player2' : 'player1';
  let guard = 0;
  while (guard < 10) {
    guard += 1;
    const st = useGameStore.getState();
    if (st.pendingResponseQueue.length > 0) {
      resolvePending();
      continue;
    }
    const player = st.players[pid];
    const opp = st.players[oppId];
    const attacker = rand(player.apexSlots.filter((a) => a && !a.hasAttacked && a.attackLockedForTurn !== st.turnNumber));
    if (!attacker) break;
    const apexDef = getCardDef(attacker.defId);
    if (apexDef.type !== 'Apex') break;
    const affordable = apexDef.attacks.filter((a) => a.syncCost <= player.availableSync);
    const attack = rand(affordable);
    if (!attack) break;
    const oppHasApex = opp.apexSlots.some(Boolean);
    const target = oppHasApex ? rand(opp.apexSlots.filter(Boolean))?.instanceId : undefined;
    try {
      st.declareAttack(attacker.instanceId, attack.id, target);
    } catch (e) {
      console.error('CRASH during declareAttack', attack.id, e);
      throw e;
    }
    // clear any response windows this attack opened
    while (useGameStore.getState().pendingResponseQueue.length > 0) resolvePending();
  }
}

function runOneGame(f1: Faction, f2: Faction, maxTurns: number): { turns: number; winner: PlayerId | null } {
  const s = useGameStore.getState();
  s.resetToMenu();
  s.startNewGame(f1, f2);

  // Opening apex selection
  let guard = 0;
  while (useGameStore.getState().status === 'selectingOpeningApex' && guard < 10) {
    guard += 1;
    const st = useGameStore.getState();
    const pid = st.openingApexSelectionPlayerId!;
    const apexCard = rand(st.players[pid].hand.filter((c) => c.type === 'Apex'));
    if (!apexCard) throw new Error('No apex in opening hand - mulligan loop failed');
    st.selectOpeningApex(pid, apexCard.instanceId);
  }

  let turns = 0;
  while (useGameStore.getState().status === 'playing' && turns < maxTurns) {
    const st = useGameStore.getState();
    if (st.pendingResponseQueue.length > 0) {
      resolvePending();
      continue;
    }
    if (st.phase === 'Start' && st.startPhasePending) {
      st.advancePhase('Start');
      continue;
    }
    if (st.phase === 'Start' && !st.startPhasePending) {
      st.advancePhase('Main');
      continue;
    }
    if (st.phase === 'Main') {
      playMainPhaseActions();
      // verify card conservation after main phase actions
      for (const pid of ['player1', 'player2'] as PlayerId[]) {
        if (totalCards(pid) !== 30) {
          throw new Error(`Card conservation broken for ${pid}: has ${totalCards(pid)} expected 30`);
        }
      }
      assertSaneNumbers(`${st.activePlayerId} end of Main Phase turn ${st.turnNumber}`);
      useGameStore.getState().advancePhase('Combat');
      continue;
    }
    if (st.phase === 'Combat') {
      playCombatPhaseActions();
      turns += 1;
      useGameStore.getState().endTurn();
      continue;
    }
  }

  const finalState = useGameStore.getState();
  return { turns, winner: finalState.winnerId };
}

function assertSaneNumbers(label: string) {
  const s = useGameStore.getState();
  for (const pid of ['player1', 'player2'] as PlayerId[]) {
    const p = s.players[pid];
    if (!Number.isFinite(p.o2) || p.o2 < 0) throw new Error(`${label}: ${pid} has invalid O2 = ${p.o2}`);
    if (p.o2 > MAX_O2) throw new Error(`${label}: ${pid} has O2 above the ${MAX_O2} cap = ${p.o2}`);
    if (!Number.isFinite(p.momentum) || p.momentum < 0) throw new Error(`${label}: ${pid} has invalid Momentum = ${p.momentum}`);
    if (p.momentum > MAX_MOMENTUM) throw new Error(`${label}: ${pid} has Momentum above the ${MAX_MOMENTUM} cap = ${p.momentum}`);
    if (!Number.isFinite(p.availableSync) || p.availableSync < 0) throw new Error(`${label}: ${pid} has invalid Sync = ${p.availableSync}`);
    if (p.turnFlags.specialsPlayedThisTurn > 1) throw new Error(`${label}: ${pid} played more than 1 Special this turn`);
    if (p.turnFlags.supportsPlayedThisTurn > 1) throw new Error(`${label}: ${pid} played more than 1 Support this turn`);
    if (p.turnFlags.instantsPlayedThisTurn > 1) throw new Error(`${label}: ${pid} played more than 1 instant-speed card this turn`);
    const abilitySupportApexIds = p.supportSlots.filter((s) => s?.type === 'AbilitySupport' && s.chainedApexId).map((s) => s!.chainedApexId);
    if (new Set(abilitySupportApexIds).size !== abilitySupportApexIds.length) {
      throw new Error(`${label}: ${pid} has two Ability Supports chained to the same Apex`);
    }
    for (const apex of p.apexSlots) {
      if (!apex) continue;
      if (apex.counters) {
        for (const key of ['choke', 'upgrade', 'glitch'] as const) {
          if (!Number.isFinite(apex.counters[key]) || apex.counters[key] < 0) {
            throw new Error(`${label}: ${pid} apex ${apex.defId} has invalid ${key} counter = ${apex.counters[key]}`);
          }
        }
        if (apex.counters.glitch > 3) throw new Error(`${label}: glitch counter exceeded max on ${apex.defId}`);
      }
    }
  }
}

function main() {
  let gamesRun = 0;
  let crashed = 0;
  const results: string[] = [];

  for (const f1 of FACTIONS) {
    for (const f2 of FACTIONS) {
      for (let i = 0; i < 8; i++) {
        gamesRun += 1;
        try {
          const { turns, winner } = runOneGame(f1, f2, 150);
          assertSaneNumbers(`${f1} vs ${f2} [run ${i}] post-game`);
          results.push(`${f1} vs ${f2} [run ${i}]: ${turns} turns, winner=${winner ?? 'none/timeout'}`);
        } catch (e) {
          crashed += 1;
          console.error(`\n!!! GAME CRASHED: ${f1} vs ${f2} [run ${i}] !!!`);
          console.error(e);
        }
      }
    }
  }

  console.log('\n=== SIMULATION SUMMARY ===');
  for (const r of results) console.log(r);
  console.log(`\nGames run: ${gamesRun}, crashed: ${crashed}`);
  if (crashed > 0) {
    process.exitCode = 1;
  }
}

main();
