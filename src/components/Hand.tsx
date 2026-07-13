'use client';

import type { CardInstance, GameState, PlayerId } from '@/types/game';
import Card from './Card';
import { canPlayCardFromHand, getCardPlayabilityReason } from '@/lib/cardPlayability';

interface HandProps {
  cards: CardInstance[];
  selectedId?: string | null;
  onSelect?: (instanceId: string) => void;
  disabledIds?: Set<string>;
  label?: string;
  onInspectCard?: (instance: CardInstance) => void;
  /** Floor for the container's width, in px - typically the board's own measured
   *  width, so Hand never reads narrower than the board above it. The container
   *  still hugs its actual content otherwise, and grows past this floor for a
   *  large hand rather than ever clipping or wrapping unexpectedly. */
  minWidth?: number;
  /** Needed to compute per-card playability for hand-dimming (Commit 23). Optional
   *  so any future non-interactive read-only hand display can skip dimming
   *  entirely by simply not passing these. */
  state?: GameState;
  playerId?: PlayerId;
  /** Commit 30 - starts a potential drag for a playable hand card. Only
   *  playable cards get this wired (see the `playable` check below) - an
   *  unplayable card has no legal drop zones anyway, so dragging it would
   *  never do anything, and this keeps that explicit rather than relying on
   *  an empty legal-zone set to silently no-op. */
  onCardPointerDown?: (e: React.PointerEvent, card: CardInstance) => void;
  /** Commit 31 - during a guided tutorial step, exactly one hand card is the
   *  correct one to drag. That card gets the spotlight; everything else in
   *  hand dims and stops responding to pointer events entirely (not just
   *  disabled styling - the tutorial's whole point is that only the
   *  correct thing can be touched right now). */
  tutorialSpotlightInstanceId?: string | null;
}

export default function Hand({
  cards,
  selectedId,
  onSelect,
  disabledIds,
  label,
  onInspectCard,
  minWidth,
  state,
  playerId,
  onCardPointerDown,
  tutorialSpotlightInstanceId,
}: HandProps) {
  return (
    <div
      className="rounded-lg border border-white/10 bg-[#05050a] p-1.5 max-h-[168px] shrink-0 w-fit max-w-full mx-auto"
      style={{ minWidth }}
    >
      <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">{label ?? 'Hand'} ({cards.length})</div>
      <div className="flex gap-2 overflow-x-auto overflow-y-hidden pb-1 justify-center">
        {cards.length === 0 && <div className="text-white/30 text-xs italic px-2 py-4">No cards in hand.</div>}
        {cards.map((c) => {
          const playable = state && playerId ? canPlayCardFromHand(state, playerId, c) : true;
          const reason = state && playerId && !playable ? getCardPlayabilityReason(state, playerId, c) : null;
          const tutorialHighlight: 'tutorial-target' | 'tutorial-dim' | null =
            tutorialSpotlightInstanceId === undefined
              ? null
              : c.instanceId === tutorialSpotlightInstanceId
              ? 'tutorial-target'
              : 'tutorial-dim';
          return (
            <div key={c.instanceId} title={reason ?? undefined}>
              <Card
                instance={c}
                size="hand"
                selected={selectedId === c.instanceId}
                disabled={disabledIds?.has(c.instanceId)}
                isPlayable={playable}
                highlight={tutorialHighlight}
                onClick={onSelect ? () => onSelect(c.instanceId) : undefined}
                onPointerDown={playable && onCardPointerDown && tutorialHighlight !== 'tutorial-dim' ? (e) => onCardPointerDown(e, c) : undefined}
                onInspect={onInspectCard ? () => onInspectCard(c) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
