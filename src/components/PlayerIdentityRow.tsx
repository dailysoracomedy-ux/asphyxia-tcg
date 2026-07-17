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

  // Commit 47 - hand-made per-faction stat plate (public/ui/, 255x60 at 1x,
  // opaque art with its own border baked in). Fixed box so the art never
  // stretches; typography sized so every stat fits inside the art's border
  // (same principle as the Apex overlay's scaledPx clamping - the box is a
  // constant 255px, so the clamp resolves to fixed sizes chosen to fit).
  const STAT_BOX_ART: Record<string, string> = {
    'Neon Underground': '/ui/stat-box-neon.webp',
    'Dark White': '/ui/stat-box-dark-white.webp',
    'Synth Ascendancy': '/ui/stat-box-synth-ascendancy.webp',
  };

  return (
    <div
      className="relative w-[255px] h-[60px] rounded-lg overflow-hidden px-4 flex flex-col justify-center"
      style={{
        backgroundImage: `url(${STAT_BOX_ART[player.faction] ?? STAT_BOX_ART['Neon Underground']})`,
        backgroundSize: '100% 100%',
        // Commit 48 - the faction NAME is painted into the plate art itself,
        // so the chip no longer renders its own name line (the two were
        // colliding). Active turn reads as a glow ring + arrow; stats are a
        // single clean centered row inside the art's border, pips below.
        boxShadow: isActive ? `0 0 12px ${theme.primary}aa, inset 0 0 10px ${theme.primary}33` : 'none',
        transition: 'box-shadow 250ms ease',
      }}
    >
      <div className="flex items-center gap-1.5 font-mono text-[11.5px] leading-none whitespace-nowrap justify-center">
        <span className={o2Critical ? 'o2-critical' : undefined}>
          <O2Stat playerId={playerId} value={player.o2} color={theme.primary} drag={drag} />
        </span>
        <span className="text-white/25">|</span>
        <MomentumStat playerId={playerId} value={player.momentum} color={theme.primary} />
        <span className="text-white/25">|</span>
        <span className="text-white/50">Hand {player.hand.length}</span>
        <span className="text-white/25">|</span>
        <span className="text-fuchsia-300">Sync {player.availableSync}</span>
        {isActive && (
          <span className="neon-flicker font-black" style={{ color: theme.primary }}>
            ◂
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 mt-[5px] justify-center" aria-hidden>
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
