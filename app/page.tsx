'use client';

import { useGameStore } from '@/store/gameStore';
import NewGameMenu from '@/components/NewGameMenu';
import GameBoard from '@/components/GameBoard';

export default function Home() {
  const status = useGameStore((s) => s.status);

  if (status === 'menu') return <NewGameMenu />;
  return <GameBoard />;
}
