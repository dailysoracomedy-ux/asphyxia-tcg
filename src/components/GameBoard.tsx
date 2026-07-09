'use client';

import { useState, useEffect } from 'react';
import { useGameStore } from '@/store/gameStore';
import { getCardDef } from '@/data/cards';
import type { ApexDef, SpecialDef, PlayerId, GameState, CardInstance } from '@/types/game';
import PlayerBoard, { PlayerStatusChips } from './PlayerBoard';
import Hand from './Hand';
import RiftPanel from './RiftPanel';
import GameLog from './GameLog';
import CombatControls from './CombatControls';
import HotseatResponseGate from './HotseatResponseGate';
import Card from './Card';
import CardInspectModal, { type InspectZone } from './CardInspectModal';
import VoidInspectModal from './VoidInspectModal';
import SharedStatsBar from './SharedStatsBar';
import { factionTheme } from '@/lib/theme';
import { BUILD_VERSION } from '@/lib/version';
import { aiPlayOneMainPhaseAction, aiPlayOneCombatAction, aiDecideControlConflict, aiChooseBinaryRiftBonus, aiChooseResponse } from '@/game/ai';
import { getOverdriveEligibility } from '@/game/rules';

const PHASE_LABEL: Record<string, string> = { Start: 'Draw', Main: 'Main', Combat: 'Combat', End: 'End' };

type Mode =
  | { kind: 'idle' }
  | { kind: 'apexReady'; cardId: string }
  | { kind: 'supportReady'; cardId: string }
  | { kind: 'supportChooseChain'; cardId: string }
  | { kind: 'equipReady'; cardId: string }
  | { kind: 'specialReady'; cardId: string; requiresTarget: SpecialDef['requiresTarget'] }
  | { kind: 'reconfigureReturn' }
  | { kind: 'reconfigurePlay'; returnId: string }
  | { kind: 'reconfigureChain'; returnId: string; playId: string }
  | { kind: 'attackerChosen'; attackerId: string }
  | { kind: 'attackAwaitingTarget'; attackerId: string; attackId: string }
  | { kind: 'rechainSelectApex'; supportId: string }
  | { kind: 'overdrivePrompt'; attackerId: string; attackId: string; targetId?: string; supportName: string };

