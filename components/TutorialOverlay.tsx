'use client';

import { useGameStore } from '@/store/gameStore';

/**
 * Full-screen dim overlay for tutorial mode (Commit 29.4). Originally also
 * the primary click-blocking mechanism (a single pointer-events:auto layer
 * swallowing every click except one z-35-boosted spotlighted element) - that
 * was the right model for the fully-scripted tutorial architecture it was
 * built for, where there was no other gating at all.
 *
 * Commit 31.3 - a real, reported bug traced to this file directly: the drag
 * system resolves drop targets via document.elementFromPoint, and this div
 * physically sat on top of every drop zone (apex slots, support slots, the
 * Action Zone) at z-30 - none of them were ever boosted to z-35 the way a
 * spotlighted hand card is, so elementFromPoint returned this overlay
 * instead of the real zone underneath on every single drop attempt. The
 * card could always be picked up; it could never actually be placed.
 *
 * Commit 31's real guided-match architecture made this blocking role
 * redundant anyway - every interaction point now checks through
 * `tutorialGate` in GameBoard.tsx, which is the actual authority on what's
 * allowed right now, per step. So this is pointer-events:none now: purely
 * visual dimming, never in the way of a real drag or drop again.
 */
export default function TutorialOverlay() {
  const tutorialMode = useGameStore((s) => s.tutorialMode);
  if (!tutorialMode) return null;

  return <div className="fixed inset-0 z-30 bg-black/70 pointer-events-none" />;
}
