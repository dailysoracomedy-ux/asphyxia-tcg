'use client';

import { useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import NewGameMenu from '@/components/NewGameMenu';
import GameBoard from '@/components/GameBoard';
import DevCardGallery from '@/components/DevCardGallery';

export default function Home() {
  const status = useGameStore((s) => s.status);
  // Deliberately local, separate from the game store's own status machine - this is
  // a dev-tool view toggle, not game state, and should never interact with saves,
  // resets, or the actual match lifecycle.
  const [showDeveloper, setShowDeveloper] = useState(false);

  if (showDeveloper) return <DevCardGallery onBack={() => setShowDeveloper(false)} />;
  if (status === 'menu') return <NewGameMenu onOpenDeveloper={() => setShowDeveloper(true)} />;
  return <GameBoard />;
}
