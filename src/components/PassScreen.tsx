'use client';

import type { PlayerId } from '@/types/game';
import { factionTheme } from '@/lib/theme';
import { useGameStore } from '@/store/gameStore';

interface PassScreenProps {
  toPlayerId: PlayerId;
  direction: 'toResponder' | 'backToActive';
  onReady: () => void;
}

export default function PassScreen({ toPlayerId, direction, onReady }: PassScreenProps) {
  const faction = useGameStore((s) => s.players[toPlayerId].faction);
  const theme = factionTheme(faction);

  return (
    <div className="fixed inset-0 z-[60] bg-black flex items-center justify-center p-4">
      <div
        className="max-w-md w-full rounded-xl border-2 p-8 text-center scanlines"
        style={{ borderColor: theme.border, boxShadow: `0 0 40px ${theme.primary}55` }}
      >
        <div className="text-[10px] uppercase tracking-[0.3em] text-white/40 mb-3">
          {direction === 'toResponder' ? 'Response Window' : 'Hand Back Control'}
        </div>
        <div className="text-lg text-white/70 mb-1">
          {direction === 'toResponder' ? 'Pass the screen to' : 'Pass the screen back to'}
        </div>
        <div className="text-2xl font-black mb-6" style={{ color: theme.primary }}>
          {toPlayerId} <span className="text-base font-normal text-white/50">({faction})</span>
        </div>
        <p className="text-xs text-white/40 mb-6">
          {direction === 'toResponder'
            ? "Make sure the other player can't see this screen before continuing."
            : 'The response has been resolved. Hand the device back before play continues.'}
        </p>
        <button type="button"
          onClick={onReady}
          className="px-6 py-2 rounded-md font-bold tracking-widest text-black"
          style={{ background: theme.primary }}
        >
          Ready
        </button>
      </div>
    </div>
  );
}
