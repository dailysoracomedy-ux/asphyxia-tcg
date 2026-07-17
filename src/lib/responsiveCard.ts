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
