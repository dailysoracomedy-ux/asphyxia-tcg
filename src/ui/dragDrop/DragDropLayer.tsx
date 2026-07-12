'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragSource, DropZoneId } from './dragDropTypes';
import { zoneKey, EMPTY_DRAG_STATE, type DragState } from './dragDropTypes';

/**
 * Commit 30 - native Pointer Events, no drag library. Chosen because the
 * project already has zero drag dependencies, Pointer Events give consistent
 * mouse/touch support in one API, and the actual mechanics needed here
 * (track a position, tag legal zones with data attributes, hit-test on
 * release) don't need a library's weight. Drop zones are found via
 * elementFromPoint + closest('[data-dropzone]') rather than measuring
 * bounding rects up front - simpler, and correct even if the board scrolls
 * or resizes mid-drag.
 */

const DRAG_THRESHOLD_PX = 6;

export function useDragDrop(onDrop: (source: DragSource, target: DropZoneId) => void) {
  const [drag, setDrag] = useState<DragState>(EMPTY_DRAG_STATE);
  const dragRef = useRef(drag);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);
  const pendingRef = useRef<{ source: DragSource; legalZoneKeys: Set<string>; startX: number; startY: number; pointerId: number } | null>(null);

  const findZoneAt = useCallback((x: number, y: number): DropZoneId | null => {
    const el = document.elementFromPoint(x, y);
    const zoneEl = el?.closest<HTMLElement>('[data-dropzone]');
    if (!zoneEl) return null;
    try {
      return JSON.parse(zoneEl.dataset.dropzone!) as DropZoneId;
    } catch {
      return null;
    }
  }, []);

  const beginPotentialDrag = useCallback((e: React.PointerEvent, source: DragSource, legalZoneKeys: Set<string>) => {
    if (legalZoneKeys.size === 0) return; // nothing legal to drag to - don't even start
    pendingRef.current = { source, legalZoneKeys, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId };
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const pending = pendingRef.current;
      if (pending && !dragRef.current.active) {
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        setDrag({ active: true, source: pending.source, pointer: { x: e.clientX, y: e.clientY }, legalZoneKeys: pending.legalZoneKeys, hoveredZoneKey: null });
        return;
      }
      if (!dragRef.current.active) return;
      const zone = findZoneAt(e.clientX, e.clientY);
      const key = zone ? zoneKey(zone) : null;
      const hoveredZoneKey = key && dragRef.current.legalZoneKeys.has(key) ? key : null;
      setDrag((d) => ({ ...d, pointer: { x: e.clientX, y: e.clientY }, hoveredZoneKey }));
    }

    function onUp(e: PointerEvent) {
      const wasActive = dragRef.current.active;
      const source = dragRef.current.source;
      pendingRef.current = null;
      if (wasActive && source) {
        const zone = findZoneAt(e.clientX, e.clientY);
        if (zone && dragRef.current.legalZoneKeys.has(zoneKey(zone))) {
          onDrop(source, zone);
        }
      }
      setDrag(EMPTY_DRAG_STATE);
    }

    function onCancel() {
      pendingRef.current = null;
      setDrag(EMPTY_DRAG_STATE);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [findZoneAt, onDrop]);

  return { drag, beginPotentialDrag };
}

/** Renders nothing but a small ghost card that follows the pointer while a
 *  drag is active - the actual highlighting of legal zones happens where each
 *  zone already computes its own highlight prop (PlayerBoard.tsx etc.),
 *  checking drag.legalZoneKeys/hoveredZoneKey directly, so there's exactly
 *  one source of truth for "what glows" instead of a duplicate. */
export default function DragDropLayer({ drag, label }: { drag: DragState; label: string | null }) {
  if (!drag.active || !label) return null;
  return (
    <div
      className="fixed z-[60] pointer-events-none px-3 py-2 rounded-md border-2 border-emerald-300 bg-[#0a0a12ee] text-white text-xs font-bold shadow-[0_0_20px_rgba(52,211,153,0.6)]"
      style={{ left: drag.pointer.x + 12, top: drag.pointer.y + 12, transform: 'translate(0, 0)' }}
    >
      {label}
    </div>
  );
}