export default function GameBoard() {
  const state = useGameStore();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [logOpen, setLogOpen] = useState(false);
  const [inspected, setInspected] = useState<{ instance: CardInstance; ownerId: PlayerId | null; zone: InspectZone } | null>(null);
  const [voidInspecting, setVoidInspecting] = useState<PlayerId | null>(null);
  const recentMoves = state.log.slice(-4);

  // Draw Phase is automatic: resolve the draw itself, then move straight to Main Phase,
  // except when Control Conflict's optional lock decision is available - that pauses
  // here (a "Continue to Main Phase" button lets the player move on explicitly, and the
  // AI driver below makes its own lock/skip decision and advances the phase itself).
  useEffect(() => {
    if (state.status !== 'playing') return;
    if (state.pendingResponseQueue.length > 0) return;
    if (state.phase === 'Start' && state.startPhasePending) {
      const t = setTimeout(() => useGameStore.getState().advancePhase('Start'), 300);
      return () => clearTimeout(t);
    }
    if (state.phase === 'Start' && !state.startPhasePending) {
      const active = state.players[state.activePlayerId];
      const controlConflictPause =
        state.riftSpace?.id === 'ControlConflict' && active.supportSlots.some(Boolean) && !active.lockedSupportInstanceId;
      if (!controlConflictPause) {
        const t = setTimeout(() => useGameStore.getState().advancePhase('Main'), 300);
        return () => clearTimeout(t);
      }
    }
  }, [state]);

  // AI driver: only active in Vs AI mode, and only ever acts for player2. Re-runs on
  // every state change (since each AI action mutates the store and produces a new
  // state reference), which naturally forms a "decide one thing, wait, re-evaluate"
  // loop without needing a manual queue. Every branch bails out immediately if it's
  // not player2's turn, the game has ended, or a human response is pending - so the
  // AI can never act while the human needs to make a choice.
  useEffect(() => {
    if (!state.vsAI || state.status !== 'playing') return;

    // A response window may need EITHER player - only act if it's specifically AI's turn to respond.
    if (state.pendingResponseQueue.length > 0) {
      const item = state.pendingResponseQueue[0];
      if (item.stage === 'reactionChoice' && item.respondingPlayerId === 'player2') {
        const t = setTimeout(() => useGameStore.getState().resolveResponse(aiChooseResponse('player2', item)), 700);
        return () => clearTimeout(t);
      }
      if (item.stage === 'negateWindow' && item.negatingPlayerId === 'player2') {
        const t = setTimeout(() => useGameStore.getState().resolveResponse(aiChooseResponse('player2', item)), 700);
        return () => clearTimeout(t);
      }
      if (item.stage === 'civilWarChoice' && item.playerId === 'player2') {
        const t = setTimeout(() => useGameStore.getState().resolveResponse({ type: 'civilWar', pick: aiChooseBinaryRiftBonus('player2') }), 600);
        return () => clearTimeout(t);
      }
      if (item.stage === 'humanErrorChoice' && item.playerId === 'player2') {
        const t = setTimeout(() => useGameStore.getState().resolveResponse({ type: 'humanError', pick: aiChooseBinaryRiftBonus('player2') }), 600);
        return () => clearTimeout(t);
      }
      return; // some other response is pending (likely awaiting the human) - AI waits
    }

    if (state.activePlayerId !== 'player2') return; // not AI's turn

    if (state.phase === 'Start' && !state.startPhasePending && state.riftSpace?.id === 'ControlConflict') {
      const active = state.players.player2;
      if (active.supportSlots.some(Boolean) && !active.lockedSupportInstanceId) {
        const t = setTimeout(() => aiDecideControlConflict('player2'), 600);
        return () => clearTimeout(t);
      }
      return; // otherwise let the shared Draw Phase effect above auto-advance to Main
    }

    if (state.phase === 'Main') {
      const t = setTimeout(() => {
        const acted = aiPlayOneMainPhaseAction('player2');
        if (!acted) useGameStore.getState().advancePhase('Combat');
      }, 650);
      return () => clearTimeout(t);
    }

    if (state.phase === 'Combat') {
      const t = setTimeout(() => {
        const acted = aiPlayOneCombatAction('player2');
        if (!acted) useGameStore.getState().endTurn();
      }, 650);
      return () => clearTimeout(t);
    }
  }, [state]);
  const [lastSeenLogCount, setLastSeenLogCount] = useState(0);

  /**
   * Root-cause fix for the "click a phase button and the page jumps to the top" bug.
   * The phase/end-turn buttons intentionally become `disabled` the instant their own
   * click handler updates state (e.g. clicking "Main Phase" makes that same button
   * `enabled=false` on the very next render). When a focused element becomes disabled,
   * browsers forcibly move focus away from it - typically to <body> - and that focus
   * shift is what triggers the native scroll-to-top. Blurring the button ourselves
   * *before* the state update runs avoids that forced-focus-loss path entirely, since
   * blur() on a still-enabled element is a normal, harmless operation.
   * The scroll-position snapshot/restore is kept as a defensive backstop in case any
   * other button (or a future one) exhibits the same disabled-focus issue.
   */
  function scrollSafeClick(handler: () => void) {
    return (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.blur();
      const scrollY = window.scrollY;
      handler();
      requestAnimationFrame(() => {
        if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: 'auto' });
      });
    };
  }

  if (state.status === 'selectingOpeningApex') {
    return <OpeningApexScreen />;
  }
  if (state.status === 'gameover') {
    return <GameOverScreen />;
  }
  if (state.status !== 'playing') return null;

  const activeId = state.activePlayerId;
  const aiIsActing = state.vsAI && activeId === 'player2' && !state.debugMode;
  const oppId: PlayerId = activeId === 'player1' ? 'player2' : 'player1';
  const activePlayer = state.players[activeId];
  const oppPlayer = state.players[oppId];

  // Viewer-relative board identity: in Vs AI mode the human (player1) always sits at
  // the bottom and the AI (player2) always sits at the top, regardless of whose turn
  // it actually is - the viewport never swaps, so the human watches AI actions happen
  // on the top board while their own board/hand stays put. In Hotseat, the board still
  // swaps to whoever is active (the existing pass-and-play model).
  const viewerBottomId: PlayerId = state.vsAI ? 'player1' : activeId;
  const viewerTopId: PlayerId = state.vsAI ? 'player2' : oppId;
  const bottomIsActingPlayer = viewerBottomId === activeId;

  const selectedCard = mode.kind !== 'idle' && 'cardId' in mode ? activePlayer.hand.find((c) => c.instanceId === mode.cardId) : undefined;

  function resetMode() {
    setMode({ kind: 'idle' });
  }

  function selectHandCard(cardId: string) {
    const card = activePlayer.hand.find((c) => c.instanceId === cardId);
    if (!card || state.phase !== 'Main') return;
    if (mode.kind !== 'idle' && 'cardId' in mode && mode.cardId === cardId) {
      resetMode();
      return;
    }
    if (card.type === 'Special' && activePlayer.turnFlags.specialsPlayedThisTurn >= 1) return;
    if (
      (card.type === 'AbilitySupport' || card.type === 'BatterySupport') &&
      activePlayer.turnFlags.supportsPlayedThisTurn >= 1
    ) {
      return;
    }
    switch (card.type) {
      case 'Apex':
        setMode({ kind: 'apexReady', cardId });
        break;
      case 'AbilitySupport':
        setMode({ kind: 'supportChooseChain', cardId });
        break;
      case 'BatterySupport':
        setMode({ kind: 'supportReady', cardId });
        break;
      case 'Equip':
        setMode({ kind: 'equipReady', cardId });
        break;
      case 'Special': {
        const def = getCardDef(card.defId) as SpecialDef;
        setMode({ kind: 'specialReady', cardId, requiresTarget: def.requiresTarget });
        break;
      }
      default:
        break;
    }
  }

  const handDisabledIds = new Set(
    activePlayer.hand
      .filter(
        (c) =>
          (c.type === 'Special' && activePlayer.turnFlags.specialsPlayedThisTurn >= 1) ||
          ((c.type === 'AbilitySupport' || c.type === 'BatterySupport') && activePlayer.turnFlags.supportsPlayedThisTurn >= 1)
      )
      .map((c) => c.instanceId)
  );

  function ownApexClick(apexId: string) {
    if (mode.kind === 'supportChooseChain') {
      state.playSupportCard(mode.cardId, undefined, apexId);
      resetMode();
      return;
    }
    if (mode.kind === 'equipReady') {
      state.playEquipCard(mode.cardId, apexId);
      resetMode();
      return;
    }
    if (mode.kind === 'specialReady' && (mode.requiresTarget === 'ownApex' || mode.requiresTarget === 'ownApexWithUpgrade')) {
      state.playSpecialCard(mode.cardId, apexId);
      resetMode();
      return;
    }
    if (mode.kind === 'reconfigureChain') {
      state.reconfigure(mode.returnId, mode.playId, apexId);
      resetMode();
      return;
    }
    if (mode.kind === 'rechainSelectApex') {
      state.chainSupport(mode.supportId, apexId);
      resetMode();
      return;
    }
    if (state.phase === 'Combat') {
      const apex = activePlayer.apexSlots.find((a) => a?.instanceId === apexId);
      if (apex && !apex.hasAttacked) {
        setMode({ kind: 'attackerChosen', attackerId: apexId });
      }
    }
  }

  function ownSupportClick(supportId: string) {
    if (mode.kind === 'reconfigureReturn') {
      setMode({ kind: 'reconfigurePlay', returnId: supportId });
      return;
    }
    if (mode.kind === 'idle' && state.phase === 'Main') {
      const support = activePlayer.supportSlots.find((s) => s?.instanceId === supportId);
      if (support?.type === 'AbilitySupport' && !support.chainedApexId) {
        setMode({ kind: 'rechainSelectApex', supportId });
      }
    }
  }

  function oppApexClick(apexId: string) {
    if (mode.kind === 'specialReady' && (mode.requiresTarget === 'enemyApex' || mode.requiresTarget === 'enemyApexWithChoke')) {
      const target = oppPlayer.apexSlots.find((a) => a?.instanceId === apexId);
      if (mode.requiresTarget === 'enemyApexWithChoke' && (target?.counters?.choke ?? 0) === 0) return;
      state.playSpecialCard(mode.cardId, apexId);
      resetMode();
      return;
    }
    if (mode.kind === 'attackAwaitingTarget') {
      const eligible = getOverdriveEligibility(state, mode.attackerId);
      if (eligible) {
        setMode({ kind: 'overdrivePrompt', attackerId: mode.attackerId, attackId: mode.attackId, targetId: apexId, supportName: eligible.supportName });
      } else {
        state.declareAttack(mode.attackerId, mode.attackId, apexId);
        resetMode();
      }
    }
  }

  function chooseAttack(attackId: string) {
    if (mode.kind !== 'attackerChosen') return;
    const hasEnemyApex = oppPlayer.apexSlots.some(Boolean);
    if (hasEnemyApex) {
      setMode({ kind: 'attackAwaitingTarget', attackerId: mode.attackerId, attackId });
    } else {
      const eligible = getOverdriveEligibility(state, mode.attackerId);
      if (eligible) {
        setMode({ kind: 'overdrivePrompt', attackerId: mode.attackerId, attackId, supportName: eligible.supportName });
      } else {
        state.declareAttack(mode.attackerId, attackId);
        resetMode();
      }
    }
  }

  const attackerApex =
    (mode.kind === 'attackerChosen' || mode.kind === 'attackAwaitingTarget') &&
    activePlayer.apexSlots.find((a) => a?.instanceId === mode.attackerId);
  const attackerDef = attackerApex ? (getCardDef(attackerApex.defId) as ApexDef) : null;

  const oppApexHighlight = (id: string): 'valid-target' | null => {
    if (mode.kind === 'attackAwaitingTarget') return 'valid-target';
    if (mode.kind === 'specialReady' && (mode.requiresTarget === 'enemyApex' || mode.requiresTarget === 'enemyApexWithChoke')) {
      const target = oppPlayer.apexSlots.find((a) => a?.instanceId === id);
      if (mode.requiresTarget === 'enemyApexWithChoke' && (target?.counters?.choke ?? 0) === 0) return null;
      return 'valid-target';
    }
    return null;
  };

  function apexHasAbilitySupportChained(apexId: string): boolean {
    return activePlayer.supportSlots.some((s) => s?.type === 'AbilitySupport' && s.chainedApexId === apexId);
  }

  const ownApexHighlight = (id: string): 'valid-target' | null => {
    if (mode.kind === 'supportChooseChain' || mode.kind === 'reconfigureChain' || mode.kind === 'rechainSelectApex') {
      return apexHasAbilitySupportChained(id) ? null : 'valid-target';
    }
    if (mode.kind === 'equipReady') return 'valid-target';
    if (mode.kind === 'specialReady' && (mode.requiresTarget === 'ownApex' || mode.requiresTarget === 'ownApexWithUpgrade')) {
      const target = activePlayer.apexSlots.find((a) => a?.instanceId === id);
      if (mode.requiresTarget === 'ownApexWithUpgrade' && (target?.counters?.upgrade ?? 0) === 0) return null;
      return 'valid-target';
    }
    return null;
  };

  function ownApexDisabled(id: string): boolean {
    if (mode.kind === 'supportChooseChain' || mode.kind === 'reconfigureChain' || mode.kind === 'rechainSelectApex') {
      return apexHasAbilitySupportChained(id);
    }
    return false;
  }

  const reconfigureDisabled = activePlayer.turnFlags.reconfigureUsedThisTurn || state.phase !== 'Main';
  const supportBudgetSpent = activePlayer.turnFlags.supportsPlayedThisTurn >= 1;
  const eligibleReconfigurePlays =
    mode.kind === 'reconfigurePlay' && !supportBudgetSpent
      ? activePlayer.hand.filter((c) => c.type === 'AbilitySupport' || c.type === 'BatterySupport')
      : [];

  const theme = factionTheme(activePlayer.faction);

  return (
    <div
      className="h-full max-h-full overflow-hidden grid gap-1.5 p-2 max-w-[1800px] mx-auto w-full"
      style={{ gridTemplateRows: 'auto minmax(0,auto) auto minmax(0,auto) auto auto', alignContent: 'center' }}
    >
      {state.pendingResponseQueue.length > 0 && <HotseatResponseGate state={state} />}

      {/* Row 1: top status bar - both players' compact chips + turn/phase + Battle Log */}
      <div className="shrink-0 rounded-lg border border-white/10 bg-[#05050a] px-2 py-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <PlayerStatusChips state={state} playerId={viewerTopId} />
        <div className="flex items-center gap-3 text-[11px] text-white/50 shrink-0">
          <span>
            Turn {state.turnNumber} · <span style={{ color: theme.primary }} className="font-bold">{PHASE_LABEL[state.phase]}</span>
            <span className="text-white/20 ml-2 font-mono hidden md:inline">{BUILD_VERSION}</span>
          </span>
          <label className="hidden md:flex items-center gap-1 text-white/30 hover:text-white/60 cursor-pointer select-none">
            <input type="checkbox" checked={state.debugMode} onChange={() => state.toggleDebugMode()} className="accent-fuchsia-400" />
            debug
          </label>
          <button
            type="button"
            onClick={() => {
              setLogOpen(true);
              setLastSeenLogCount(state.log.length);
            }}
            className="relative px-2 py-1 rounded border border-white/15 hover:bg-white/10 hover:text-white"
          >
            Battle Log
            {state.log.length > lastSeenLogCount && <span className="ml-1 text-fuchsia-300">• New</span>}
          </button>
          <button type="button" onClick={() => state.resetToMenu()} className="hover:text-white underline">
            Reset
          </button>
        </div>
        <PlayerStatusChips state={state} playerId={viewerBottomId} />
      </div>

      {/* Row 2: opponent board */}
      <div className="min-h-0 overflow-hidden">
        <PlayerBoard
          state={state}
          playerId={viewerTopId}
          flipped
          onApexClick={oppApexClick}
          apexHighlight={oppApexHighlight}
          onInspectCard={(instance) => setInspected({ instance, ownerId: viewerTopId, zone: 'Field' })}
          onOpenVoid={() => setVoidInspecting(viewerTopId)}
        />
      </div>

      {/* Row 3: Rift / prompt / action-context area - compact, only as tall as its content needs */}
      <div className="shrink-0 flex flex-col gap-1.5 max-h-[40vh] overflow-y-auto">
        <SharedStatsBar state={state} leftId={viewerTopId} rightId={viewerBottomId} />
        <RiftPanel rift={state.riftSpace} />

        {state.riftSpace?.id === 'ControlConflict' && state.phase === 'Start' && !state.startPhasePending && !aiIsActing && (
          <div className="rounded-lg border border-blue-400/30 bg-[#05050a] px-2 py-1 flex items-center gap-1 flex-wrap text-[10px]">
            <span className="text-blue-300 shrink-0">Control Conflict - lock a Support for +1 Momentum?</span>
            {activePlayer.supportSlots.filter(Boolean).map((s) => (
              <button type="button"
                key={s!.instanceId}
                disabled={!!activePlayer.lockedSupportInstanceId}
                onClick={scrollSafeClick(() => state.lockSupportControlConflict(s!.instanceId))}
                className="px-1.5 py-0.5 rounded border border-blue-400/50 hover:bg-blue-400/10 disabled:opacity-30"
              >
                lock {getCardDef(s!.defId).name}
              </button>
            ))}
            <button type="button"
              onClick={scrollSafeClick(() => state.advancePhase('Main'))}
              className="px-1.5 py-0.5 rounded border border-white/20 hover:bg-white/10 text-white/60 ml-auto"
            >
              Continue to Main Phase
            </button>
          </div>
        )}

        {state.phase === 'Combat' && (
          <CombatControls
            apexDef={attackerDef}
            state={state}
            attackerInstanceId={attackerApex ? attackerApex.instanceId : null}
            availableSync={activePlayer.availableSync}
            hasAttacked={!!attackerApex && !!attackerApex.hasAttacked}
            selectedAttackId={mode.kind === 'attackAwaitingTarget' ? mode.attackId : null}
            onChooseAttack={chooseAttack}
            onCancel={resetMode}
            awaitingTarget={mode.kind === 'attackAwaitingTarget'}
          />
        )}
      </div>

      {/* Row 4: player board */}
      <div className="min-h-0 overflow-hidden">
        <PlayerBoard
          state={state}
          playerId={viewerBottomId}
          onApexClick={bottomIsActingPlayer ? ownApexClick : undefined}
          onSupportClick={bottomIsActingPlayer ? ownSupportClick : undefined}
          apexHighlight={bottomIsActingPlayer ? ownApexHighlight : undefined}
          apexDisabled={bottomIsActingPlayer ? ownApexDisabled : () => true}
          selectedApexId={
            mode.kind === 'attackerChosen' || mode.kind === 'attackAwaitingTarget' ? mode.attackerId : null
          }
          selectedSupportId={mode.kind === 'reconfigurePlay' || mode.kind === 'reconfigureChain' ? mode.returnId : null}
          supportDisabled={bottomIsActingPlayer ? () => mode.kind !== 'reconfigureReturn' && mode.kind !== 'idle' : () => true}
          onInspectCard={(instance) => setInspected({ instance, ownerId: viewerBottomId, zone: 'Field' })}
          onOpenVoid={() => setVoidInspecting(viewerBottomId)}
        />
      </div>

      {/* Row 5: action feed - a real layout row (not an overlay), so it can never cover
          the board. Shows recent moves, updating live, rather than a transient popup. */}
      <div className="shrink-0 rounded-lg border border-white/10 bg-[#05050a] px-2 py-1 flex items-center gap-2 overflow-hidden text-[10px] text-white/50">
        <span className="uppercase tracking-widest text-white/30 shrink-0">Recent:</span>
        <div className="flex overflow-hidden whitespace-nowrap">
          {[...recentMoves].reverse().map((entry, i) => (
            <span key={entry.id} className={entry.kind === 'info' ? 'text-red-300/80' : 'text-white/60'}>
              {i > 0 && <span className="text-white/15 mr-3">·</span>}
              {entry.message}
            </span>
          ))}
          {recentMoves.length === 0 && <span className="text-white/25 italic">No moves yet.</span>}
        </div>
      </div>

      {/* Row 6: hand + phase controls - always visible, fixed bottom area */}
      <div className="shrink-0 flex flex-col gap-1.5">
        <div className="mx-auto w-full max-w-md flex flex-col gap-1.5">
        <div className="rounded-lg border border-white/10 bg-[#05050a] px-2 py-1.5 flex items-center justify-center gap-2 flex-wrap">
          {state.phase === 'Start' && (
            <span className="text-[11px] text-white/40 italic px-1">Draw Phase...</span>
          )}
          {aiIsActing && (
            <span className="text-[11px] text-fuchsia-300/80 italic px-1 animate-pulse">
              {state.players.player2.faction} AI is taking its turn...
            </span>
          )}
          <PhaseButton
            label="Combat Phase"
            active={state.phase === 'Combat'}
            enabled={state.phase === 'Main' && !aiIsActing}
            onClick={() => state.advancePhase('Combat')}
          />
          <button
            type="button"
            onClick={scrollSafeClick(() => state.endTurn())}
            disabled={state.phase !== 'Combat' || aiIsActing}
            className={`px-3 py-1.5 rounded text-xs font-bold tracking-wide ${
              state.phase === 'Combat' ? 'bg-red-500/80 hover:bg-red-500 text-black' : 'bg-white/5 text-white/25 cursor-not-allowed'
            }`}
          >
            End Turn
          </button>
        </div>

        {state.phase === 'Main' && !aiIsActing && (
          <div className="rounded-lg border border-teal-500/30 bg-[#05050a] p-1.5 text-[11px]">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button type="button"
                disabled={reconfigureDisabled || mode.kind === 'reconfigureReturn' || aiIsActing}
                onClick={scrollSafeClick(() => setMode({ kind: 'reconfigureReturn' }))}
                className="px-2 py-1 rounded border border-teal-400/50 hover:bg-teal-400/10 disabled:opacity-30 font-bold text-teal-200"
              >
                Reconfigure {reconfigureDisabled ? '(used)' : '(once/turn)'}
              </button>
              {mode.kind === 'reconfigureReturn' && (
                <span className="text-teal-300 animate-pulse">Select a Support above to return to hand...</span>
              )}
              {mode.kind === 'reconfigurePlay' && (
                <button type="button" onClick={() => { state.reconfigure(mode.returnId); resetMode(); }} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">
                  Skip — finish Reconfigure
                </button>
              )}
              {(mode.kind === 'reconfigureReturn' || mode.kind === 'reconfigurePlay' || mode.kind === 'reconfigureChain') && (
                <button type="button" onClick={resetMode} className="text-white/40 hover:text-white/70">
                  cancel
                </button>
              )}
            </div>
            {mode.kind === 'reconfigurePlay' && supportBudgetSpent && (
              <div className="mt-1 text-white/40 italic">
                Already played a Support this turn - this Reconfigure can only return a card, not play one in.
              </div>
            )}
            {mode.kind === 'reconfigurePlay' && !supportBudgetSpent && eligibleReconfigurePlays.length > 0 && (
              <div className="mt-1 flex gap-2 flex-wrap">
                {eligibleReconfigurePlays.map((c) => {
                  const def = getCardDef(c.defId);
                  return (
                    <button type="button"
                      key={c.instanceId}
                      onClick={() => {
                        if (mode.kind !== 'reconfigurePlay') return;
                        if (c.type === 'AbilitySupport') {
                          setMode({ kind: 'reconfigureChain', returnId: mode.returnId, playId: c.instanceId });
                        } else {
                          state.reconfigure(mode.returnId, c.instanceId);
                          resetMode();
                        }
                      }}
                      className="px-2 py-1 rounded border border-teal-400/40 hover:bg-teal-400/10"
                    >
                      play {def.name}
                    </button>
                  );
                })}
              </div>
            )}
            {mode.kind === 'reconfigureChain' && (
              <div className="mt-1 text-teal-300 animate-pulse">Now click one of your Apexes above to chain it.</div>
            )}
          </div>
        )}
        </div>

        {mode.kind === 'apexReady' && (
          <ConfirmBar
            text={`Selected: ${selectedCard ? getCardDef(selectedCard.defId).name : 'Apex'} — play into an empty Front Line slot?`}
            onConfirm={() => { state.playApexCard(mode.cardId); resetMode(); }}
            onCancel={resetMode}
          />
        )}
        {mode.kind === 'supportReady' && (
          <ConfirmBar
            text={`Selected: ${selectedCard ? getCardDef(selectedCard.defId).name : 'Support'} — play into an empty Support slot?`}
            onConfirm={() => { state.playSupportCard(mode.cardId); resetMode(); }}
            onCancel={resetMode}
          />
        )}
        {mode.kind === 'supportChooseChain' && (
          <ConfirmBar
            text={`Selected: ${selectedCard ? getCardDef(selectedCard.defId).name : 'Support'} — click one of your Apexes above to chain it, or play it unchained as a vanilla Sync source.`}
            confirmLabel="Play Unchained"
            onConfirm={() => { state.playSupportCard(mode.cardId); resetMode(); }}
            onCancel={resetMode}
          />
        )}
        {mode.kind === 'rechainSelectApex' && (
          <ConfirmBar text="Click one of your Apexes above to chain this Support to it." onCancel={resetMode} />
        )}
        {mode.kind === 'overdrivePrompt' && (
          <div className="rounded-lg border border-yellow-400/40 bg-yellow-400/5 p-2 flex items-center justify-between gap-2 text-xs flex-wrap">
            <span className="text-yellow-200">
              Spend 1 Momentum for {mode.supportName} Overdrive? (+100 {mode.supportName === 'Juice-Box' ? 'DEF' : 'damage'})
            </span>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  state.declareAttack(mode.attackerId, mode.attackId, mode.targetId, true);
                  resetMode();
                }}
                className="px-2 py-1 rounded bg-yellow-300 text-black font-bold"
              >
                Spend 1 Momentum
              </button>
              <button
                type="button"
                onClick={() => {
                  state.declareAttack(mode.attackerId, mode.attackId, mode.targetId, false);
                  resetMode();
                }}
                className="px-2 py-1 rounded bg-white/10 hover:bg-white/20"
              >
                Skip
              </button>
            </div>
          </div>
        )}
        {mode.kind === 'equipReady' && (
          <ConfirmBar
            text={`Selected: ${selectedCard ? getCardDef(selectedCard.defId).name : 'Equip'} — click one of your Apexes above (without an Equip) to attach this.`}
            onCancel={resetMode}
          />
        )}
        {mode.kind === 'specialReady' && !mode.requiresTarget && (
          <ConfirmBar
            text={`Selected: ${selectedCard ? getCardDef(selectedCard.defId).name : 'Special'} — play it now?`}
            onConfirm={() => { state.playSpecialCard(mode.cardId); resetMode(); }}
            onCancel={resetMode}
          />
        )}
        {mode.kind === 'specialReady' && mode.requiresTarget && (
          <ConfirmBar
            text={`Selected: ${selectedCard ? getCardDef(selectedCard.defId).name : 'Special'} — click a valid target (${mode.requiresTarget}) above.`}
            onCancel={resetMode}
          />
        )}

        <Hand
          cards={state.players[viewerBottomId].hand}
          selectedId={selectedCard?.instanceId ?? null}
          onSelect={state.phase === 'Main' && bottomIsActingPlayer && !aiIsActing ? selectHandCard : undefined}
          disabledIds={handDisabledIds}
          onInspectCard={(instance) => setInspected({ instance, ownerId: viewerBottomId, zone: 'Hand' })}
        />
      </div>

      {inspected && (
        <CardInspectModal
          instance={inspected.instance}
          state={state}
          ownerId={inspected.ownerId}
          zone={inspected.zone}
          onClose={() => setInspected(null)}
        />
      )}

      {voidInspecting && (
        <VoidInspectModal
          faction={state.players[voidInspecting].faction}
          cards={state.players[voidInspecting].voidZone}
          onClose={() => setVoidInspecting(null)}
          onInspectCard={(instance) => setInspected({ instance, ownerId: voidInspecting, zone: 'Void' })}
        />
      )}

      {logOpen && (
        <BattleLogDrawer log={state.log} onClose={() => setLogOpen(false)} />
      )}
    </div>
  );
}

