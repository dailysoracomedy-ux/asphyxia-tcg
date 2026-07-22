'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CardInstance, GameState, PlayerId } from '@/types/game';
import Card, { CardHoverPreview } from './Card';
import { canPlayCardFromHand, getCardPlayabilityReason } from '@/lib/cardPlayability';
import { playSfx } from '@/audio/sfx';
import { handCssVars } from '@/lib/responsiveCard';

interface HandProps {
  cards: CardInstance[];
  selectedId?: string | null;
  onSelect?: (instanceId: string) => void;
  disabledIds?: Set<string>;
  label?: string;
  onInspectCard?: (instance: CardInstance) => void;
  /** Floor for the container's width, in px - typically the board's own measured
   *  width, so Hand never reads narrower than the board above it. */
  minWidth?: number;
  /** Needed to compute per-card playability for hand-dimming (Commit 23). */
  state?: GameState;
  playerId?: PlayerId;
  /** Commit 30 - starts a potential drag for a playable hand card. Only
   *  playable cards get this wired. */
  onCardPointerDown?: (e: React.PointerEvent, card: CardInstance) => void;
  /** Commit 31 - during a guided tutorial step, exactly one hand card is the
   *  correct one to drag; everything else dims and stops responding. */
  tutorialSpotlightInstanceId?: string | null;
}

/**
 * Commit 50.10 - Stable Hand Hover Hitboxes & Preview Ownership.
 *
 * Hand is now the SINGLE owner of hand-card hover behavior. The previous
 * design had two competing hover owners (Hand's inset trigger pad AND each
 * Card's own CardHoverPreview timer) plus overlapping, z-index-sensitive hit
 * regions - moving horizontally could change which DOM element sat under the
 * pointer, flipping hoveredId/transform/z-index in a self-invalidating loop
 * (the jitter/flicker). The architecture now:
 *
 *  - Cards sit spread out with a small gap between them (Commit 50.12); their
 *    pointer hit regions are one full-width static slice each and never move,
 *    so hit-testing is stable regardless of the visual layer's transform/z.
 *  - The moving/lifting visual layer is pointer-events:none, so raising a
 *    card can never change which slice is under the cursor.
 *  - Per-slice pointerenter activates that card; hover is cleared only when
 *    the pointer leaves the ENTIRE hand track - so A->B transfers directly,
 *    never A->null->B.
 *  - Card size="hand" gets disableHoverPreview; Hand renders the one and only
 *    hand CardHoverPreview, on a single centralized ~320ms intent timer
 *    anchored to the stable slice rect. Rapid scrubbing mounts no preview.
 *  - Hand sizing derives from the same fluid height curve Card renders with
 *    (handCssVars / responsiveCard.ts), so hitboxes and cards can't drift
 *    apart at short viewport heights.
 */

