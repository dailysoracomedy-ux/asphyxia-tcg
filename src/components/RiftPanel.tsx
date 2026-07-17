'use client';

import { useState } from 'react';
import type { RiftSpace } from '@/types/game';
import { useAnimationStore } from '@/store/animationStore';

export default function RiftPanel({ rift }: { rift: RiftSpace | null }) {
  const [expanded, setExpanded] = useState(false);
  // Any RIFT_TRIGGER event pulses this panel, regardless of which player it was
  // for - the Rift itself is a shared, board-wide thing, not a per-player element.
  const pulsing = useAnimationStore((s) => s.events.some((e) => e.type === 'RIFT_TRIGGER'));
  if (!rift) return null;
  return (
    <div
      className={`relative rounded-lg border border-fuchsia-500/40 bg-[#05050a] px-3 py-1.5 text-[12px] leading-relaxed shrink-0 w-fit max-w-full mx-auto ${pulsing ? 'vfx-rift-pulse' : ''}`}
      style={{ ['--rift-pulse-color' as string]: 'rgba(232,121,249,0.7)' }}
    >
      <div className="flex items-start gap-2 justify-center flex-wrap">
        <span className="uppercase tracking-widest text-fuchsia-300/70 shrink-0">Rift:</span>
        <span className="font-bold text-fuchsia-200 shrink-0">{rift.name}</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 w-4 h-4 rounded-full border border-fuchsia-400/40 text-fuchsia-300/70 text-[9px] leading-none hover:bg-fuchsia-400/10 hover:text-fuchsia-200"
          title="Full Rift text"
        >
          i
        </button>
        <span className="text-white/60 basis-full" title={rift.description}>
          — {rift.shortDescription}
        </span>
      </div>
      {expanded && <div className="mt-1 text-white/60 leading-snug max-w-lg">{rift.description}</div>}
    </div>
  );
}
