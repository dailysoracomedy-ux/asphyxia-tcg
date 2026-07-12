'use client';

import type { PlayerId } from '@/types/game';
import type { DragState } from '@/ui/dragDrop/dragDropTypes';
import { zoneKey } from '@/ui/dragDrop/dragDropTypes';

/**
 * Commit 30 - compact drop target for non-targeted Specials, sitting under
 * that player's Deck/Void stacks per the spec's preferred layout. Purely a
 * drop zone (and, outside a drag, a small label) - it has no click behavior
 * of its own, matching "Deck/Void remain automatic visual zones" nearby it;
 * Specials still have a full click-to-play fallback via the normal hand-card
 * click flow, this only adds the drag destination.
 */
export default function ActionZone({ playerId, drag }: { playerId: PlayerId; drag?: DragState | null }) {
  const key = zoneKey({ kind: 'action-zone', playerId });
  const isLegalDropTarget = !!drag?.active && drag.legalZoneKeys.has(key);
  const isHovered = drag?.hoveredZoneKey === key;

  return (
    <div
      data-dropzone={isLegalDropTarget ? JSON.stringify({ kind: 'action-zone', playerId }) : undefined}
      className={`rounded-md border text-center text-[9px] uppercase tracking-widest py-1.5 transition-shadow ${
        isLegalDropTarget
          ? isHovered
            ? 'border-emerald-300 text-emerald-200 ring-4 ring-emerald-300 shadow-[0_0_30px_rgba(52,211,153,0.9)] bg-emerald-400/10'
            : 'border-emerald-400/70 text-emerald-300/80 ring-2 ring-emerald-400/70 shadow-[0_0_16px_rgba(52,211,153,0.5)]'
          : 'border-white/10 text-white/25'
      }`}
    >
      Action
    </div>
  );
}
