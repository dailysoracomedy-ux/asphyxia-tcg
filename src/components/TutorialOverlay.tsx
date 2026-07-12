'use client';

import { useGameStore } from '@/store/gameStore';

/**
 * Full-screen dim/spotlight overlay for tutorial mode (Commit 29.4), replacing
 * piecemeal per-handler blocking as the primary "you can only interact with the
 * one right thing" mechanism - a modern-digital-card-game-style lockdown rather
 * than a maze of individual gates.
 *
 * How it works: this sits at z-30, above the normal board but below
 * TutorialPanel (z-40) and every modal (z-50+, so a React response window during
 * a tutorial React step is completely unaffected). It's a single, uniformly dark,
 * pointer-events:auto layer that swallows every click by default and shows the
 * "follow the tutorial" toast. Whatever the current step highlights gets a
 * `tutorial-spotlight` class (applied at the actual highlight-computation sites
 * in GameBoard.tsx/Hand.tsx/PlayerBoard.tsx, reusing the exact same
 * `highlight.kind` check that already drives the pulsing ring) - z-35, i.e.
 * *above* this overlay, so clicks on that one spotlighted element pass straight
 * through to the real card/button underneath, while literally everything else is
 * genuinely unclickable, not just logically blocked.
 *
 * blockedByTutorial() in GameBoard.tsx remains the authoritative gameplay-side
 * gate (it's what actually decides whether an action is allowed and never
 * mutates state otherwise) - this overlay is the *input-layer* reinforcement of
 * the same rule, so a stray click can't even reach a handler to begin with.
 */
export default function TutorialOverlay({ onBlockedClick }: { onBlockedClick: () => void }) {
  const tutorialMode = useGameStore((s) => s.tutorialMode);
  if (!tutorialMode) return null;

  return (
    <div
      className="fixed inset-0 z-30 bg-black/70"
      onClick={onBlockedClick}
      // Right-click/context-menu and other stray inputs should also be
      // swallowed here rather than reaching anything underneath.
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
