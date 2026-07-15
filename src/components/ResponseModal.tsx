'use client';

import { createPortal } from 'react-dom';

import type { CardInstance, GameState, ReactionDef } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { useGameStore, type ResponseChoice } from '@/store/gameStore';
import { useTutorialStore } from '@/store/tutorialStore';
import { TUTORIAL_STEPS } from '@/tutorial/tutorialSteps';
import HubPrompt, { type HubPromptOption } from './HubPrompt';

function describeTrigger(state: GameState, item: GameState['pendingResponseQueue'][number]): string {
  if (item.stage !== 'reactionChoice') return '';
  const t = item.trigger;
  if (t.kind === 'enemyApexAttacks') {
    const attackerName = getCardDef(
      (state.players[t.attackerId].apexSlots.find((a) => a?.instanceId === t.attackerInstanceId) ?? { defId: '' }).defId ||
        'unknown'
    )?.name;
    return `${attackerName ?? 'Opponent'} is attacking for ${t.totalDamage} damage. Play a React card?`;
  }
  if (t.kind === 'opponentAttackDealsO2Damage') {
    return `This attack would deal ${t.amount} O2 damage. Play a React card?`;
  }
  if (t.kind === 'ownApexWouldBeDestroyed') {
    const name = getCardDef(
      (Object.values(state.players)
        .flatMap((p) => p.apexSlots)
        .find((a) => a?.instanceId === t.apexInstanceId) ?? { defId: '' }
      ).defId || 'unknown'
    )?.name;
    return `${name ?? 'Your Apex'} is about to be destroyed! Play a React card?`;
  }
  return 'Play a React card?';
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

  const content = (
    <>
      {item.stage === 'reactionChoice' && <ReactionPrompt state={state} item={item} onChoose={resolveResponse} />}
      {item.stage === 'negateWindow' && <NegatePrompt state={state} item={item} onChoose={resolveResponse} />}
      {item.stage === 'humanErrorChoice' && <HumanErrorPrompt item={item} onChoose={resolveResponse} />}
      {item.stage === 'civilWarChoice' && <CivilWarPrompt item={item} onChoose={resolveResponse} />}
    </>
  );

  // Commit 41.11 - renders into the shared center hub (Row 5, between the two
  // boards) via a portal, instead of a full-screen takeover. The portal
  // target lives inside a transformed ancestor, so this can't just nest
  // normally - same reasoning as the card hover preview fix earlier. Falls
  // back to a simple centered overlay only if that target isn't mounted for
  // some reason, so this never silently renders nothing.
  const hubTarget = typeof document !== 'undefined' ? document.getElementById('response-hub-target') : null;
  if (hubTarget) return createPortal(content, hubTarget);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
      <div className="w-full max-w-2xl pointer-events-auto">{content}</div>
    </div>,
    document.body
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

  const options: HubPromptOption[] = eligible.map((c) => {
    const def = getCardDef(c.defId) as ReactionDef;
    const isTutorialTarget = tutorialTargetDefId === c.defId;
    return {
      key: c.instanceId,
      label: `${def.name} (${def.cost} Mom)`,
      cardInstance: c,
      highlighted: isTutorialTarget,
      dimmed: tutorialTargetDefId !== null && !isTutorialTarget,
      onClick: () => tryChoose({ type: 'reaction', cardInstanceId: c.instanceId }, c.defId),
    };
  });
  options.push({
    key: 'pass',
    label: 'Pass',
    muted: true,
    disabled: !!tutorialTargetDefId,
    onClick: () => tryChoose({ type: 'pass' }),
  });

  return <HubPrompt text={describeTrigger(state, item)} options={options} />;
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
  const eligible = player.hand.filter((c): c is CardInstance => {
    if (c.type !== 'Reaction') return false;
    const def = getCardDef(c.defId);
    if (def.type !== 'Reaction' || typeof def.canCancel !== 'function') return false;
    return player.momentum >= def.cost && def.canCancel(item.cardType, item.cardFaction);
  });

  const options: HubPromptOption[] = eligible.map((c) => {
    const def = getCardDef(c.defId) as ReactionDef;
    return {
      key: c.instanceId,
      label: `${def.name} (${def.cost} Mom)`,
      cardInstance: c,
      onClick: () => onChoose({ type: 'negate', cardInstanceId: c.instanceId }),
    };
  });
  options.push({ key: 'pass', label: 'Pass', muted: true, onClick: () => onChoose({ type: 'pass' }) });

  return <HubPrompt text={`${item.cardOwnerId} plays ${targetDef.name} (${item.cardType}). Cancel it?`} options={options} />;
}

function HumanErrorPrompt({
  item,
  onChoose,
}: {
  item: Extract<GameState['pendingResponseQueue'][number], { stage: 'humanErrorChoice' }>;
  onChoose: (choice: ResponseChoice) => void;
}) {
  return (
    <HubPrompt
      text={`Human Error \u00b7 ${item.playerId} \u2014 First Special this turn. Choose one:`}
      options={[
        { key: 'momentum', label: 'Gain 1 Momentum', onClick: () => onChoose({ type: 'humanError', pick: 'momentum' }) },
        { key: 'damage', label: 'Next attack +100 damage', onClick: () => onChoose({ type: 'humanError', pick: 'damage' }) },
      ]}
    />
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
    <HubPrompt
      text={`Rift Space Activates: Civil War \u00b7 ${item.playerId} \u2014 you're behind on O2. Choose:`}
      options={[
        {
          key: 'momentum',
          label: '+1 Momentum',
          highlighted: requiredPick === 'momentum',
          dimmed: !!requiredPick && requiredPick !== 'momentum',
          onClick: () => tryChoose('momentum'),
        },
        {
          key: 'damage',
          label: '+100 ATK Next Turn',
          highlighted: requiredPick === 'damage',
          dimmed: !!requiredPick && requiredPick !== 'damage',
          onClick: () => tryChoose('damage'),
        },
      ]}
    />
  );
}
