'use client';

import type { GameState, ReactionDef } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { useGameStore, type ResponseChoice } from '@/store/gameStore';
import { useTutorialStore } from '@/store/tutorialStore';
import { TUTORIAL_STEPS } from '@/tutorial/tutorialSteps';

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

interface ResponseModalProps {
  state: GameState;
  onAfterChoose?: () => void;
}

export default function ResponseModal({ state, onAfterChoose }: ResponseModalProps) {
  const rawResolveResponse = useGameStore((s) => s.resolveResponse);
  const item = state.pendingResponseQueue[0];
  if (!item) return null;

  // Wrap so the hotseat gate can advance to its "pass back" step right after a choice is made.
  const resolveResponse: typeof rawResolveResponse = (choice) => {
    rawResolveResponse(choice);
    onAfterChoose?.();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-xl border-2 border-pink-400 bg-[#0a0512] p-5 shadow-[0_0_40px_rgba(244,114,182,0.35)]">
        {item.stage === 'reactionChoice' && (
          <ReactionPrompt state={state} item={item} onChoose={resolveResponse} />
        )}
        {item.stage === 'negateWindow' && <NegatePrompt state={state} item={item} onChoose={resolveResponse} />}
        {item.stage === 'humanErrorChoice' && <HumanErrorPrompt item={item} onChoose={resolveResponse} />}
        {item.stage === 'civilWarChoice' && <CivilWarPrompt item={item} onChoose={resolveResponse} />}
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
  onChoose: (choice: ResponseChoice) => void;
}) {
  const player = state.players[item.respondingPlayerId];
  const eligible = player.hand.filter((c) => {
    if (c.type !== 'Reaction') return false;
    const def = getCardDef(c.defId) as ReactionDef;
    return def.trigger === item.trigger.kind && player.momentum >= def.cost;
  });

  // Commit 31 - the guided React step (real interaction is back, reversing
  // Commit 29.17's "resolve every response directly, bypass this UI" design
  // per direct request). During that specific step, only the one correct
  // React is clickable - everything else (other eligible Reacts, Pass) is
  // dimmed and rejected with a helper message, so the player can't
  // accidentally skip past the moment the step is teaching.
  const tutorialStep = useTutorialStore((s) => s.step);
  const guided = state.tutorialMode ? TUTORIAL_STEPS[tutorialStep]?.guided : undefined;
  const tutorialTargetDefId = guided?.kind === 'playReact' ? guided.defId : null;

  function tryChoose(choice: ResponseChoice, cardDefId?: string) {
    if (tutorialTargetDefId && cardDefId !== tutorialTargetDefId) {
      useTutorialStore.getState().setHelperMessage('Not that one yet. Let\u2019s play the highlighted card first.');
      return;
    }
    if (tutorialTargetDefId && choice.type === 'pass') {
      useTutorialStore.getState().setHelperMessage('Follow the tutorial prompt to continue.');
      return;
    }
    onChoose(choice);
    if (tutorialTargetDefId && cardDefId === tutorialTargetDefId) {
      useTutorialStore.getState().setHelperMessage(null);
      useTutorialStore.getState().setStep(tutorialStep + 1);
    }
  }

  return (
    <>
      <div className="text-[10px] uppercase tracking-widest text-pink-300/70 mb-1">
        Response Window: {item.respondingPlayerId} may respond.
      </div>
      <div className="text-sm text-white/80 mb-4">{describeTrigger(state, item)}</div>
      <div className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Eligible Reactions</div>
      <div className="space-y-2 mb-4">
        {eligible.length === 0 && <div className="text-xs text-white/40 italic">No eligible Reactions in hand.</div>}
        {eligible.map((c) => {
          const def = getCardDef(c.defId) as ReactionDef;
          const isTutorialTarget = tutorialTargetDefId === c.defId;
          const dimmed = tutorialTargetDefId !== null && !isTutorialTarget;
          return (
            <button type="button"
              key={c.instanceId}
              onClick={() => tryChoose({ type: 'reaction', cardInstanceId: c.instanceId }, c.defId)}
              className={`w-full text-left px-3 py-2 rounded border text-xs transition-all ${
                isTutorialTarget
                  ? 'border-emerald-300 bg-emerald-400/20 ring-2 ring-emerald-300 animate-pulse'
                  : dimmed
                  ? 'border-pink-400/20 opacity-40'
                  : 'border-pink-400/50 hover:bg-pink-400/10'
              }`}
            >
              <div className="font-bold text-pink-200">
                {def.name} ({def.cost} Momentum)
              </div>
              <div className="text-white/60">{def.rulesText}</div>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => tryChoose({ type: 'pass' })}
        className={`w-full py-2 rounded text-xs font-bold ${tutorialTargetDefId ? 'bg-white/5 text-white/25 cursor-not-allowed' : 'bg-white/10 hover:bg-white/20'}`}
      >
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
  onChoose: (choice: ResponseChoice) => void;
}) {
  const player = state.players[item.negatingPlayerId];
  const targetDef = getCardDef(item.cardDefId);
  const eligible = player.hand.filter((c) => {
    if (c.type !== 'Reaction') return false;
    const def = getCardDef(c.defId);
    if (def.type !== 'Reaction' || typeof def.canCancel !== 'function') return false;
    return player.momentum >= def.cost && def.canCancel(item.cardType, item.cardFaction);
  });

  return (
    <>
      <div className="text-[10px] uppercase tracking-widest text-pink-300/70 mb-1">
        Response Window: {item.negatingPlayerId} may respond.
      </div>
      <div className="text-sm text-white/80 mb-4">
        {item.cardOwnerId} plays <b>{targetDef.name}</b> ({item.cardType}). Cancel it?
      </div>
      <div className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Eligible React — Negate cards</div>
      <div className="space-y-2 mb-4">
        {eligible.length === 0 && <div className="text-xs text-white/40 italic">No eligible React — Negate in hand.</div>}
        {eligible.map((c) => {
          const def = getCardDef(c.defId);
          if (def.type !== 'Reaction' || typeof def.canCancel !== 'function') return null;
          return (
            <button type="button"
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
      <button type="button" onClick={() => onChoose({ type: 'pass' })} className="w-full py-2 rounded bg-white/10 hover:bg-white/20 text-xs font-bold">
        Pass
      </button>
    </>
  );
}

function HumanErrorPrompt({
  item,
  onChoose,
}: {
  item: Extract<GameState['pendingResponseQueue'][number], { stage: 'humanErrorChoice' }>;
  onChoose: (choice: ResponseChoice) => void;
}) {
  return (
    <>
      <div className="text-[10px] uppercase tracking-widest text-fuchsia-300/70 mb-1">Human Error · {item.playerId}</div>
      <div className="text-sm text-white/80 mb-4">First Special this turn. Choose one:</div>
      <div className="space-y-2">
        <button type="button"
          onClick={() => onChoose({ type: 'humanError', pick: 'momentum' })}
          className="w-full text-left px-3 py-2 rounded border border-fuchsia-400/50 hover:bg-fuchsia-400/10 text-xs font-bold"
        >
          Gain 1 Momentum
        </button>
        <button type="button"
          onClick={() => onChoose({ type: 'humanError', pick: 'damage' })}
          className="w-full text-left px-3 py-2 rounded border border-fuchsia-400/50 hover:bg-fuchsia-400/10 text-xs font-bold"
        >
          Next Apex attack this turn deals +100 damage
        </button>
      </div>
    </>
  );
}

function CivilWarPrompt({
  item,
  onChoose,
}: {
  item: Extract<GameState['pendingResponseQueue'][number], { stage: 'civilWarChoice' }>;
  onChoose: (choice: ResponseChoice) => void;
}) {
  const state = useGameStore();
  const tutorialStep = useTutorialStore((s) => s.step);
  const guided = state.tutorialMode ? TUTORIAL_STEPS[tutorialStep]?.guided : undefined;
  const requiredPick = guided?.kind === 'riftChoice' ? guided.pick : null;

  function tryChoose(pick: 'momentum' | 'damage') {
    if (requiredPick && pick !== requiredPick) {
      useTutorialStore.getState().setHelperMessage('Not that one yet. Try the highlighted option.');
      return;
    }
    onChoose({ type: 'civilWar', pick });
    if (requiredPick) {
      useTutorialStore.getState().setHelperMessage(null);
      useTutorialStore.getState().setStep(tutorialStep + 1);
    }
  }

  return (
    <>
      <div className="text-[10px] uppercase tracking-widest text-orange-300/70 mb-1">Civil War · {item.playerId}</div>
      <div className="text-sm text-white/80 mb-4">You are behind on O2. Choose your uprising bonus:</div>
      <div className="space-y-2">
        <button type="button"
          onClick={() => tryChoose('momentum')}
          className={`w-full text-left px-3 py-2 rounded border text-xs font-bold transition-all ${
            requiredPick === 'momentum'
              ? 'border-emerald-300 bg-emerald-400/20 ring-2 ring-emerald-300 animate-pulse'
              : requiredPick
              ? 'border-orange-400/20 opacity-40'
              : 'border-orange-400/50 hover:bg-orange-400/10'
          }`}
        >
          Gain 1 Momentum
        </button>
        <button type="button"
          onClick={() => tryChoose('damage')}
          className={`w-full text-left px-3 py-2 rounded border text-xs font-bold transition-all ${
            requiredPick && requiredPick !== 'damage' ? 'border-orange-400/20 opacity-40' : 'border-orange-400/50 hover:bg-orange-400/10'
          }`}
        >
          First Apex attack this turn deals +100 damage
        </button>
      </div>
    </>
  );
}
