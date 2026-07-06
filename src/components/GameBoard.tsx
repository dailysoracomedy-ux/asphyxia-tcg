'use client';

import { useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { getCardDef } from '@/data/cards';
import type { ApexDef, SpecialDef, PlayerId } from '@/types/game';
import PlayerBoard from './PlayerBoard';
import Hand from './Hand';
import RiftPanel from './RiftPanel';
import GameLog from './GameLog';
import CombatControls from './CombatControls';
import ResponseModal from './ResponseModal';
import Card from './Card';
import { factionTheme } from '@/lib/theme';

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

  const ownApexHighlight = (id: string): 'valid-target' | null => {
    if (mode.kind === 'supportChooseChain' || mode.kind === 'equipReady' || mode.kind === 'reconfigureChain') return 'valid-target';
    if (mode.kind === 'specialReady' && (mode.requiresTarget === 'ownApex' || mode.requiresTarget === 'ownApexWithUpgrade')) {
      const target = activePlayer.apexSlots.find((a) => a?.instanceId === id);
      if (mode.requiresTarget === 'ownApexWithUpgrade' && (target?.counters?.upgrade ?? 0) === 0) return null;
      return 'valid-target';
    }
    return null;
  };

  const reconfigureDisabled = activePlayer.turnFlags.reconfigureUsedThisTurn || state.phase !== 'Main';
  const eligibleReconfigurePlays =
    mode.kind === 'reconfigurePlay' ? activePlayer.hand.filter((c) => c.type === 'AbilitySupport' || c.type === 'BatterySupport') : [];

  const theme = factionTheme(activePlayer.faction);

  return (
    <div className="min-h-screen p-3 flex flex-col gap-3 max-w-[1400px] mx-auto">
      {state.pendingResponseQueue.length > 0 && <ResponseModal state={state} />}

      <div className="flex items-center justify-between text-white/50 text-xs">
        <div>
          Turn {state.turnNumber} · Phase: <span style={{ color: theme.primary }} className="font-bold">{state.phase}</span>
        </div>
        <button onClick={() => state.resetToMenu()} className="hover:text-white underline">
          Reset to menu
        </button>
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
              onClick={() => state.endTurn()}
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
                  <button
                    key={s!.instanceId}
                    disabled={!!activePlayer.lockedSupportInstanceId}
                    onClick={() => state.lockSupportControlConflict(s!.instanceId)}
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
                <button
                  disabled={reconfigureDisabled || mode.kind === 'reconfigureReturn'}
                  onClick={() => setMode({ kind: 'reconfigureReturn' })}
                  className="px-2 py-1 rounded border border-teal-400/50 hover:bg-teal-400/10 disabled:opacity-30 font-bold text-teal-200"
                >
                  Reconfigure {reconfigureDisabled ? '(used)' : '(once/turn)'}
                </button>
                {mode.kind === 'reconfigureReturn' && (
                  <span className="text-teal-300 animate-pulse">Select a Support above to return to hand...</span>
                )}
                {mode.kind === 'reconfigurePlay' && (
                  <button onClick={() => { state.reconfigure(mode.returnId); resetMode(); }} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">
                    Skip — finish Reconfigure
                  </button>
                )}
                {(mode.kind === 'reconfigureReturn' || mode.kind === 'reconfigurePlay' || mode.kind === 'reconfigureChain') && (
                  <button onClick={resetMode} className="text-white/40 hover:text-white/70">
                    cancel
                  </button>
                )}
              </div>
              {mode.kind === 'reconfigurePlay' && eligibleReconfigurePlays.length > 0 && (
                <div className="mt-2 flex gap-2 flex-wrap">
                  {eligibleReconfigurePlays.map((c) => {
                    const def = getCardDef(c.defId);
                    return (
                      <button
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
      onClick={onClick}
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
          <button onClick={onConfirm} className="px-2 py-1 rounded bg-yellow-300 text-black font-bold">
            Confirm
          </button>
        )}
        <button onClick={onCancel} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">
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

function GameOverScreen() {
  const state = useGameStore();
  const theme = state.winnerId ? factionTheme(state.players[state.winnerId].faction) : null;
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div
        className="max-w-lg w-full rounded-xl border-2 p-8 text-center"
        style={{ borderColor: theme?.border ?? '#888', boxShadow: theme ? `0 0 40px ${theme.primary}66` : undefined }}
      >
        <div className="text-[11px] uppercase tracking-widest text-white/40 mb-2">Game Over</div>
        <div className="text-3xl font-black mb-4" style={{ color: theme?.primary ?? '#fff' }}>
          {state.winnerId ? `${state.winnerId} wins!` : 'Draw!'}
        </div>
        <div className="text-xs text-white/50 mb-6">
          O2 hit zero — Player 1: {state.players.player1.o2}, Player 2: {state.players.player2.o2}
        </div>
        <button
          onClick={() => state.resetToMenu()}
          className="px-6 py-2 rounded-md font-bold bg-gradient-to-r from-fuchsia-400 to-cyan-300 text-black"
        >
          New Game
        </button>
      </div>
    </div>
  );
}
