'use client';

import { useState } from 'react';
import type { RiftSpace } from '@/types/game';
import { useAnimationStore } from '@/store/animationStore';

/**
 * Commit 54 - the left sidebar is gone; the Rift is a battlefield-wide
 * condition, so it now reads like one: a slim BANNER centered above the
 * opponent's board (a stage modifier, not a sidebar widget). Collapsed it's a
 * single line - "RIFT: Civil War — short description" - and hover or click
 * expands the full rules text in a floating panel that overlays downward
 * without pushing the boards around. RIFT_TRIGGER pulse behavior unchanged.
 */
export default function RiftPanel({ rift }: { rift: RiftSpace | null }) {
  const [expanded, setExpanded] = useState(false);
  // Any RIFT_TRIGGER event pulses this panel, regardless of which player it was
  // for - the Rift itself is a shared, board-wide thing, not a per-player element.
  const pulsing = useAnimationStore((s) => s.events.some((e) => e.type === 'RIFT_TRIGGER'));
  if (!rift) return null;
  return (
    <div
      className={`relative rounded-md border border-fuchsia-500/40 bg-[#05050ae0] px-3 py-1 text-[11px] leading-snug shrink-0 w-fit max-w-full mx-auto z-30 cursor-default ${pulsing ? 'vfx-rift-pulse' : ''}`}
      style={{ ['--rift-pulse-color' as string]: 'rgba(232,121,249,0.7)' }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-center gap-2 justify-center whitespace-nowrap">
        <span className="uppercase tracking-widest text-fuchsia-300/70 shrink-0">Rift:</span>
        <span className="font-bold text-fuchsia-200 shrink-0">{rift.name}</span>
        <span className="text-white/50 truncate max-w-[46vw]">— {rift.shortDescription}</span>
        <span className="shrink-0 w-4 h-4 rounded-full border border-fuchsia-400/40 text-fuchsia-300/70 text-[9px] leading-4 text-center select-none" aria-hidden>
          i
        </span>
      </div>
      {expanded && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-max max-w-lg rounded-md border border-fuchsia-500/40 bg-[#05050af2] px-3 py-2 text-white/70 leading-snug shadow-[0_6px_24px_rgba(0,0,0,0.7)] z-40">
          {rift.description}
        </div>
      )}
    </div>
  );
}
