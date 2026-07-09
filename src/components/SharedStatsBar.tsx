'use client';

import type { GameState, PlayerId } from '@/types/game';
import { factionTheme } from '@/lib/theme';
import { MAX_MOMENTUM } from '@/game/rules';

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
        <Stat label="O2" value={left.o2} color={leftTheme.primary} danger={left.o2 <= 4} />
        <Stat label="MOM" value={`${left.momentum}/${MAX_MOMENTUM}`} color={leftTheme.primary} />
      </div>
      <div className="w-px h-4 bg-white/15" />
      <div className="flex items-center gap-3">
        <Stat label="O2" value={right.o2} color={rightTheme.primary} danger={right.o2 <= 4} />
        <Stat label="MOM" value={`${right.momentum}/${MAX_MOMENTUM}`} color={rightTheme.primary} />
      </div>
    </div>
  );
}

function Stat({ label, value, color, danger }: { label: string; value: number | string; color: string; danger?: boolean }) {
  return (
    <span className={danger ? 'text-red-400 animate-pulse font-bold' : 'font-bold'} style={danger ? undefined : { color }}>
      {label} <b>{value}</b>
    </span>
  );
}
