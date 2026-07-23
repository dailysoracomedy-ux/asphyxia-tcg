'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameState, PlayerId } from '@/types/game';
import type { VisualEvent } from '@/store/animationStore';
import { factionTheme } from '@/lib/theme';
import { usePlayerVisualEvents } from '@/store/animationStore';
import type { DragState } from '@/ui/dragDrop/dragDropTypes';
import { zoneKey } from '@/ui/dragDrop/dragDropTypes';

/**
 * Commit 54 - the in-mat vitals panel. O2 and Momentum no longer live in a
 * left-rail chip the eye has to leave the battlefield to read; each player's
 * vitals are printed ON their own playmat, in the piles column, in the spot
 * the old ActionZone box occupied (the whole mat is the Action drop target
 * now - see PlayerBoard).
 *
 * Layout per the requested sketch:
 *   ┌───────────────────────────┐
 *   │ OXYGEN (O2) │  MOMENTUM   │   <- header row
 *   ├─────────────┼─────────────┤
 *   │     12      │   ◆ ◆ ◇     │   <- big number | three pips
 *   └───────────────────────────┘
 *
 * Color language is deliberately GLOBAL, not per-faction: O2 is always
 * oxygen-cyan, Momentum always hot amber, for both players - "cyan = life,
 * amber = fuel" is learned once and true everywhere. Faction identity lives
 * in the panel FRAME (border/glow tint) instead, so ownership stays obvious
 * without making the numbers themselves ambiguous.
 *
 * The O2 half keeps the exact same 'enemy-o2' data-dropzone contract the old
 * O2Stat carried (direct O2 attack drags land here), and both halves read the
 * same animationStore streams the old chips did - this is a re-housing of the
 * vitals, not a reimplementation of their logic.
 *
 * Giant popups (Commit 54): O2 loss popups anchor to this panel and scale by
 * magnitude - see .vfx-o2-popup-big / .vfx-o2-popup-huge in globals.css.
 * Losing O2 is the ONLY way to lose in ASPHYXIA, so it renders like an event,
 * not a footnote: heavy hits (>=500 pre-conversion, i.e. any multi-point O2
 * loss) overshoot-and-settle, and the panel frame itself flashes red.
 */

const O2_COLOR = '#22d3ee'; // oxygen cyan - global, both players
const MOM_COLOR = '#fbbf24'; // momentum amber - global, both players