const PREVIEW_DELAY_MS = 320;

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
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null);

  // One shared hover-intent timer for the whole hand (never per-card).
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while a drag is in progress from a hand card, to suppress hover
  // sounds / preview mounting until it ends.
  const draggingRef = useRef(false);
  // Track the last card we played a hover sound for, so scrubbing doesn't
  // machine-gun the sound - it fires only on a genuine change of hovered card.
  const lastSoundId = useRef<string | null>(null);

  const clearPreviewTimer = useCallback(() => {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
  }, []);

  useEffect(() => clearPreviewTimer, [clearPreviewTimer]);

  const canHover = useCallback(() => {
    return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }, []);

  // Activate a card as hovered (from its static slice). Sets the raised card
  // immediately, cancels any prior preview, and starts one fresh intent timer
  // anchored to this slice's stable rect.
  const activateCard = useCallback(
    (instanceId: string, slice: HTMLElement, playable: boolean) => {
      if (!canHover()) return;
      if (draggingRef.current) return;
      if (hoveredId === instanceId) return; // already raised; nothing changes

      setHoveredId(instanceId);

      // Hover sound only on a genuine change of hovered card.
      if (playable && lastSoundId.current !== instanceId) {
        playSfx('ui.hover');
        lastSoundId.current = instanceId;
      }

      // Restart the single preview timer against the STABLE slice rect (not
      // the cursor), so rapid scrubbing never mounts a preview and a settled
      // card shows exactly one, positioned consistently.
      clearPreviewTimer();
      setPreview(null);
      const rect = slice.getBoundingClientRect();
      const anchorX = rect.left + rect.width / 2;
      const anchorY = rect.top;
      previewTimer.current = setTimeout(() => {
        setPreview({ id: instanceId, x: anchorX, y: anchorY });
      }, PREVIEW_DELAY_MS);
    },
    [canHover, hoveredId, clearPreviewTimer]
  );

  // Clear hover for the whole hand - only when the pointer leaves the entire
  // track, never between adjacent cards.
  const clearHand = useCallback(() => {
    setHoveredId(null);
    setPreview(null);
    clearPreviewTimer();
    lastSoundId.current = null;
  }, [clearPreviewTimer]);

  const vars = handCssVars();
  const previewCard = preview ? cards.find((c) => c.instanceId === preview.id) : null;
  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div className="shrink-0 w-fit max-w-full mx-auto px-1.5 relative z-20 pointer-events-auto" style={{ minWidth }}>
      <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
        {label ?? 'Hand'} ({cards.length})
      </div>

      {/* The hand track: reserved to the tucked peek height. It is the
          horizontal-scroll container for oversized hands (hand-track-scroll:
          overflow-x auto, overflow-y visible). The inner row and the lifted
          card visuals stay overflow-visible so a raised card escapes upward
          freely. No overflow mode ever changes on hover (that used to shift
          geometry mid-hover and was a source of the jitter) - the lift is a
          pure pointer-events:none transform on a high-z visual layer.
          Clearing hover is bound HERE, at the whole-track level, so moving
          between adjacent cards transfers A->B directly and only leaving the
          entire hand clears the raised card. */}
      <div
        data-hand-track
        onPointerLeave={clearHand}
        className="relative hand-track-scroll"
        style={{
          // Track is exactly PEEK tall and fully overflow-visible on BOTH axes.
          // Nothing above the hand in the page clips vertically (verified), so
          // a hovered card's lift escapes upward freely, and because overflow
          // is visible - not auto/hidden - NO scrollbar can ever appear
          // (the reported bug). A very wide hand simply centers and may extend
          // toward the edges; horizontal scrolling is handled by the inner row
          // (hand-scroll-row) which is the only element that ever clips, and it
          // clips on X only.
          height: vars.peekH,
          ['--hand-card-h' as string]: vars.cardH,
          ['--hand-card-w' as string]: vars.cardW,
          ['--hand-peek-h' as string]: vars.peekH,
          ['--hand-lift' as string]: vars.lift,
          ['--hand-gap' as string]: vars.gap,
        }}
      >
        {/* Inner row: peek-height, top-anchored, fully overflow-visible so the
            lift escapes upward. Cards sit spread out with a small gap between
            them (Commit 50.12 - no longer overlapping). Each card's visual
            layer is top-anchored and taller than the row; the extra height
            rises above the hand (nothing clips it there) and the tucked cards
            show only their top peek. */}
        <div
          className="flex justify-center items-start w-fit mx-auto hand-scroll-row"
          style={{ height: vars.peekH, gap: vars.gap }}
        >
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
            const tutorialInert = tutorialHighlight === 'tutorial-dim';

            return (
              <div
                key={c.instanceId}
                data-hand-card-id={c.instanceId}
                className="vfx-draw-in relative shrink-0"
                style={{
                  width: vars.cardW,
                  height: vars.peekH,
                  // The raised card's VISUAL layer sits above others; but since
                  // that layer is pointer-events:none, this z only affects
                  // paint order, never hit-testing.
                  zIndex: isHovered ? 40 : idx,
                }}
              >
                {/* STATIC INTERACTION SLICE - the only pointer surface. Never
                    moves, never overlaps a neighbor, never covered by a lifted
                    card. Owns hover activation + click + drag-start. */}
                <div
                  data-hand-card-hitbox
                  title={reason ?? undefined}
                  onPointerEnter={
                    tutorialInert
                      ? undefined
                      : (e) => activateCard(c.instanceId, e.currentTarget as HTMLElement, playable)
                  }
                  onPointerDown={
                    playable && onCardPointerDown && !tutorialInert
                      ? (e) => {
                          // A drag is starting: kill any pending preview and
                          // suppress hover churn until it ends.
                          draggingRef.current = true;
                          clearPreviewTimer();
                          setPreview(null);
                          const end = () => {
                            draggingRef.current = false;
                            window.removeEventListener('pointerup', end);
                            window.removeEventListener('pointercancel', end);
                          };
                          window.addEventListener('pointerup', end);
                          window.addEventListener('pointercancel', end);
                          onCardPointerDown(e, c);
                        }
                      : undefined
                  }
                  onClick={onSelect && !tutorialInert ? () => onSelect(c.instanceId) : undefined}
                  className="absolute inset-0"
                  style={{
                    zIndex: 2,
                    cursor: !tutorialInert && (onSelect || (playable && onCardPointerDown)) ? 'pointer' : undefined,
                    pointerEvents: tutorialInert ? 'none' : 'auto',
                  }}
                />

                {/* VISUAL LAYER - pointer-events:none so it can never affect
                    hit-testing. Holds the full-height card and does the lift.
                    Left-anchored to the slot so it fills the card width. */}
                <div
                  data-hand-card-visual
                  className="absolute top-0 left-0 transition-transform ease-out pointer-events-none"
                  style={{
                    width: vars.cardW,
                    height: vars.cardH,
                    transform: isHovered ? `translateY(calc(-1 * ${vars.lift}))` : 'translateY(0)',
                    transitionDuration: reducedMotion ? '0ms' : '155ms',
                  }}
                >
                  <Card
                    instance={c}
                    size="hand"
                    selected={selectedId === c.instanceId}
                    disabled={disabledIds?.has(c.instanceId)}
                    isPlayable={playable}
                    highlight={tutorialHighlight}
                    disableHoverPreview
                  />
                </div>

                {/* INSPECT BUTTON - restored as its own stable pointer surface
                    (the visual card layer is pointer-events:none). Sits in the
                    top-right of the peek band, above the hitbox, so a click
                    inspects rather than selects/drags. */}
                {onInspectCard && !tutorialInert && (
                  <button
                    type="button"
                    data-hand-card-inspect
                    title="View full card details"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onInspectCard(c);
                    }}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 border border-white/30 text-white/70 text-[9px] leading-none flex items-center justify-center hover:bg-black/90 hover:text-white"
                    style={{ zIndex: 3 }}
                  >
                    i
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* The ONE hand hover preview - centralized here, portaled to body,
          pointer-events:none, viewport-clamped by CardHoverPreview itself. */}
      {preview && previewCard && (
        <div data-hand-hover-preview>
          <CardHoverPreview x={preview.x} y={preview.y} instance={previewCard} />
        </div>
      )}
    </div>
  );
}

// Re-export the max constants for any consumer/test that wants the intended
// desktop proportions without recomputing them.
