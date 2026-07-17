'use client';

import { useState, useRef, useEffect } from 'react';
import type { CardInstance } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { getCardArt, getArtAspectRatio, EQUIP_FLAP_CROP_RATIO } from '@/lib/cardArt';
import { CardHoverPreview } from './Card';

/**
 * The attached-Equip "tab" that appears seamlessly below its equipped Apex on the
 * board - cropped straight from the bottom of the Equip card's own art (which was
 * designed with this strip as its own visual tab; see the physical card reference),
 * not separately-generated flap art. Independently hoverable/clickable from the
 * Apex above it - hovering shows the full Equip card, same as hovering any other
 * card, via the same CardHoverPreview the rest of the app uses.
 *
 * Commit 50.2 - `width` is now a CSS length expression (string), not a plain
 * number. The caller (PlayerBoard.tsx) passes the exact same fluidBoardDimension()
 * calc() string used for the real Apex card next to it, so this flap can never
 * silently drift out of sync with it again (that drift was the reported bug: on
 * short viewports the Apex card shrank via CSS clamp() while this flap stayed at
 * a stale fixed width, rendering visibly larger than the card it's attached to).
 * All the derived measurements (full art height, crop height, vertical offset)
 * are now computed with CSS calc() instead of JS arithmetic, so they scale
 * perfectly in lockstep with whatever `width` resolves to at render time.
 */
export default function EquipFlap({
  equipInstance,
  width,
  onInspect,
}: {
  equipInstance: CardInstance;
  /** A CSS length/calc() expression matching the Apex card's own rendered
   *  width exactly, so the flap lines up seamlessly beneath it. */
  width: string;
  onInspect?: () => void;
}) {
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    []
  );

  const def = getCardDef(equipInstance.defId);
  const art = getCardArt(equipInstance.defId);
  const ratio = getArtAspectRatio(def.type); // 5:7 for Equip art
  // All CSS calc() now, since `width` is itself a fluid clamp() expression,
  // not a plain number - see the Commit 50.2 note above.
  const fullArtHeight = `calc(${width} / ${ratio.toFixed(4)})`;
  const flapHeight = `calc(${fullArtHeight} * ${EQUIP_FLAP_CROP_RATIO})`;
  const peekOffset = `calc(-1 * (${fullArtHeight} - ${flapHeight}))`;

  function handleMouseEnter(e: React.MouseEvent) {
    if (typeof window !== 'undefined' && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const x = e.clientX;
    const y = e.clientY;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverPos({ x, y }), 350);
  }
  function handleMouseLeave() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHoverPos(null);
  }

  return (
    <div
      className="relative shrink-0 overflow-hidden border-2 border-t-0 rounded-b-md vfx-equip-slide-in"
      style={{ width, height: flapHeight, borderColor: '#ffffff33' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {hoverPos && <CardHoverPreview x={hoverPos.x} y={hoverPos.y} instance={equipInstance} />}
      <button
        type="button"
        onClick={onInspect}
        title={`Equip: ${def.name}`}
        className={`absolute w-full ${onInspect ? 'cursor-pointer hover:brightness-125' : 'cursor-default'}`}
        style={{ left: 0, top: peekOffset, width, height: fullArtHeight }}
      >
        {art && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art} alt="" className="w-full h-full object-cover" draggable={false} />
        )}
      </button>
    </div>
  );
}
