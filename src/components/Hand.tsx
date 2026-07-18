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

const HAND_CARD_W = 155; // matches Card.tsx's 'hand' size preset width exactly
const HAND_CARD_H = 194; // matches Card.tsx's 'hand' size preset height exactly
const HAND_PEEK_H = 97; // how much of a tucked card's top is visible by default - about half the card
const HAND_TUCK_OFFSET = HAND_CARD_H - HAND_PEEK_H;
// Commit 50.8 - cards overlap by this much (each card's left edge tucks under
// its left neighbor), so the hand reads as a held fan, not spaced tiles.
const HAND_CARD_OVERLAP = 46;
// The hover/interaction trigger is inset this far from every card edge, so
// overlapping cards' triggers never touch - the gutter between them is a
// neutral no-hover zone that stops enter/leave thrash (the jitter). Large
// enough that the top-right info (i) button sits OUTSIDE the pad and stays
// directly clickable.
const HAND_TRIGGER_INSET = 24;

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
      <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">{label ?? 'Hand'} ({cards.length})</div>
      {/* The reserved track - sized to exactly the tucked peek height, not the
          full card height, so there's no empty reserved space above the
          peeking cards. Overflow switches to visible only while a card is
          actually hovered, letting just that card escape upward to show its
          full height - safe since nothing above this in the page clips
          anymore (confirmed in earlier work), while every other card stays
          cropped to its normal peek. */}
      {/* Commit 50 (section 7) - intentional horizontal scroll instead of
          accidental cropping: a hand that genuinely overflows the viewport
          width now scrolls rather than spilling off-screen. Vertical
          overflow keeps its existing hover-peek toggle untouched. */}
      {/* Commit 50.1 - BUG FIX: 'auto' on one axis silently upgrades a
          'visible' value on the OTHER axis to 'auto' too (a real CSS interop
          rule, not a browser quirk) - so the Commit 50 horizontal-scroll
          addition was quietly clipping the hover-lifted card's escape above
          the row (the reported bug: hand cards popping up UNDER the play
          area instead of over it). Horizontal scroll now only applies in the
          non-hovered baseline state, where overflow-y is already 'hidden'
          (non-visible) and the interop rule doesn't apply. On hover, both
          axes are genuinely 'visible' again - identical to the pre-Commit-50
          behavior that worked correctly. */}
      <div className="relative" style={{ height: HAND_PEEK_H, overflowX: hoveredId ? 'visible' : 'auto', overflowY: hoveredId ? 'visible' : 'hidden' }}>
        <div className="flex justify-center items-start h-full w-fit mx-auto" style={{ paddingLeft: HAND_CARD_OVERLAP, paddingRight: HAND_CARD_OVERLAP }}>
          {cards.length === 0 && <div className="text-white/30 text-xs italic px-2 py-4">No cards in hand.</div>}
          {cards.map((c, idx) => {
            const playable = state && playerId ? canPlayCardFromHand(state, playerId, c) : true;
            const reason = state && playerId && !playable ? getCardPlayabilityReason(state, playerId, c) : null;
            const tutorialHighlight: 'tutorial-target' | 'tutorial-dim' | null =
              tutorialSpotlightInstanceId === undefined
                ? null
                : c.instanceId === tutorialSpotlightInstanceId
                ? 'tutorial-target'
                : 'tutorial-dim';
            const isHovered = hoveredId === c.instanceId;
            const isFirst = idx === 0;
            return (
              // Commit 50.8 - two fixes at once:
              //  (1) cards OVERLAP (negative left margin) so the hand reads as
              //      a held fan, not spaced-out tiles.
              //  (2) hover is driven by an INSET trigger pad (user's idea) that
              //      covers only the MIDDLE of the card, never its edges. With
              //      overlapping cards, a full-card hover region means the
              //      cursor sits over two cards' regions near every seam and
              //      tiny motion flips the winner - rapid enter/leave thrash =
              //      jitter. Insetting the trigger leaves a neutral gutter
              //      around each card where nothing is hovered, so adjacent
              //      triggers never touch and the state can't oscillate.
              // Interaction (click/drag/inspect) stays entirely on the Card
              // exactly as before - the pad is hover-ONLY and forwards nothing,
              // so gameplay and drag-drop are byte-for-byte unchanged. The pad
              // sits BELOW the card (z) but is revealed for hover because the
              // card's own transparent margins/rounded corners don't capture
              // pointer there; to guarantee hover regardless, the pad is a
              // sibling positioned above via z and made click-through with
              // pointer-events so only hover reaches it while clicks fall to
              // the card. See the pad element below.
              <div
                key={c.instanceId}
                className="vfx-draw-in relative shrink-0"
                style={{
                  width: HAND_CARD_W,
                  height: HAND_PEEK_H,
                  marginLeft: isFirst ? 0 : -HAND_CARD_OVERLAP,
                  zIndex: isHovered ? 40 : idx,
                }}
              >
                {/* Inset hover trigger: middle-of-card only, so overlapping
                    cards' hover regions never touch (the anti-jitter gutter).
                    Hover-only - it sets/clears the hovered card. It sits on
                    top (z-30) but is CLICK-THROUGH: onClick/onPointerDown are
                    forwarded to the same handlers the Card would fire, so a
                    click selects and a drag starts exactly as before, and the
                    real interactive Card underneath is what tests/gameplay
                    still drive too (the pad is aria-hidden and buttonless). */}
                <div
                  aria-hidden
                  title={reason ?? undefined}
                  onMouseEnter={() => {
                    if (playable) playSfx('ui.hover');
                    setHoveredId(c.instanceId);
                  }}
                  onMouseLeave={() => setHoveredId((cur) => (cur === c.instanceId ? null : cur))}
                  onPointerDown={
                    playable && onCardPointerDown && tutorialHighlight !== 'tutorial-dim'
                      ? (e) => onCardPointerDown(e, c)
                      : undefined
                  }
                  onClick={onSelect ? () => onSelect(c.instanceId) : undefined}
                  className="absolute pointer-events-auto"
                  style={{
                    left: HAND_TRIGGER_INSET,
                    right: HAND_TRIGGER_INSET,
                    top: HAND_TRIGGER_INSET,
                    height: HAND_PEEK_H - HAND_TRIGGER_INSET * 2,
                    zIndex: 45,
                    cursor: onSelect || onCardPointerDown ? 'pointer' : undefined,
                  }}
                />
                <div
                  className="absolute inset-x-0 top-0 transition-transform duration-150 ease-out"
                  style={{ height: HAND_CARD_H, transform: isHovered ? `translateY(-${HAND_TUCK_OFFSET}px)` : 'translateY(0)' }}
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
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
