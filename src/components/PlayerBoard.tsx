'use client';

import type { CardInstance, GameState, PlayerId } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { getEffectiveDef } from '@/game/rules';
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
  const isActive = state.activePlayerId === playerId && state.status === 'playing';

  return (
    <div
      className="rounded-lg border p-2 scanlines"
      style={{ borderColor: `${theme.border}55`, background: 'rgba(5,5,12,0.55)' }}
    >
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-bold tracking-widest px-2 py-0.5 rounded ${isActive ? 'text-shadow-glow' : 'opacity-60'}`}
            style={{ color: theme.primary, border: `1px solid ${theme.border}` }}
          >
            {playerId === 'player1' ? 'PLAYER 1' : 'PLAYER 2'} · {player.faction}
            {isActive ? ' ◂ ACTIVE' : ''}
          </span>
          {state.firstPlayerId === playerId && <span className="text-[10px] text-white/40">(went first)</span>}
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          <Stat label="O2" value={player.o2} colorClass="text-sky-300" danger={player.o2 <= 2} />
          <Stat label="MOM" value={player.momentum} colorClass="text-yellow-300" />
          <Stat label="DECK" value={player.deck.length} colorClass="text-white/50" />
          <Stat label="DISC" value={player.discard.length} colorClass="text-white/50" />
          <Stat label="HAND" value={player.hand.length} colorClass="text-white/50" />
          {state.phase === 'Combat' && isActive && <Stat label="SYNC" value={player.availableSync} colorClass="text-fuchsia-300" />}
        </div>
      </div>

      <div className={`flex gap-4 ${flipped ? 'flex-col-reverse' : 'flex-col'}`}>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Front Line - Apex</div>
          <div className="flex gap-2">
            {player.apexSlots.map((apex, i) => (
              <ApexSlot
                key={i}
                apex={apex}
                state={state}
                onClick={onApexClick}
                highlight={apex ? apexHighlight?.(apex.instanceId) ?? null : null}
                disabled={apex ? apexDisabled?.(apex.instanceId) : false}
                selected={apex ? selectedApexId === apex.instanceId : false}
              />
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Support Grid</div>
          <div className="flex gap-2">
            {player.supportSlots.map((support, i) => (
              <SupportSlot
                key={i}
                support={support}
                onClick={onSupportClick}
                disabled={support ? supportDisabled?.(support.instanceId) : false}
                selected={support ? selectedSupportId === support.instanceId : false}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, colorClass, danger }: { label: string; value: number; colorClass: string; danger?: boolean }) {
  return (
    <span className={danger ? 'text-red-400 animate-pulse' : colorClass}>
      {label} <b>{value}</b>
    </span>
  );
}

function ApexSlot({
  apex,
  state,
  onClick,
  highlight,
  disabled,
  selected,
}: {
  apex: CardInstance | null;
  state: GameState;
  onClick?: (id: string) => void;
  highlight: 'valid-target' | 'attacked' | 'locked' | null;
  disabled?: boolean;
  selected?: boolean;
}) {
  if (!apex) {
    return (
      <div className="w-[144px] h-[204px] rounded-md border border-dashed border-white/15 flex items-center justify-center text-[10px] text-white/25">
        empty Apex slot
      </div>
    );
  }
  const effDef = getEffectiveDef(state, apex.instanceId);
  return (
    <Card
      instance={apex}
      effectiveDef={effDef}
      onClick={onClick ? () => onClick(apex.instanceId) : undefined}
      highlight={apex.hasAttacked ? 'attacked' : highlight}
      disabled={disabled}
      selected={selected}
    />
  );
}

function SupportSlot({
  support,
  onClick,
  disabled,
  selected,
}: {
  support: CardInstance | null;
  onClick?: (id: string) => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  if (!support) {
    return (
      <div className="w-[104px] h-[148px] rounded-md border border-dashed border-white/15 flex items-center justify-center text-[9px] text-white/25">
        empty Support slot
      </div>
    );
  }
  const def = getCardDef(support.defId);
  return (
    <Card
      instance={support}
      size="sm"
      onClick={onClick ? () => onClick(support.instanceId) : undefined}
      disabled={disabled}
      selected={selected}
      footer={
        <div className="mt-0.5 text-[8px] leading-tight opacity-80 space-y-0.5">
          {def.type === 'AbilitySupport' && (
            <div className={support.chainedApexId ? 'text-emerald-300' : 'text-red-300'}>
              {support.chainedApexId ? 'chained' : 'UNCHAINED'}
            </div>
          )}
          {support.lockedByControlConflict && <div className="text-blue-300">LOCKED</div>}
          {support.enteredViaReconfigureTurn !== null && support.enteredViaReconfigureTurn !== undefined && (
            <div className="text-white/40">via Reconfigure</div>
          )}
        </div>
      }
    />
  );
}
