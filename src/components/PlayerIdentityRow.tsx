'use client';

import { useState } from 'react';
import type { GameState } from '@/types/game';
import AudioSettingsControl from '@/audio/AudioSettingsControl';
import { useGameStore } from '@/store/gameStore';
import { useVfxSettingsStore, type VfxQuality } from '@/store/vfxSettingsStore';

export function OptionsInline({ state, onOpenLog, logHasUnread }: { state: GameState; onOpenLog: () => void; logHasUnread: boolean }) {
  const [open, setOpen] = useState(false);
  // Subscribed (not getState) so the select re-renders when quality changes.
  const vfxQuality = useVfxSettingsStore((s) => s.quality);

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
          {/* Commit 54 - VfxCanvas particle quality. CSS-keyframe vfx are
              unaffected (cheap + carry gameplay readability); this only
              governs the canvas particle layer. */}
          <label className="flex items-center gap-1 text-white/30 hover:text-white/60 cursor-pointer select-none">
            fx
            <select
              value={vfxQuality}
              onChange={(e) => useVfxSettingsStore.getState().setQuality(e.target.value as VfxQuality)}
              className="bg-black/60 border border-white/15 rounded px-1 py-0.5 text-white/70 text-[10px]"
            >
              <option value="high">High</option>
              <option value="low">Low</option>
              <option value="off">Off</option>
            </select>
          </label>
          <AudioSettingsControl compact />
        </div>
      )}
    </div>
  );
}