function PhaseButton({ label, active, enabled, onClick }: { label: string; active: boolean; enabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.currentTarget.blur();
        const scrollY = window.scrollY;
        onClick();
        requestAnimationFrame(() => {
          if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: 'auto' });
        });
      }}
      disabled={!enabled}
      className={`px-3 py-1.5 rounded text-xs font-bold tracking-wide border ${
        active
          ? 'border-cyan-300 bg-cyan-300/20 text-cyan-100'
          : enabled
          ? 'border-cyan-400/50 hover:bg-cyan-400/10 text-cyan-200'
          : 'border-white/10 text-white/20 cursor-not-allowed'
      }`}
    >
      {label}
    </button>
  );
}

function BattleLogDrawer({ log, onClose }: { log: GameState['log']; onClose: () => void }) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [showFallback, setShowFallback] = useState(false);

  async function handleCopyLog() {
    const text = formatLogAsText(log);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopyStatus('copied');
        setShowFallback(false);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      setCopyStatus('failed');
      setShowFallback(true);
    }
    setTimeout(() => setCopyStatus('idle'), 2500);
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full sm:w-[420px] h-full bg-[#0a0512] border-l border-white/15 flex flex-col p-3 gap-2">
        <div className="flex items-center justify-between shrink-0">
          <div className="text-xs uppercase tracking-widest text-white/50">Battle Log</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleCopyLog} className="text-[10px] px-2 py-1 rounded border border-white/20 hover:bg-white/10">
              {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'failed' ? 'Copy failed' : 'Copy Log'}
            </button>
            <button type="button" onClick={onClose} className="text-[10px] px-2 py-1 rounded border border-white/20 hover:bg-white/10">
              Close
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <GameLog log={log} />
        </div>
        {showFallback && (
          <textarea
            readOnly
            value={formatLogAsText(log)}
            className="w-full h-24 shrink-0 text-[10px] bg-black/60 border border-white/20 rounded p-1"
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
        )}
      </div>
    </div>
  );
}

