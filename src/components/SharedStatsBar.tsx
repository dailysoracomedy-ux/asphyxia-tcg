'use client';

import type { GameState, PlayerId } from '@/types/game';
import { factionTheme } from '@/lib/theme';
import { MAX_MOMENTUM } from '@/game/rules';
import { usePlayerVisualEvents } from '@/store/animationStore';

/**
 * One shared, centered O2/Momentum readout for both players - left value/color
 * always matches whichever player is shown on the left side of the board
 * (viewerTopId), right always matches the right side (viewerBottomId), so it stays
 * visually consistent with the board regardless of Hotseat's turn-based left/right
 * swap or Vs AI's fixed layout.
 */
export default function SharedStatsBar({ state, leftId, rightId }: { state: GameState; leftId: PlayerId; rightId: PlayerId }) {
  const left = state.players[leftId];
  const right = state.players[rightId];
  const leftTheme = factionTheme(left.faction);
  const rightTheme = factionTheme(right.faction);

  return (
    <div className="flex items-center justify-center gap-6 shrink-0 text-xs font-mono">
      <div className="flex items-center gap-3">
        <O2Stat playerId={leftId} value={left.o2} color={leftTheme.primary} />
        <Stat label="MOM" value={`${left.momentum}/${MAX_MOMENTUM}`} color={leftTheme.primary} />
      </div>
      <div className="w-px h-4 bg-white/15" />
      <div className="flex items-center gap-3">
        <O2Stat playerId={rightId} value={right.o2} color={rightTheme.primary} />
        <Stat label="MOM" value={`${right.momentum}/${MAX_MOMENTUM}`} color={rightTheme.primary} />
      </div>
    </div>
  );
}

/** O2 gets its own wrapper (rather than reusing the plain Stat) so it can read live
 *  O2_DAMAGE/OVERFLOW_DAMAGE visual events (Commit 23) for this specific player and
 *  show a brief flash + floating "-X O2" popup - purely additive on top of the
 *  existing danger-red pulse for low O2, never replacing it. */
function O2Stat({ playerId, value, color }: { playerId: PlayerId; value: number; color: string }) {
  const events = usePlayerVisualEvents(playerId).filter((e) => e.type === 'O2_DAMAGE' || e.type === 'OVERFLOW_DAMAGE');
  const danger = value <= 4;
  const hit = events.length > 0;

  return (
    <span className="relative inline-block">
      <span
        className={`font-bold ${danger ? 'text-red-400 animate-pulse' : ''} ${hit ? 'vfx-hit-flash' : ''}`}
        style={danger ? undefined : { color }}
      >
        O2 <b>{value}</b>
      </span>
      {events.map((e) => (
        <span
          key={e.id}
          className="vfx-damage-popup absolute left-1/2 -top-1 -translate-x-1/2 z-20 pointer-events-none font-mono font-bold whitespace-nowrap text-orange-400"
          style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}
        >
          {e.label}
        </span>
      ))}
    </span>
  );
}

function Stat({ label, value, color, danger }: { label: string; value: number | string; color: string; danger?: boolean }) {
  return (
    <span className={danger ? 'text-red-400 animate-pulse font-bold' : 'font-bold'} style={danger ? undefined : { color }}>
      {label} <b>{value}</b>
    </span>
  );
}
