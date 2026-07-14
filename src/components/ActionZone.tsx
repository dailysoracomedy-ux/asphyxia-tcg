'use client';

import type { PlayerId } from '@/types/game';
import type { DragState } from '@/ui/dragDrop/dragDropTypes';
import { zoneKey } from '@/ui/dragDrop/dragDropTypes';

/**
 * Commit 30 - compact drop target for non-targeted Specials, sitting under
 * that player's Deck/Void stacks per the spec's preferred layout. Purely a
 * drop zone (and, outside a drag, a small label) - it has no click behavior
 * of its own, matching "Deck/Void remain automatic visual zones" nearby it.
 *
 * Commit 30.3 - the actual hit area is deliberately larger than what's
 * visible (a -m/p trick: negative margin cancels the padding out visually,
 * but the element's real hit-testing box is bigger). Reported directly:
 * dropping onto the tiny visual rectangle was "comically bad" - the visual
 * size stays exactly the same, only the invisible margin around it grew.
 */
export default function ActionZone({ playerId, drag }: { playerId: PlayerId; drag?: DragState | null }) {
  const key = zoneKey({ kind: 'action-zone', playerId });
  const isLegalDropTarget = !!drag?.active && drag.legalZoneKeys.has(key);
  const isHovered = drag?.hoveredZoneKey === key;

  return (
    <div data-dropzone={isLegalDropTarget ? JSON.stringify({ kind: 'action-zone', playerId }) : undefined} className="-m-8 p-8">
      <div
        className={`rounded-md border flex items-center justify-center text-center text-[11px] uppercase tracking-widest transition-shadow ${
          isLegalDropTarget
            ? isHovered
              ? 'border-emerald-300 text-emerald-200 ring-4 ring-emerald-300 shadow-[0_0_30px_rgba(52,211,153,0.9)] bg-emerald-400/10'
              : 'border-emerald-400/70 text-emerald-300/80 ring-2 ring-emerald-400/70 shadow-[0_0_16px_rgba(52,211,153,0.5)]'
            : 'border-white/10 text-white/25'
        }`}
        style={{ width: 90, height: 100 }}
      >
        Action
      </div>
    </div>
  );
}
