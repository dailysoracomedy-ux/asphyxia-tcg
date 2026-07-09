'use client';

import type { CardInstance } from '@/types/game';
import Card from './Card';

interface HandProps {
  cards: CardInstance[];
  selectedId?: string | null;
  onSelect?: (instanceId: string) => void;
  disabledIds?: Set<string>;
  label?: string;
  onInspectCard?: (instance: CardInstance) => void;
}

export default function Hand({ cards, selectedId, onSelect, disabledIds, label, onInspectCard }: HandProps) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#05050a] p-1.5 max-h-[168px] shrink-0">
      <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">{label ?? 'Hand'} ({cards.length})</div>
      <div className="flex gap-2 overflow-x-auto overflow-y-hidden pb-1 justify-center">
        {cards.length === 0 && <div className="text-white/30 text-xs italic px-2 py-4">No cards in hand.</div>}
        {cards.map((c) => (
          <Card
            key={c.instanceId}
            instance={c}
            size="hand"
            selected={selectedId === c.instanceId}
            disabled={disabledIds?.has(c.instanceId)}
            onClick={onSelect ? () => onSelect(c.instanceId) : undefined}
            onInspect={onInspectCard ? () => onInspectCard(c) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
