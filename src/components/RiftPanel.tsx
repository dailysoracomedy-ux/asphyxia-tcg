'use client';

import type { RiftSpace } from '@/types/game';

export default function RiftPanel({ rift }: { rift: RiftSpace | null }) {
  if (!rift) return null;
  return (
    <div className="rounded-lg border border-fuchsia-500/40 bg-black/60 px-3 py-1 flex items-center gap-2 text-[11px] shrink-0">
      <span className="uppercase tracking-widest text-fuchsia-300/70 shrink-0">Rift:</span>
      <span className="font-bold text-fuchsia-200 shrink-0">{rift.name}</span>
      <span className="text-white/50 truncate" title={rift.description}>
        — {rift.description}
      </span>
    </div>
  );
}
