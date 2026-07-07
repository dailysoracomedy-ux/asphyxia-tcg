'use client';

import { useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { getCardDef } from '@/data/cards';
import type { ApexDef, SpecialDef, PlayerId, GameState } from '@/types/game';
import PlayerBoard from './PlayerBoard';
import Hand from './Hand';
import RiftPanel from './RiftPanel';
import GameLog from './GameLog';
import CombatControls from './CombatControls';
import HotseatResponseGate from './HotseatResponseGate';
import Card from './Card';
import { factionTheme } from '@/lib/theme';
import { BUILD_VERSION } from '@/lib/version';

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
  | { kind: 'attackAwaitingTarget'; attackerId: string; attackId: string };

export default function GameBoard() {
  const state = useGameStore();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });

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
  const oppId: PlayerId = activeId === 'player1' ? 'player2' : 'player1';
  const activePlayer = state.players[activeId];
  const oppPlayer = state.players[oppId];

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
      state.declareAttack(mode.attackerId, mode.attackId, apexId);
      resetMode();
    }
  }

  function chooseAttack(attackId: string) {
    if (mode.kind !== 'attackerChosen') return;
    const hasEnemyApex = oppPlayer.apexSlots.some(Boolean);
    if (hasEnemyApex) {
      setMode({ kind: 'attackAwaitingTarget', attackerId: mode.attackerId, attackId });
    } else {
      state.declareAttack(mode.attackerId, attackId);
      resetMode();
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
    if (mode.kind === 'supportChooseChain' || mode.kind === 'reconfigureChain') {
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
    if (mode.kind === 'supportChooseChain' || mode.kind === 'reconfigureChain') {
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
    <div className="min-h-screen p-3 flex flex-col gap-3 max-w-[1400px] mx-auto">
      {state.pendingResponseQueue.length > 0 && <HotseatResponseGate state={state} />}

      <div className="flex items-center justify-between text-white/50 text-xs">
        <div>
          Turn {state.turnNumber} · Phase: <span style={{ color: theme.primary }} className="font-bold">{state.phase}</span>
          <span className="text-white/20 ml-2 font-mono">{BUILD_VERSION}</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-white/30 hover:text-white/60 cursor-pointer select-none">
            <input type="checkbox" checked={state.debugMode} onChange={() => state.toggleDebugMode()} className="accent-fuchsia-400" />
            debug log
          </label>
          <button type="button" onClick={() => state.resetToMenu()} className="hover:text-white underline">
            Reset to menu
          </button>
        </div>
      </div>

      <RiftPanel rift={state.riftSpace} />

      <PlayerBoard state={state} playerId={oppId} flipped onApexClick={oppApexClick} apexHighlight={oppApexHighlight} />

      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-3">
          <PlayerBoard
            state={state}
            playerId={activeId}
            onApexClick={ownApexClick}
            onSupportClick={ownSupportClick}
            apexHighlight={ownApexHighlight}
            apexDisabled={ownApexDisabled}
            selectedApexId={
              mode.kind === 'attackerChosen' || mode.kind === 'attackAwaitingTarget' ? mode.attackerId : null
            }
            selectedSupportId={mode.kind === 'reconfigurePlay' || mode.kind === 'reconfigureChain' ? mode.returnId : null}
            supportDisabled={() => mode.kind !== 'reconfigureReturn' && mode.kind !== 'idle'}
          />

          {/* Phase controls */}
          <div className="rounded-lg border border-white/10 bg-black/50 p-2 flex items-center gap-2 flex-wrap">
            <PhaseButton
              label="Start Phase"
              active={state.phase === 'Start'}
              enabled={state.phase === 'Start' && state.startPhasePending}
              onClick={() => state.advancePhase('Start')}
            />
            <PhaseButton
              label="Main Phase"
              active={state.phase === 'Main'}
              enabled={state.phase === 'Start' && !state.startPhasePending}
              onClick={() => state.advancePhase('Main')}
            />
            <PhaseButton
              label="Combat Phase"
              active={state.phase === 'Combat'}
              enabled={state.phase === 'Main'}
              onClick={() => state.advancePhase('Combat')}
            />
            <button
              type="button"
              onClick={scrollSafeClick(() => state.endTurn())}
              disabled={state.phase !== 'Combat'}
              className={`px-3 py-1.5 rounded text-xs font-bold tracking-wide ${
                state.phase === 'Combat' ? 'bg-red-500/80 hover:bg-red-500 text-black' : 'bg-white/5 text-white/25 cursor-not-allowed'
              }`}
            >
              End Turn
            </button>

            {state.riftSpace?.id === 'ControlConflict' && state.phase === 'Start' && !state.startPhasePending && (
              <div className="flex items-center gap-1 ml-2 border-l border-white/10 pl-2">
                <span className="text-[10px] text-blue-300">Control Conflict:</span>
                {activePlayer.supportSlots.filter(Boolean).map((s) => (
                  <button type="button"
                    key={s!.instanceId}
                    disabled={!!activePlayer.lockedSupportInstanceId}
                    onClick={scrollSafeClick(() => state.lockSupportControlConflict(s!.instanceId))}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-blue-400/50 hover:bg-blue-400/10 disabled:opacity-30"
                  >
                    lock {getCardDef(s!.defId).name}
                  </button>
                ))}
              </div>
            )}
          </div>

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

          {state.phase === 'Main' && (
            <div className="rounded-lg border border-teal-500/30 bg-black/50 p-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button"
                  disabled={reconfigureDisabled || mode.kind === 'reconfigureReturn'}
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
                <div className="mt-2 text-white/40 italic">
                  Already played a Support this turn - this Reconfigure can only return a card, not play one in.
                </div>
              )}
              {mode.kind === 'reconfigurePlay' && !supportBudgetSpent && eligibleReconfigurePlays.length > 0 && (
                <div className="mt-2 flex gap-2 flex-wrap">
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
                <div className="mt-2 text-teal-300 animate-pulse">Now click one of your Apexes above to chain it.</div>
              )}
            </div>
          )}

          <Hand
            cards={activePlayer.hand}
            selectedId={selectedCard?.instanceId ?? null}
            onSelect={state.phase === 'Main' ? selectHandCard : undefined}
            disabledIds={handDisabledIds}
          />

          {mode.kind === 'apexReady' && (
            <ConfirmBar
              text="Play this Apex into an empty Front Line slot?"
              onConfirm={() => { state.playApexCard(mode.cardId); resetMode(); }}
              onCancel={resetMode}
            />
          )}
          {mode.kind === 'supportReady' && (
            <ConfirmBar
              text="Play this Support into an empty Support slot?"
              onConfirm={() => { state.playSupportCard(mode.cardId); resetMode(); }}
              onCancel={resetMode}
            />
          )}
          {mode.kind === 'supportChooseChain' && (
            <ConfirmBar text="Click one of your Apexes above to chain this Ability Support to it." onCancel={resetMode} />
          )}
          {mode.kind === 'equipReady' && (
            <ConfirmBar text="Click one of your Apexes above (without an Equip) to attach this." onCancel={resetMode} />
          )}
          {mode.kind === 'specialReady' && !mode.requiresTarget && (
            <ConfirmBar
              text="Play this Special?"
              onConfirm={() => { state.playSpecialCard(mode.cardId); resetMode(); }}
              onCancel={resetMode}
            />
          )}
          {mode.kind === 'specialReady' && mode.requiresTarget && (
            <ConfirmBar
              text={`Click a valid target (${mode.requiresTarget}) above.`}
              onCancel={resetMode}
            />
          )}
        </div>

        <div className="w-[320px] shrink-0">
          <GameLog log={state.log} />
        </div>
      </div>
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

function ConfirmBar({ text, onConfirm, onCancel }: { text: string; onConfirm?: () => void; onCancel: () => void }) {
  return (
    <div className="rounded-lg border border-yellow-400/40 bg-yellow-400/5 p-2 flex items-center justify-between gap-2 text-xs">
      <span className="text-yellow-200">{text}</span>
      <div className="flex gap-2 shrink-0">
        {onConfirm && (
          <button type="button" onClick={onConfirm} className="px-2 py-1 rounded bg-yellow-300 text-black font-bold">
            Confirm
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
  if (!pid) return null;
  const player = state.players[pid];
  const apexCards = player.hand.filter((c) => c.type === 'Apex');

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-3xl w-full rounded-xl border border-cyan-400/40 bg-black/70 p-6">
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