function ConfirmBar({
  text,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
}: {
  text: string;
  onConfirm?: () => void;
  onCancel: () => void;
  confirmLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-yellow-400/40 bg-yellow-400/5 p-2 flex items-center justify-between gap-2 text-xs">
      <span className="text-yellow-200">{text}</span>
      <div className="flex gap-2 shrink-0">
        {onConfirm && (
          <button type="button" onClick={onConfirm} className="px-2 py-1 rounded bg-yellow-300 text-black font-bold">
            {confirmLabel}
          </button>
        )}
        <button type="button" onClick={onCancel} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">
          Cancel
        </button>
      </div>
    </div>
  );
}

function OpeningApexScreen() {
  const state = useGameStore();
  const selectOpeningApex = useGameStore((s) => s.selectOpeningApex);
  const pid = state.openingApexSelectionPlayerId;
  const isAITurn = state.vsAI && pid === 'player2';

  useEffect(() => {
    if (!isAITurn || !pid) return;
    const apexCards = state.players[pid].hand.filter((c) => c.type === 'Apex');
    if (apexCards.length === 0) return;
    const t = setTimeout(() => selectOpeningApex(pid, apexCards[0].instanceId), 500);
    return () => clearTimeout(t);
  }, [isAITurn, pid, state.players, selectOpeningApex]);

  if (!pid) return null;
  const player = state.players[pid];
  const apexCards = player.hand.filter((c) => c.type === 'Apex');

  if (isAITurn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-fuchsia-300/80 italic animate-pulse text-sm">{player.faction} AI is choosing its opening Apex...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-3xl w-full rounded-xl border border-cyan-400/40 bg-[#05050a] p-6">
        <div className="text-center mb-4">
          <div className="text-[11px] uppercase tracking-widest text-white/40">Opening Hand — choose your starting Apex</div>
          <div className="text-xl font-bold text-cyan-300">
            {pid} ({player.faction})
          </div>
        </div>
        <div className="flex gap-3 flex-wrap justify-center mb-4">
          {player.hand.map((c) => (
            <Card key={c.instanceId} instance={c} disabled={c.type !== 'Apex'} onClick={c.type === 'Apex' ? () => selectOpeningApex(pid, c.instanceId) : undefined} size="lg" />
          ))}
        </div>
        <div className="text-center text-xs text-white/40">Click one of your {apexCards.length} Apex card(s) above to open with it.</div>
      </div>
    </div>
  );
}

