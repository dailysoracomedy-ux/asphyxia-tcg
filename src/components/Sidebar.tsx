'use client';

import { useState } from 'react';
import type { GameState, PlayerId } from '@/types/game';
import { factionTheme } from '@/lib/theme';
import { BUILD_VERSION } from '@/lib/version';
import { O2Stat, MomentumStat } from './SharedStatsBar';
import AudioSettingsControl from '@/audio/AudioSettingsControl';
import type { DragState } from '@/ui/dragDrop/dragDropTypes';
import { useGameStore } from '@/store/gameStore';

/**
 * Commit 36 - the persistent left sidebar, replacing the old horizontal top
 * bar + centered identity row entirely. Logo up top, both players' identity
 * and O2/Momentum stacked underneath (using the exact same O2Stat/
 * MomentumStat SharedStatsBar already used, including their drag-drop-zone
 * and visual-event logic, not a reimplementation), and a genuinely
 * collapsible Options panel at the bottom - closed by default per direct
 * request, since debug/audio/log/reset aren't things anyone touches mid-game.
 */
export default function Sidebar({
  state,
  topId,
  bottomId,
  drag,
  onOpenLog,
  logHasUnread,
}: {
  state: GameState;
  topId: PlayerId;
  bottomId: PlayerId;
  drag?: DragState | null;
  onOpenLog: () => void;
  logHasUnread: boolean;
}) {
  return (
    <div className="w-[190px] shrink-0 flex flex-col gap-2 overflow-y-auto">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/asphyxia-logo.png" alt="ASPHYXIA" className="w-full select-none pointer-events-none" draggable={false} />
      <div className="text-center text-white/20 text-[9px] font-mono -mt-1">{BUILD_VERSION}</div>

      <SidebarPlayerBlock state={state} playerId={topId} drag={drag} />
      <SidebarPlayerBlock state={state} playerId={bottomId} drag={drag} />

      <OptionsPanel state={state} onOpenLog={onOpenLog} logHasUnread={logHasUnread} />
    </div>
  );
}

function SidebarPlayerBlock({ state, playerId, drag }: { state: GameState; playerId: PlayerId; drag?: DragState | null }) {
  const player = state.players[playerId];
  const theme = factionTheme(player.faction);
  const isActive = state.activePlayerId === playerId && state.status === 'playing';

  return (
    <div className="rounded-lg border border-white/10 bg-[#05050a] px-2 py-1.5">
      <div
        className={`font-bold tracking-wide text-[11px] ${isActive ? 'text-shadow-glow' : 'opacity-60'}`}
        style={{ color: theme.primary, border: `1px solid ${theme.border}`, borderRadius: 4, padding: '1px 6px', display: 'inline-block' }}
      >
        {player.faction}
        {isActive ? ' ◂' : ''}
      </div>
      <div className="flex items-center gap-3 text-xs font-mono mt-1">
        <O2Stat playerId={playerId} value={player.o2} color={theme.primary} drag={drag} />
        <MomentumStat playerId={playerId} value={player.momentum} color={theme.primary} />
      </div>
      <div className="text-[10px] text-white/40 mt-0.5">
        HAND {player.hand.length}
        {state.phase === 'Combat' && isActive && <span className="text-fuchsia-300 ml-2">SYNC {player.availableSync}</span>}
      </div>
    </div>
  );
}

function OptionsPanel({ state, onOpenLog, logHasUnread }: { state: GameState; onOpenLog: () => void; logHasUnread: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-white/15 bg-[#05050a] overflow-hidden mt-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2 py-1.5 text-[11px] uppercase tracking-widest text-white/50 hover:text-white/80 hover:bg-white/5 flex items-center justify-between"
      >
        Options
        <span className="text-white/30">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 flex flex-col gap-1.5 text-[11px] text-white/50 border-t border-white/10 pt-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onOpenLog();
              }}
              className="relative px-2 py-1 rounded border border-white/15 hover:bg-white/10 hover:text-white flex-1"
            >
              Battle Log
              {logHasUnread && <span className="ml-1 text-fuchsia-300">• New</span>}
            </button>
            <button type="button" onClick={() => useGameStore.getState().resetToMenu()} className="hover:text-white underline px-1">
              Reset
            </button>
          </div>
          <label className="flex items-center gap-1 text-white/30 hover:text-white/60 cursor-pointer select-none">
            <input type="checkbox" checked={state.debugMode} onChange={() => useGameStore.getState().toggleDebugMode()} className="accent-fuchsia-400" />
            debug
          </label>
          <AudioSettingsControl />
        </div>
      )}
    </div>
  );
}
