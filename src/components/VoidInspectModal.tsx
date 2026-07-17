'use client';

import { useEffect } from 'react';
import type { CardInstance, Faction } from '@/types/game';
import { factionTheme } from '@/lib/theme';
import Card from './Card';

/**
 * Full-screen Void inspection - replaces the old small popover with a proper grid
 * view of every card in a player's Void, similar in spirit to the opening-Apex
 * selection screen. Read-only: no way to remove or reorder cards from here, per the
 * existing "Void inspection is read-only" rule. Clicking a card opens the normal
 * Card Inspect modal for full details (via the caller's onInspectCard).
 */
export default function VoidInspectModal({
  faction,
  cards,
  onClose,
  onInspectCard,
}: {
  faction: Faction;
  cards: CardInstance[];
  onClose: () => void;
  onInspectCard: (instance: CardInstance) => void;
}) {
  const theme = factionTheme(faction);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="panel-3d-deep max-w-4xl w-full max-h-[85vh] rounded-xl border-2 p-5 flex flex-col"
        style={{ borderColor: theme.border, background: '#05050a', boxShadow: `0 0 30px ${theme.primary}44` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/40">Void — read only</div>
            <div className="text-lg font-bold" style={{ color: theme.primary }}>
              {faction} ({cards.length} card{cards.length === 1 ? '' : 's'})
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white text-lg leading-none px-1">
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          {cards.length === 0 ? (
            <div className="text-white/40 italic text-sm py-8 text-center">Void is empty.</div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {[...cards].reverse().map((c) => (
                <Card key={c.instanceId} instance={c} size="hand" onClick={() => onInspectCard(c)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
