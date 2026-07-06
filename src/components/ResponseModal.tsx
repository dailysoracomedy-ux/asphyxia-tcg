'use client';

import type { GameState, ReactionDef } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { useGameStore } from '@/store/gameStore';

function describeTrigger(state: GameState, item: GameState['pendingResponseQueue'][number]): string {
  if (item.stage !== 'reactionChoice') return '';
  const t = item.trigger;
  if (t.kind === 'enemyApexAttacks') {
    const attackerName = getCardDef(
      (state.players[t.attackerId].apexSlots.find((a) => a?.instanceId === t.attackerInstanceId) ?? { defId: '' }).defId ||
        'unknown'
    )?.name;
    return `Incoming attack from ${attackerName ?? 'enemy Apex'} for ${t.totalDamage} damage.`;
  }
  if (t.kind === 'opponentAttackDealsO2Damage') {
    return `This attack would deal ${t.amount} O2 damage${t.isOverflow ? ' (overflow)' : ' (direct)'}.`;
  }
  if (t.kind === 'ownApexWouldBeDestroyed') {
    const name = getCardDef(
      (Object.values(state.players)
        .flatMap((p) => p.apexSlots)
        .find((a) => a?.instanceId === t.apexInstanceId) ?? { defId: '' }
      ).defId || 'unknown'
    )?.name;
    return `${name ?? 'Your Apex'} is about to be destroyed!`;
  }
  return '';
}

export default function ResponseModal({ state }: { state: GameState }) {
  const resolveResponse = useGameStore((s) => s.resolveResponse);
  const item = state.pendingResponseQueue[0];
  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-xl border-2 border-pink-400 bg-[#0a0512] p-5 shadow-[0_0_40px_rgba(244,114,182,0.35)]">
        {item.stage === 'reactionChoice' && (
          <ReactionPrompt state={state} item={item} onChoose={resolveResponse} />
        )}
        {item.stage === 'negateWindow' && <NegatePrompt state={state} item={item} onChoose={resolveResponse} />}
        {item.stage === 'humanErrorChoice' && <HumanErrorPrompt item={item} onChoose={resolveResponse} />}
        {item.stage === 'alleyWraithChoice' && <AlleyWraithPrompt item={item} onChoose={resolveResponse} />}
      </div>
    </div>
  );
}

function ReactionPrompt({
  state,
  item,
  onChoose,
}: {
  state: GameState;
  item: Extract<GameState['pendingResponseQueue'][number], { stage: 'reactionChoice' }>;
  onChoose: ReturnType<typeof useGameStore.getState>['resolveResponse'];
}) {
  const player = state.players[item.respondingPlayerId];
  const eligible = player.hand.filter((c) => {
    if (c.type !== 'Reaction') return false;
    const def = getCardDef(c.defId) as ReactionDef;
    return def.trigger === item.trigger.kind && player.momentum >= def.cost;
  });

  return (
    <>
      <div className="text-[10px] uppercase tracking-widest text-pink-300/70 mb-1">Response window · {item.respondingPlayerId}</div>
      <div className="text-sm text-white/80 mb-4">{describeTrigger(state, item)}</div>
      <div className="space-y-2 mb-4">
        {eligible.length === 0 && <div className="text-xs text-white/40 italic">No eligible Reactions in hand.</div>}
        {eligible.map((c) => {
          const def = getCardDef(c.defId) as ReactionDef;
          return (
            <button
              key={c.instanceId}
              onClick={() => onChoose({ type: 'reaction', cardInstanceId: c.instanceId })}
              className="w-full text-left px-3 py-2 rounded border border-pink-400/50 hover:bg-pink-400/10 text-xs"
            >
              <div className="font-bold text-pink-200">
                {def.name} ({def.cost} Momentum)
              </div>
              <div className="text-white/60">{def.rulesText}</div>
            </button>
          );
        })}
      </div>
      <button onClick={() => onChoose({ type: 'pass' })} className="w-full py-2 rounded bg-white/10 hover:bg-white/20 text-xs font-bold">
        Pass
      </button>
    </>
  );
}