export default function StatsPanel({ state, playerId, drag }: { state: GameState; playerId: PlayerId; drag?: DragState | null }) {
  // Callback-ref into STATE (not a ref object) so the popup portal can react
  // to the element mounting - react-hooks/refs forbids reading ref.current in
  // render.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const player = state.players[playerId];
  const theme = factionTheme(player.faction);
  const isActive = state.activePlayerId === playerId && state.status === 'playing';
  const o2Critical = player.o2 <= 6 && state.status === 'playing';
  const o2Danger = player.o2 <= 4;

  const events = usePlayerVisualEvents(playerId);
  const o2Events = events.filter((e) => e.type === 'O2_DAMAGE' || e.type === 'OVERFLOW_DAMAGE');
  const momEvents = events.filter((e) => e.type === 'MOMENTUM_GAINED' || e.type === 'MOMENTUM_SPENT');
  const o2Hit = o2Events.length > 0;
  const momGained = momEvents.some((e) => e.type === 'MOMENTUM_GAINED');
  const momSpent = momEvents.some((e) => e.type === 'MOMENTUM_SPENT');

  // Direct-O2 attack drop target - same zone contract O2Stat carried since
  // Commit 30; only the host element changed (the whole O2 half now).
  const dropZone = { kind: 'enemy-o2' as const, playerId };
  const key = zoneKey(dropZone);
  const isLegalDropTarget = !!drag?.active && drag.legalZoneKeys.has(key);
  const isHovered = drag?.hoveredZoneKey === key;

  /** "-2 O2" style labels: pull the leading number to size the popup. Any
   *  loss of 2+ O2 points is a haymaker and gets the huge treatment. */
  function popupClass(label?: string): string {
    const n = Math.abs(parseInt(label ?? '', 10)) || 0;
    return n >= 2 ? 'vfx-o2-popup-huge' : 'vfx-o2-popup-big';
  }

  return (
    <div
      ref={setRootEl}
      data-vfx-o2={playerId}
      className={`relative rounded-md overflow-visible font-mono select-none ${o2Hit ? 'vfx-statpanel-hitflash' : ''}`}
      style={{
        // 212 = the Deck+Void row directly below it (two 104px stacks + 4px
        // gap), so the piles column reads as one aligned unit.
        width: 212,
        border: `1px solid ${isActive ? theme.primary + 'aa' : theme.border + '66'}`,
        background: 'linear-gradient(180deg, rgba(5,5,10,0.92) 0%, rgba(5,5,10,0.78) 100%)',
        boxShadow: isActive
          ? `0 0 12px ${theme.primary}66, inset 0 0 14px rgba(0,0,0,0.6)`
          : 'inset 0 0 14px rgba(0,0,0,0.6)',
        transition: 'box-shadow 250ms ease, border-color 250ms ease',
      }}
    >
      {/* Header row */}
      <div className="grid grid-cols-2 text-[9px] uppercase tracking-[0.14em] leading-none border-b border-white/10">
        <div className="px-2 pt-1.5 pb-1 text-center" style={{ color: O2_COLOR + 'cc' }}>
          Oxygen <span className="text-white/25 normal-case">(O2)</span>
        </div>
        <div className="px-2 pt-1.5 pb-1 text-center border-l border-white/10" style={{ color: MOM_COLOR + 'cc' }}>
          Momentum
        </div>
      </div>

      {/* Value row */}
      <div className="grid grid-cols-2 items-stretch">
        {/* O2 half - also the direct-O2 drop target */}
        <div
          data-dropzone={isLegalDropTarget ? JSON.stringify(dropZone) : undefined}
          className={`relative flex items-center justify-center py-1 rounded-bl-md transition-shadow ${
            isLegalDropTarget
              ? isHovered
                ? 'ring-4 ring-emerald-300 shadow-[0_0_20px_rgba(52,211,153,0.9)] bg-emerald-400/10'
                : 'ring-2 ring-emerald-400/70 shadow-[0_0_10px_rgba(52,211,153,0.5)]'
              : ''
          }`}
          style={{ zIndex: isLegalDropTarget ? 25 : undefined }}
        >
          <span
            className={`font-black text-[30px] leading-none ${o2Danger ? 'text-red-400 animate-pulse' : ''} ${o2Critical && !o2Danger ? 'o2-critical' : ''} ${o2Hit ? 'vfx-hit-flash' : ''}`}
            style={o2Danger ? { textShadow: '0 0 14px rgba(248,113,113,0.7)' } : { color: O2_COLOR, textShadow: `0 0 12px ${O2_COLOR}55` }}
          >
            {player.o2}
          </span>
          {/* Giant O2 loss popups - PORTALED to document.body (Commit 54.1):
              the mat's preserve-3d transform buries any in-tree z-index under
              the translateZ-lifted card columns. */}
          {rootEl && o2Events.length > 0 && <GiantO2Popups anchor={rootEl} events={o2Events} popupClass={popupClass} />}
        </div>

        {/* Momentum half - three pips, capped at 3, filled left-to-right */}
        <div className="relative flex items-center justify-center gap-1.5 py-1 border-l border-white/10 rounded-br-md">
          <span className="sr-only">Momentum {player.momentum} of 3</span>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`mom-pip ${i < player.momentum ? 'lit' : ''} ${i < player.momentum && momGained ? 'vfx-momentum-pulse' : ''} ${momSpent ? 'vfx-momentum-spend' : ''}`}
              style={{ ['--pip-color' as string]: MOM_COLOR, width: 13, height: 13 }}
            />
          ))}
          {momEvents.map((e) => (
            <span
              key={e.id}
              className="vfx-damage-popup absolute left-1/2 -top-2 -translate-x-1/2 z-30 pointer-events-none font-mono font-bold whitespace-nowrap text-[13px]"
              style={{ color: e.type === 'MOMENTUM_GAINED' ? '#4ade80' : '#f87171', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}
            >
              {e.label}
            </span>
          ))}
        </div>
      </div>

      {/* Faction ownership strip - name + active arrow, tiny, under the values */}
      <div
        className="text-center text-[8px] uppercase tracking-[0.2em] leading-none pb-1 pt-0.5 border-t border-white/5"
        style={{ color: isActive ? theme.primary : theme.primary + '77' }}
      >
        {player.faction}
        {isActive ? ' ◂' : ''}
      </div>
    </div>
  );
}

/** Commit 54.1 - giant O2 popups, PORTALED to document.body. The mat's
 *  perspective/preserve-3d transform creates a 3D stacking context where the
 *  lifted card columns (translateZ 8-14px) render above any flat z-index
 *  inside it. A body portal escapes that context entirely; the fixed
 *  wrapper's position is written imperatively in a layout effect (a plain
 *  DOM update - the sanctioned effect use), measured off the anchor panel
 *  every time the event set changes. */
function GiantO2Popups({ anchor, events, popupClass }: { anchor: HTMLElement; events: VisualEvent[]; popupClass: (label?: string) => string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = anchor.getBoundingClientRect();
    wrap.style.left = `${r.left + r.width / 4}px`;
    wrap.style.top = `${r.top - 6}px`;
  }, [anchor, events.length]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div ref={wrapRef} className="fixed z-[70] pointer-events-none" aria-hidden>
      {events.map((e) => (
        <span
          key={e.id}
          className={`${popupClass(e.label)} absolute left-0 top-0 pointer-events-none font-mono font-black whitespace-nowrap`}
          style={{ color: '#fb923c' }}
        >
          {e.label}
        </span>
      ))}
    </div>,
    document.body
  );
}
