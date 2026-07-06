'use client';

import type { RiftSpace } from '@/types/game';

export default function RiftPanel({ rift }: { rift: RiftSpace | null }) {
  if (!rift) return null;
  return (
    <div className="rounded-lg border border-fuchsia-500/40 bg-black/60 px-4 py-2 text-center max-w-xl mx-auto pulse-border">
      <div className="text-[10px] uppercase tracking-[0.3em] text-fuchsia-300/70">Rift Space</div>
      <div className="text-lg font-bold text-fuchsia-200 text-shadow-glow">{rift.name}</div>
      <div className="text-[11px] text-white/60 mt-0.5">{rift.description}</div>
    </div>
  );
}
