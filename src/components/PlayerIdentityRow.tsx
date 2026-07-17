'use client';

import { useState } from 'react';
import type { GameState, PlayerId } from '@/types/game';
import { factionTheme } from '@/lib/theme';
import { O2Stat, MomentumStat } from './SharedStatsBar';
import AudioSettingsControl from '@/audio/AudioSettingsControl';
import type { DragState } from '@/ui/dragDrop/dragDropTypes';
import { useGameStore } from '@/store/gameStore';

/**
 * Commit 37 - a compact identity chip for the centered top row (replacing
 * Commit 36's full-height left sidebar, which took up real board width the
 * play areas needed more). Faction name, O2/Momentum (same O2Stat/
 * MomentumStat SharedStatsBar always used, drag-drop-zone and visual-event
 * logic included, not reimplemented), and Hand count, all in one small row.
 */
export function SidebarPlayerChip({ state, playerId, drag }: { state: GameState; playerId: PlayerId; drag?: DragState | null }) {
  const player = state.players[playerId];
  const theme = factionTheme(player.faction);
  const isActive = state.activePlayerId === playerId && state.status === 'playing';

  // Commit 46 - the chip is ALIVE: the faction nameplate is a spray-stencil
  // tag that flickers like cheap neon while this player is active; critical
  // O2 (<=6) pulses the readout like an alarm; and three momentum pips hum
  // beneath the vitals. O2Stat/MomentumStat stay untouched - they carry the
  // drop-zone and visual-event logic - the life is layered AROUND them.
  const o2Critical = player.o2 <= 6 && state.status === 'playing';

  return (
    <div className="panel-3d rounded-lg border border-white/10 bg-[#05050a] px-2.5 py-1.5">
      <div className={`font-bold tracking-wide text-[12px] mb-1 ${isActive ? '' : 'opacity-60'}`}>
        <span
          className={`stencil-tag ${isActive ? 'text-shadow-glow neon-flicker' : ''}`}
          style={{ color: theme.primary, ['--tag-color' as string]: theme.primary }}
        >
          {player.faction.toUpperCase()}
          {isActive ? ' ◂' : ''}
        </span>
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[12px] whitespace-nowrap">
        <span className={o2Critical ? 'o2-critical' : undefined}>
          <O2Stat playerId={playerId} value={player.o2} color={theme.primary} drag={drag} />
        </span>
        <span className="text-white/20">|</span>
        <MomentumStat playerId={playerId} value={player.momentum} color={theme.primary} />
        <span className="text-white/20">|</span>
        <span className="text-white/40">Hand {player.hand.length}</span>
        <span className="text-white/20">|</span>
        <span className="text-fuchsia-300">Sync {player.availableSync}</span>
      </div>
      <div className="flex items-center gap-1 mt-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`mom-pip ${i < player.momentum ? 'lit' : ''}`}
            style={{ ['--pip-color' as string]: theme.primary }}
          />
        ))}
      </div>
    </div>
  );
}

/** Commit 37 - Options, genuinely collapsed by default, directly below the
 *  identity row. Same collapse behavior as Commit 36's sidebar version, just
 *  laid out as a small centered dropdown instead of a full sidebar block. */
export function OptionsInline({ state, onOpenLog, logHasUnread }: { state: GameState; onOpenLog: () => void; logHasUnread: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="panel-3d rounded-lg border border-white/15 bg-[#05050a] overflow-hidden w-fit">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1 text-[10px] uppercase tracking-widest text-white/50 hover:text-white/80 hover:bg-white/5 flex items-center gap-2"
      >
        Options
        <span className="text-white/30">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 flex items-center gap-2 text-[11px] text-white/50 border-t border-white/10 pt-1.5 flex-wrap justify-center">
          <button
            type="button"
            onClick={onOpenLog}
            className="btn-3d relative px-2 py-1 rounded border border-white/15 hover:bg-white/10 hover:text-white"
          >
            Battle Log
            {logHasUnread && <span className="ml-1 text-fuchsia-300">• New</span>}
          </button>
          <button type="button" onClick={() => useGameStore.getState().resetToMenu()} className="hover:text-white underline px-1">
            Reset
          </button>
          <label className="flex items-center gap-1 text-white/30 hover:text-white/60 cursor-pointer select-none">
            <input type="checkbox" checked={state.debugMode} onChange={() => useGameStore.getState().toggleDebugMode()} className="accent-fuchsia-400" />
            debug
          </label>
          <AudioSettingsControl compact />
        </div>
      )}
    </div>
  );
}
