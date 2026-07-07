'use client';

import { useState } from 'react';
import type { RiftSpace } from '@/types/game';

export default function RiftPanel({ rift }: { rift: RiftSpace | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!rift) return null;
  return (
    <div className="rounded-lg border border-fuchsia-500/40 bg-black/60 px-3 py-1 text-[11px] shrink-0">
      <div className="flex items-center gap-2">
        <span className="uppercase tracking-widest text-fuchsia-300/70 shrink-0">Rift:</span>
        <span className="font-bold text-fuchsia-200 shrink-0">{rift.name}</span>
        <span className="text-white/50 truncate" title={rift.description}>
          — {rift.shortDescription}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto shrink-0 w-4 h-4 rounded-full border border-fuchsia-400/40 text-fuchsia-300/70 text-[9px] leading-none hover:bg-fuchsia-400/10 hover:text-fuchsia-200"
          title="Full Rift text"
        >
          i
        </button>
      </div>
      {expanded && <div className="mt-1 text-white/60 leading-snug">{rift.description}</div>}
    </div>
  );
}
