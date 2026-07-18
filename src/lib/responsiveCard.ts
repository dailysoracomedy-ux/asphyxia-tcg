/**
 * Commit 50.2 - the ONE formula for viewport-height-aware board sizing
 * (introduced in Commit 50, section 7). Originally inlined inside Card.tsx;
 * extracted here after a real bug: PlayerBoard.tsx computed the Equip flap's
 * width from the OLD static APEX_BOARD_HEIGHT constant while Card.tsx had
 * moved the actual Apex card to this fluid clamp() - the two diverged on any
 * viewport under ~1000px tall, so the flap rendered wider than the card it's
 * supposed to sit flush beneath ("EQUIP is much larger than it should be").
 *
 * Everything that needs to stay pixel-identical to a fluid-sized board card
 * (right now: Card.tsx itself, and PlayerBoard's EquipFlap width) must derive
 * from this single function - never re-implement the formula locally.
 */

/** A pure-CSS clamp() string: linear-interpolated between two window-height
 *  breakpoints (640px -> 1000px), floor `minRatio` of `max`, capped at `max`.
 *  No JS resize listener - responds instantly, zero re-render cost, and
 *  getBoundingClientRect always reflects the real (not transformed) layout
 *  size, which is what drag-and-drop hit-testing needs. */
export function fluidBoardDimension(max: number, minRatio = 0.78): string {
  const min = Math.round(max * minRatio);
  const slope = (max - min) / 360; // px gained per 1px of window height, between the two breakpoints below
  const intercept = min - slope * 640; // window-height breakpoints: 640px (min) .. 1000px (max)
  return `clamp(${min}px, calc(${intercept.toFixed(2)}px + ${(slope * 100).toFixed(4)}vh), ${max}px)`;
}

/**
 * Commit 50.10 - the single source of truth for HAND geometry, so Hand.tsx's
 * interaction/layout dimensions can never again drift from the size Card.tsx
 * actually renders for size="hand" (which uses fluidBoardDimension(194)).
 *
 * Returns CSS length expressions (clamp()/calc() strings) that stay in
 * lockstep with the fluid card height at every viewport height - Hand feeds
 * these straight into style props and CSS custom properties, and derives its
 * pointer-hitbox widths from the same maxima, so the hitboxes and the
 * rendered cards share one geometry. Proportions preserved from the previous
 * fixed constants: peek = 50% of height, lift = height - peek, overlap ~46px
 * at full desktop size (scaled down proportionally with height so the fan
 * tightens gracefully on short screens rather than overlapping too far).
 */
export const HAND_GEOMETRY = {
  /** Max card height (matches Card.tsx SIZE_MAP.hand.h). */
  MAX_H: 194,
  /** Max card width (matches Card.tsx SIZE_MAP.hand.w). */
  MAX_W: 155,
  /** Peek fraction of height that stays visible when tucked. */
  PEEK_RATIO: 0.5,
  /** Overlap fraction of width at full size (46 / 155 ≈ 0.2968). */
  OVERLAP_RATIO: 46 / 155,
} as const;

export interface HandCssVars {
  /** Fluid full card height, e.g. 'clamp(...)'. */
  cardH: string;
  /** Fluid full card width. */
  cardW: string;
  /** Fluid peek height (the tucked visible band). */
  peekH: string;
  /** Fluid lift distance (cardH - peekH). */
  lift: string;
  /** Fluid overlap (how far each card tucks under its left neighbor). */
  overlap: string;
  /** Fluid exposed width per non-final card (cardW - overlap) = the static
   *  hitbox width for every card except the last. */
  exposedW: string;
}

/** A fluid clamp() scaled by a constant factor, kept as a FLAT clamp (bounds
 *  scaled) rather than calc(clamp() * k) - equivalent in every browser but
 *  simpler and avoids strict/buggy CSS parsers choking on nested clamp. */
export function fluidScaled(max: number, factor: number, minRatio = 0.78): string {
  const min = Math.round(max * minRatio) * factor;
  const trueMax = max * factor;
  const slope = (max - Math.round(max * minRatio)) / 360;
  const intercept = Math.round(max * minRatio) - slope * 640;
  // Scale the interpolated middle term by the same factor.
  return `clamp(${min.toFixed(2)}px, calc(${(intercept * factor).toFixed(2)}px + ${(slope * 100 * factor).toFixed(4)}vh), ${trueMax.toFixed(2)}px)`;
}

/** All hand dimensions as CSS expressions, each locked to the same fluid
 *  height curve as the rendered card. Emitted as flat clamps. */
export function handCssVars(): HandCssVars {
  const cardH = fluidBoardDimension(HAND_GEOMETRY.MAX_H);
  const cardW = fluidBoardDimension(HAND_GEOMETRY.MAX_W);
  const peekH = fluidScaled(HAND_GEOMETRY.MAX_H, HAND_GEOMETRY.PEEK_RATIO);
  // lift = cardH - peekH = cardH * (1 - PEEK_RATIO), also a flat clamp.
  const lift = fluidScaled(HAND_GEOMETRY.MAX_H, 1 - HAND_GEOMETRY.PEEK_RATIO);
  const overlap = fluidScaled(HAND_GEOMETRY.MAX_W, HAND_GEOMETRY.OVERLAP_RATIO);
  const exposedW = fluidScaled(HAND_GEOMETRY.MAX_W, 1 - HAND_GEOMETRY.OVERLAP_RATIO);
  return { cardH, cardW, peekH, lift, overlap, exposedW };
}