function formatLogAsText(log: GameState['log']): string {
  return log.map((entry) => `[T${entry.turn}] ${entry.message}`).join('\n');
}

function GameOverScreen() {
  const state = useGameStore();
  const theme = state.winnerId ? factionTheme(state.players[state.winnerId].faction) : null;
  const loserId: PlayerId | null = state.winnerId ? (state.winnerId === 'player1' ? 'player2' : 'player1') : null;
  const [showLog, setShowLog] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [showFallback, setShowFallback] = useState(false);

  async function handleCopyLog() {
    const text = formatLogAsText(state.log);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopyStatus('copied');
        setShowFallback(false);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      setCopyStatus('failed');
      setShowFallback(true);
    }
    setTimeout(() => setCopyStatus('idle'), 2500);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div
        className="max-w-2xl w-full rounded-xl border-2 p-8"
        style={{ borderColor: theme?.border ?? '#888', boxShadow: theme ? `0 0 40px ${theme.primary}66` : undefined }}
      >
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-widest text-white/40 mb-2">Game Over</div>
          <div className="text-3xl font-black mb-2" style={{ color: theme?.primary ?? '#fff' }}>
            {state.winnerId ? `${state.winnerId} wins!` : 'Draw!'}
          </div>
          {loserId && <div className="text-xs text-white/40 mb-2">{loserId} lost the game.</div>}
          <div className="text-xs text-white/60 mb-4">{state.gameOverReason ?? 'The game has ended.'}</div>

          <div className="flex justify-center gap-6 text-xs font-mono mb-6">
            <div className="text-left">
              <div className="text-white/40 uppercase tracking-widest text-[10px] mb-1">player1</div>
              <div>O2: {state.players.player1.o2}</div>
              <div>Momentum: {state.players.player1.momentum}</div>
            </div>
            <div className="text-left">
              <div className="text-white/40 uppercase tracking-widest text-[10px] mb-1">player2</div>
              <div>O2: {state.players.player2.o2}</div>
              <div>Momentum: {state.players.player2.momentum}</div>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-2 mb-4">
            <button type="button"
              onClick={() => setShowLog((v) => !v)}
              className="px-4 py-2 rounded-md text-xs font-bold bg-white/10 hover:bg-white/20"
            >
              {showLog ? 'Hide Full Game Log' : 'View Full Game Log'}
            </button>
            <button type="button"
              onClick={handleCopyLog}
              className="px-4 py-2 rounded-md text-xs font-bold bg-white/10 hover:bg-white/20"
            >
              {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'failed' ? 'Copy failed - see below' : 'Copy Game Log'}
            </button>
            <button type="button"
              onClick={() => state.resetToMenu()}
              className="px-4 py-2 rounded-md font-bold bg-gradient-to-r from-fuchsia-400 to-cyan-300 text-black"
            >
              Start New Game
            </button>
          </div>
        </div>

        {showFallback && (
          <div className="mb-4">
            <div className="text-[10px] text-white/40 mb-1">
              Clipboard access isn&apos;t available here - select all text below and copy manually.
            </div>
            <textarea
              readOnly
              value={formatLogAsText(state.log)}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full h-40 text-[10px] font-mono bg-black/60 border border-white/20 rounded p-2 text-white/70"
            />
          </div>
        )}

        {showLog && (
          <div className="h-72">
            <GameLog log={state.log} />
          </div>
        )}
      </div>
    </div>
  );
}