function NegatePrompt({
  state,
  item,
  onChoose,
}: {
  state: GameState;
  item: Extract<GameState['pendingResponseQueue'][number], { stage: 'negateWindow' }>;
  onChoose: ReturnType<typeof useGameStore.getState>['resolveResponse'];
}) {
  const player = state.players[item.negatingPlayerId];
  const targetDef = getCardDef(item.cardDefId);
  const eligible = player.hand.filter((c) => {
    if (c.type !== 'Negate') return false;
    const def = getCardDef(c.defId);
    if (def.type !== 'Negate') return false;
    return player.momentum >= def.cost && def.canCancel(item.cardType, item.cardFaction);
  });

  return (
    <>
      <div className="text-[10px] uppercase tracking-widest text-pink-300/70 mb-1">Negate window · {item.negatingPlayerId}</div>
      <div className="text-sm text-white/80 mb-4">
        {item.cardOwnerId} plays <b>{targetDef.name}</b> ({item.cardType}). Cancel it?
      </div>
      <div className="space-y-2 mb-4">
        {eligible.length === 0 && <div className="text-xs text-white/40 italic">No eligible Negate in hand.</div>}
        {eligible.map((c) => {
          const def = getCardDef(c.defId);
          if (def.type !== 'Negate') return null;
          return (
            <button
              key={c.instanceId}
              onClick={() => onChoose({ type: 'negate', cardInstanceId: c.instanceId })}
              className="w-full text-left px-3 py-2 rounded border border-pink-400/50 hover:bg-pink-400/10 text-xs"
            >
              <div className="font-bold text-pink-200">
                {def.name} ({def.cost} Momentum)
              </div>
              <div className="text-white/60">{def.rulesText}</div>
            </button>
          );
        })}
      </div>
      <button onClick={() => onChoose({ type: 'pass' })} className="w-full py-2 rounded bg-white/10 hover:bg-white/20 text-xs font-bold">
        Let it resolve
      </button>
    </>
  );
}

function HumanErrorPrompt({
  item,
  onChoose,
}: {
  item: Extract<GameState['pendingResponseQueue'][number], { stage: 'humanErrorChoice' }>;
  onChoose: ReturnType<typeof useGameStore.getState>['resolveResponse'];
}) {
  return (
    <>
      <div className="text-[10px] uppercase tracking-widest text-fuchsia-300/70 mb-1">Human Error · {item.playerId}</div>
      <div className="text-sm text-white/80 mb-4">First Special this turn. Choose one:</div>
      <div className="space-y-2">
        <button
          onClick={() => onChoose({ type: 'humanError', pick: 'momentum' })}
          className="w-full text-left px-3 py-2 rounded border border-fuchsia-400/50 hover:bg-fuchsia-400/10 text-xs font-bold"
        >
          Gain 1 Momentum
        </button>
        <button
          onClick={() => onChoose({ type: 'humanError', pick: 'damage' })}
          className="w-full text-left px-3 py-2 rounded border border-fuchsia-400/50 hover:bg-fuchsia-400/10 text-xs font-bold"
        >
          Next Apex attack this turn deals +100 damage
        </button>
      </div>
    </>
  );
}

function AlleyWraithPrompt({
  item,
  onChoose,
}: {
  item: Extract<GameState['pendingResponseQueue'][number], { stage: 'alleyWraithChoice' }>;
  onChoose: ReturnType<typeof useGameStore.getState>['resolveResponse'];
}) {
  const reactionDef = getCardDef(item.reactionDefId);
  return (
    <>
      <div className="text-[10px] uppercase tracking-widest text-pink-300/70 mb-1">Alley Wraith · {item.attackerId}</div>
      <div className="text-sm text-white/80 mb-4">
        {item.reactionOwnerId} just played <b>{reactionDef.name}</b> against your Alley Wraith&apos;s attack. Pay 1 Momentum to cancel it?
      </div>
      <div className="space-y-2">
        <button
          onClick={() => onChoose({ type: 'alleyWraithCancel' })}
          className="w-full text-left px-3 py-2 rounded border border-pink-400/50 hover:bg-pink-400/10 text-xs font-bold"
        >
          Pay 1 Momentum — cancel it
        </button>
        <button
          onClick={() => onChoose({ type: 'alleyWraithDecline' })}
          className="w-full py-2 rounded bg-white/10 hover:bg-white/20 text-xs font-bold"
        >
          Let it resolve
        </button>
      </div>
    </>
  );
}
