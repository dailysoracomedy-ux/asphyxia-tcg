'use client';

import { useEffect, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useTutorialStore } from '@/store/tutorialStore';
import NewGameMenu from '@/components/NewGameMenu';
import GameBoard from '@/components/GameBoard';
import DevCardGallery from '@/components/DevCardGallery';
import MusicController from '@/audio/MusicController';

export default function Home() {
  const status = useGameStore((s) => s.status);
  // Deliberately local, separate from the game store's own status machine - this is
  // a dev-tool view toggle, not game state, and should never interact with saves,
  // resets, or the actual match lifecycle.
  const [showDeveloper, setShowDeveloper] = useState(false);

  // Commit 50.11 - test hook for the offline visual-verification harness ONLY.
  // Exposes the game store on window so the screenshot harness can jump
  // straight into a live match (bypassing the coin-flip / opening-apex UI
  // flow, which is animation-timed and brittle to script). Guarded behind an
  // explicit ?e2e=1 URL flag, so it is completely inert in normal play - no
  // hook is attached unless a developer deliberately requests it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('e2e') === '1') {
      (window as unknown as { __asphyxiaStore?: unknown }).__asphyxiaStore = useGameStore;
      (window as unknown as { __asphyxiaTutorialStore?: unknown }).__asphyxiaTutorialStore = useTutorialStore;
    }
  }, []);

  return (
    <>
      {/* Mounted once here (not per-screen) so the same <audio> element and
          playlist position persist seamlessly across menu -> game -> game-over,
          rather than restarting the track every time the screen switches. */}
      <MusicController />
      {showDeveloper ? (
        <DevCardGallery onBack={() => setShowDeveloper(false)} />
      ) : status === 'menu' ? (
        <NewGameMenu onOpenDeveloper={() => setShowDeveloper(true)} />
      ) : (
        <GameBoard />
      )}
    </>
  );
}
