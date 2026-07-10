'use client';

import { useState } from 'react';
import { useGameStore } from '@/store/gameStore';
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
