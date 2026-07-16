'use client';

import { useState } from 'react';
import type { CardInstance, GameState, PlayerId } from '@/types/game';
import Card from './Card';
import { canPlayCardFromHand, getCardPlayabilityReason } from '@/lib/cardPlayability';
import { playSfx } from '@/audio/sfx';

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

const HAND_CARD_H = 194; // matches Card.tsx's 'hand' size preset height exactly
const HAND_PEEK_H = 97; // how much of a tucked card's top is visible by default - about half the card
const HAND_TUCK_OFFSET = HAND_CARD_H - HAND_PEEK_H;

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
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="shrink-0 w-fit max-w-full mx-auto px-1.5 relative z-20 pointer-events-auto" style={{ minWidth }}>
      <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">{label ?? 'Hand'} ({cards.length})</div>
      {/* The reserved track - sized to exactly the tucked peek height, not the
          full card height, so there's no empty reserved space above the
          peeking cards. Overflow switches to visible only while a card is
          actually hovered, letting just that card escape upward to show its
          full height - safe since nothing above this in the page clips
          anymore (confirmed in earlier work), while every other card stays
          cropped to its normal peek. */}
      <div className="relative" style={{ height: HAND_PEEK_H, overflow: hoveredId ? 'visible' : 'hidden' }}>
        <div className="flex gap-2 pb-1 justify-center h-full">
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
            const isHovered = hoveredId === c.instanceId;
            return (
              <div
                key={c.instanceId}
                title={reason ?? undefined}
                onMouseEnter={() => {
                  if (playable) playSfx('ui.hover');
                  setHoveredId(c.instanceId);
                }}
                onMouseLeave={() => setHoveredId((cur) => (cur === c.instanceId ? null : cur))}
                className="vfx-draw-in relative shrink-0 transition-[top] duration-150 ease-out"
                style={{ top: isHovered ? -HAND_TUCK_OFFSET : 0, zIndex: isHovered ? 40 : undefined }}
              >
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
    </div>
  );
}
