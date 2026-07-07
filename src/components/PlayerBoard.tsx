'use client';

import { useState } from 'react';
import type { CardInstance, GameState, PlayerId } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { getEffectiveDef, getPreviewAttackDamage, getChainedSupportFor, getChainLabelForSupport, MAX_MOMENTUM } from '@/game/rules';
import Card from './Card';
import { factionTheme } from '@/lib/theme';

interface PlayerBoardProps {
  state: GameState;
  playerId: PlayerId;
  flipped?: boolean;
  onApexClick?: (instanceId: string) => void;
  onSupportClick?: (instanceId: string) => void;
  apexHighlight?: (instanceId: string) => 'valid-target' | 'attacked' | 'locked' | null;
  apexDisabled?: (instanceId: string) => boolean;
  supportDisabled?: (instanceId: string) => boolean;
  selectedApexId?: string | null;
  selectedSupportId?: string | null;
}

/** Compact single-line player status chips - O2/MOM/DECK/VOID/HAND - meant for the
 *  top status bar so the board rows below only need to show Apex/Support slots. */
export function PlayerStatusChips({ state, playerId }: { state: GameState; playerId: PlayerId }) {
  const player = state.players[playerId];
  const theme = factionTheme(player.faction);
  const isActive = state.activePlayerId === playerId && state.status === 'playing';
  const [voidOpen, setVoidOpen] = useState(false);

  return (
    <div className="relative flex items-center gap-2 text-[11px] font-mono flex-wrap">
      <span
        className={`font-bold tracking-wide px-1.5 py-0.5 rounded shrink-0 ${isActive ? 'text-shadow-glow' : 'opacity-60'}`}
        style={{ color: theme.primary, border: `1px solid ${theme.border}` }}
      >
        {player.faction}
        {isActive ? ' ◂' : ''}
      </span>
      <Stat label="O2" value={player.o2} colorClass="text-sky-300" danger={player.o2 <= 4} />
      <Stat label="MOM" value={`${player.momentum}/${MAX_MOMENTUM}`} colorClass="text-yellow-300" />
      <Stat label="DECK" value={player.deck.length} colorClass="text-white/50" />
      <button type="button" onClick={() => setVoidOpen((v) => !v)} className="hover:opacity-80">
        <Stat label="VOID" value={player.voidZone.length} colorClass="text-white/50" />
      </button>
      <Stat label="HAND" value={player.hand.length} colorClass="text-white/50" />
      {state.phase === 'Combat' && isActive && <Stat label="SYNC" value={player.availableSync} colorClass="text-fuchsia-300" />}
      {voidOpen && (
        <div className="absolute top-full left-0 mt-1 z-20 w-56 rounded border border-white/15 bg-black/90 p-2 text-[10px] max-h-40 overflow-y-auto">
          {player.voidZone.length === 0 ? (
            <div className="text-white/40 italic">Void is empty.</div>
          ) : (
            <div className="space-y-0.5">
              {player.voidZone.map((c, i) => {
                const d = getCardDef(c.defId);
                return (
                  <div key={`${c.instanceId}-${i}`} className="truncate text-white/70">
                    {d.name} <span className="text-white/40">({d.type}{d.faction ? `, ${d.faction}` : ''})</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PlayerBoard({
  state,
  playerId,
  flipped,
  onApexClick,
  onSupportClick,
  apexHighlight,
  apexDisabled,
  supportDisabled,
  selectedApexId,
  selectedSupportId,
}: PlayerBoardProps) {
  const player = state.players[playerId];
  const theme = factionTheme(player.faction);

  return (
    <div
      className="rounded-lg border p-1.5 scanlines h-full min-h-0 flex flex-col"
      style={{ borderColor: `${theme.border}55`, background: 'rgba(5,5,12,0.55)' }}
    >
      <div className={`flex-1 min-h-0 flex gap-3 items-start justify-center ${flipped ? 'flex-row-reverse' : ''}`}>
        <div className="flex gap-1.5 shrink-0">
          {player.apexSlots.map((apex, i) => (
            <ApexSlot
              key={i}
              apex={apex}
              state={state}
              playerId={playerId}
              onClick={onApexClick}
              highlight={apex ? apexHighlight?.(apex.instanceId) ?? null : null}
              disabled={apex ? apexDisabled?.(apex.instanceId) : false}
              selected={apex ? selectedApexId === apex.instanceId : false}
            />
          ))}
        </div>
        <div className="w-px self-stretch bg-white/10 shrink-0" />
        <div className="flex gap-1.5 shrink-0">
          {player.supportSlots.map((support, i) => (
            <SupportSlot
              key={i}
              support={support}
              state={state}
              playerId={playerId}
              onClick={onSupportClick}
              disabled={support ? supportDisabled?.(support.instanceId) : false}
              selected={support ? selectedSupportId === support.instanceId : false}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, colorClass, danger }: { label: string; value: number | string; colorClass: string; danger?: boolean }) {
  return (
    <span className={danger ? 'text-red-400 animate-pulse' : colorClass}>
      {label} <b>{value}</b>
    </span>
  );
}

function ApexSlot({
  apex,
  state,
  playerId,
  onClick,
  highlight,
  disabled,
  selected,
}: {
  apex: CardInstance | null;
  state: GameState;
  playerId: PlayerId;
  onClick?: (id: string) => void;
  highlight: 'valid-target' | 'attacked' | 'locked' | null;
  disabled?: boolean;
  selected?: boolean;
}) {
  if (!apex) {
    return (
      <div className="w-[128px] h-[152px] rounded-md border border-dashed border-white/15 flex items-center justify-center text-[9px] text-white/25 text-center px-1">
        empty Apex slot
      </div>
    );
  }
  const effDef = getEffectiveDef(state, apex.instanceId);
  const apexCardDef = getCardDef(apex.defId);
  const attackPreviews: Record<string, NonNullable<ReturnType<typeof getPreviewAttackDamage>>> = {};
  if (apexCardDef.type === 'Apex') {
    for (const atk of apexCardDef.attacks) {
      const preview = getPreviewAttackDamage(state, apex.instanceId, atk.id);
      if (preview) attackPreviews[atk.id] = preview;
    }
  }

  // Chain indicator: which Ability Support (if any) is chained to this Apex.
  const chainedSupport = getChainedSupportFor(state, playerId, apex.instanceId);

  return (
    <Card
      instance={apex}
      size="apexBoard"
      compact
      effectiveDef={effDef}
      attackPreviews={attackPreviews}
      onClick={onClick ? () => onClick(apex.instanceId) : undefined}
      highlight={apex.hasAttacked ? 'attacked' : highlight}
      disabled={disabled}
      selected={selected}
      footer={
        chainedSupport ? (
          <div className="mt-0.5 px-1 rounded bg-black/40 border border-teal-400/40 text-teal-300 truncate">
            Sup: {getCardDef(chainedSupport.defId).name}
          </div>
        ) : undefined
      }
    />
  );
}

function SupportSlot({
  support,
  state,
  playerId,
  onClick,
  disabled,
  selected,
}: {
  support: CardInstance | null;
  state: GameState;
  playerId: PlayerId;
  onClick?: (id: string) => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  if (!support) {
    return (
      <div className="w-[96px] h-[100px] rounded-md border border-dashed border-white/15 flex items-center justify-center text-[8.5px] text-white/25 text-center px-1">
        empty Support slot
      </div>
    );
  }
  const chainLabel = getChainLabelForSupport(state, playerId, support.instanceId);

  return (
    <Card
      instance={support}
      size="supportBoard"
      compact
      onClick={onClick ? () => onClick(support.instanceId) : undefined}
      disabled={disabled}
      selected={selected}
      footer={
        <div className="mt-0.5 text-[7.5px] leading-tight opacity-80 space-y-0.5">
          {chainLabel && (
            <div className={chainLabel === 'Unchained' ? 'text-red-300' : 'text-emerald-300'}>{chainLabel}</div>
          )}
          {support.lockedByControlConflict && <div className="text-blue-300">LOCKED</div>}
        </div>
      }
    />
  );
}
