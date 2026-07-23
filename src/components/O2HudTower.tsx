'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameState, PlayerId } from '@/types/game';
import { usePlayerVisualEvents, type VisualEvent } from '@/store/animationStore';
import type { DragState } from '@/ui/dragDrop/dragDropTypes';
import { zoneKey } from '@/ui/dragDrop/dragDropTypes';

/**
 * Commit 54.1 - the O2 HUD TOWER. Diegetic vitals hardware standing directly
 * left of each playmat, built from Daily's four PSD-exported frame states
 * (static2/hud/momentum-{0..3}.webp, verified pixel-identical below the
 * canister strip, so the swap is seamless):
 *
 *  - MOMENTUM is the three canisters at the top of the frame art itself -
 *    the frame image swaps to match state.momentum (all four frames are
 *    preloaded at mount so the first gain never flickers), with a green
 *    charge pulse over the canister zone on MOMENTUM_GAINED and a dim
 *    flicker on MOMENTUM_SPENT.
 *  - The big window is the OXYGEN TANK: a black-backed liquid column whose
 *    fill height = o2 / startingO2. The "3D" read comes from stacked light:
 *    a cylindrical horizontal gradient (dark walls, bright core), a glowing
 *    liquid SURFACE line with an elliptical meniscus, a vertical specular
 *    streak like light down a glass tube, rising bubbles, and a blurred
 *    duplicate of the whole column underneath acting as real BLOOM. Etched
 *    tick marks scale with the match's starting O2 (every point at 12/24,
 *    every 4th at 48, every 8th at 96). Depletion DRAINS with easing and
 *    fires a flash at the new surface; at <=25% the liquid runs red and the
 *    tank breathes.
 *  - The small bottom window is the black-backed numeric readout.
 *
 * The tower carries the player's 'enemy-o2' drop zone (drag an attack onto
 * the opponent's actual oxygen tank), the data-vfx-o2 anchor for VfxCanvas
 * ember bursts, and the giant portaled O2 popups - all migrated from the
 * retired in-mat StatsPanel.
 *
 * Window geometry measured off the frames' alpha channel (682x1476):
 * main window x174-548 y366-1087, number window x214-494 y1111-1378.
 */

const FRAME_W = 682;
const FRAME_H = 1476;
const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(2)}%`;

const MAIN = { left: pct(174, FRAME_W), top: pct(366, FRAME_H), width: pct(548 - 174, FRAME_W), height: pct(1087 - 366, FRAME_H) };
const NUM = { left: pct(214, FRAME_W), top: pct(1111, FRAME_H), width: pct(494 - 214, FRAME_W), height: pct(1378 - 1111, FRAME_H) };
const CANISTERS = { left: '18%', top: '0%', width: '64%', height: '15%' };

function tickStepFor(startingO2: number): number {
  if (startingO2 <= 24) return 1;
  if (startingO2 <= 48) return 4;
  return 8;
}

export default function O2HudTower({ state, playerId, drag }: { state: GameState; playerId: PlayerId; drag?: DragState | null }) {
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  // Explicit pixel sizing: in a ROW flex container the main-axis width
  // resolves BEFORE cross-axis stretch, so an aspect-ratio box with auto
  // width computes 0 - the stretch height arrives too late to transfer.
  // A ResizeObserver on the row (whose height IS the mat's height) hands us
  // the real height; width follows from the frame's aspect.
  const [towerH, setTowerH] = useState(0);
  useEffect(() => {
    // Measure the TILT ROW (whose height is the mat's height), not the
    // immediate shadow wrapper: with self-end alignment that wrapper's height
    // IS the tower's own height - measuring it is self-referential and reads
    // 0 on a fresh mount.
    const row = rootEl?.closest('[data-board-tilt-row]') as HTMLElement | null;
    if (!rootEl || !row) return;
    // Commit 54.1 tuning: 72% of the mat's height, docked to its bottom edge
    // - the HUD recedes to furniture instead of a full-height spotlight.
    const measure = () => setTowerH((prev) => { const t = Math.round(row.clientHeight * 0.72); return Math.abs(prev - t) > 1 ? t : prev; });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [rootEl]);
  const player = state.players[playerId];
  const startingO2 = state.startingO2 ?? 12;
  const fill = Math.max(0, Math.min(1, player.o2 / startingO2));
  const lowO2 = state.status === 'playing' && (fill <= 0.25 || player.o2 <= 3);

  const events = usePlayerVisualEvents(playerId);
  const o2Events = events.filter((e) => e.type === 'O2_DAMAGE' || e.type === 'OVERFLOW_DAMAGE');
  const o2Hit = o2Events.length > 0;
  const momGained = events.some((e) => e.type === 'MOMENTUM_GAINED');
  const momSpent = events.some((e) => e.type === 'MOMENTUM_SPENT');

  // Preload all four frames once so momentum changes never pop-in.
  useEffect(() => {
    // jsdom test environments expose window/document but not the Image
    // constructor or ResizeObserver as globals - guard both (the tower is
    // purely visual; being inert there is correct).
    if (typeof Image === 'undefined') return;
    for (let i = 0; i < 4; i++) {
      const img = new Image();
      img.src = `/hud/momentum-${i}.webp`;
    }
  }, []);

  const momentum = Math.max(0, Math.min(3, player.momentum));
  // Receded palette: fluid behind dark glass, not a lightsaber.
  const liquid = lowO2 ? '#dc2626' : '#1878ad';
  const liquidCore = lowO2 ? '#f87171' : '#57b6e6';
  const liquidDeep = lowO2 ? '#450a0a' : '#083a57';

  // Direct-O2 drop target - same 'enemy-o2' zone contract as always; the DOM
  // host is now the tank itself.
  const dropZone = { kind: 'enemy-o2' as const, playerId };
  const key = zoneKey(dropZone);
  const isLegalDropTarget = !!drag?.active && drag.legalZoneKeys.has(key);
  const isHovered = drag?.hoveredZoneKey === key;

  function popupClass(label?: string): string {
    const n = Math.abs(parseInt(label ?? '', 10)) || 0;
    return n >= 2 ? 'vfx-o2-popup-huge' : 'vfx-o2-popup-big';
  }

  return (
    <div
      ref={setRootEl}
      data-vfx-o2={playerId}
      data-dropzone={isLegalDropTarget ? JSON.stringify(dropZone) : undefined}
      // self-stretch (flex default) hands the tower the ROW's definite height
      // (the mat's height); aspect-ratio then derives the width from it. An
      // explicit height:100% would resolve against the row's auto height and
      // collapse to zero - the stretch path is the one that works.
      className={`relative shrink-0 select-none ${isLegalDropTarget ? (isHovered ? 'hud-drop-hover' : 'hud-drop-legal') : ''}`}
      style={{
        height: towerH || undefined,
        width: towerH ? towerH * (FRAME_W / FRAME_H) : undefined,
        containerType: 'size',
        zIndex: isLegalDropTarget ? 25 : undefined,
        visibility: towerH ? undefined : 'hidden',
      }}
    >
      {/* ---- under-frame layers (show through the transparent cutouts) ---- */}

      {/* O2 tank */}
      <div className="absolute overflow-hidden" style={{ ...MAIN, background: 'radial-gradient(120% 100% at 50% 0%, #0a0a10 0%, #000 70%)', boxShadow: 'inset 0 0 18px rgba(0,0,0,0.95)' }}>
        {/* BLOOM: blurred duplicate of the liquid column, wider than the tank,
            rendered first so the crisp column burns on top of its own glow */}
        <div
          className={`absolute -left-[10%] -right-[10%] bottom-0 hud-liquid-drain ${lowO2 ? 'hud-lowo2-breathe' : ''}`}
          style={{ height: `${fill * 100}%`, background: liquid, opacity: 0.26, filter: 'blur(12px)' }}
        />
        {/* liquid column - cylindrical shading: dark glass walls, bright core */}
        <div
          className="absolute inset-x-0 bottom-0 hud-liquid-drain"
          style={{
            height: `${fill * 100}%`,
            background: `linear-gradient(90deg, ${liquidDeep} 0%, ${liquid} 30%, ${liquidCore} 50%, ${liquid} 70%, ${liquidDeep} 100%)`,
            opacity: 0.76,
          }}
        />
        {/* depth tint - liquid darkens toward the bottom of the tank */}
        <div
          className="absolute inset-x-0 bottom-0 hud-liquid-drain pointer-events-none"
          style={{ height: `${fill * 100}%`, background: `linear-gradient(180deg, transparent 0%, ${liquidDeep}ee 100%)`, opacity: 0.65 }}
        />
        {/* liquid SURFACE: meniscus ellipse + burning glow line */}
        {fill > 0.005 && (
          <div className="absolute inset-x-0 hud-liquid-drain pointer-events-none" style={{ bottom: `${fill * 100}%` }}>
            <div
              className={o2Hit ? 'hud-surface-flash' : ''}
              style={{
                position: 'absolute', left: '4%', right: '4%', bottom: -3, height: 6, borderRadius: '50%',
                background: `radial-gradient(ellipse at center, ${liquidCore} 0%, ${liquid} 50%, transparent 78%)`,
                boxShadow: `0 0 6px 1px ${liquid}cc, 0 0 14px 3px ${liquid}55`,
              }}
            />
          </div>
        )}
        {/* rising bubbles - only when there's liquid to rise through */}
        {fill > 0.08 && (
          <div className="absolute inset-x-0 bottom-0 overflow-hidden pointer-events-none hud-liquid-drain" style={{ height: `${fill * 100}%` }}>
            <span className="hud-bubble" style={{ left: '34%', width: 3, height: 3, animationDelay: '0s', animationDuration: '4.2s' }} />
            <span className="hud-bubble" style={{ left: '58%', width: 2.5, height: 2.5, animationDelay: '1.6s', animationDuration: '3.4s' }} />
            <span className="hud-bubble" style={{ left: '47%', width: 2, height: 2, animationDelay: '2.7s', animationDuration: '2.9s' }} />
          </div>
        )}
        {/* tick marks etched over everything, spacing from the match's full scale */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `repeating-linear-gradient(0deg, transparent 0, transparent calc(${(100 * tickStepFor(startingO2)) / startingO2}% - 1px), rgba(255,255,255,0.13) calc(${(100 * tickStepFor(startingO2)) / startingO2}% - 1px), rgba(255,255,255,0.13) calc(${(100 * tickStepFor(startingO2)) / startingO2}%))`,
          }}
        />
        {/* glass tube: vertical specular streak + diagonal sheen + scanlines */}
        <div className="absolute inset-y-0 pointer-events-none" style={{ left: '18%', width: '9%', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)' }} />
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(115deg, rgba(255,255,255,0.10) 0%, transparent 30%, transparent 75%, rgba(255,255,255,0.05) 100%)' }} />
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 4px)' }} />
      </div>

      {/* numeric readout */}
      <div className="absolute flex items-center justify-center" style={{ ...NUM, background: 'radial-gradient(100% 100% at 50% 30%, #0b0b12 0%, #000 80%)', boxShadow: 'inset 0 0 14px rgba(0,0,0,0.95)' }}>
        <span
          className={`font-mono font-black leading-none ${o2Hit ? 'vfx-hit-flash' : ''} ${lowO2 ? 'animate-pulse' : ''}`}
          style={{
            fontSize: '11.5cqh',
            color: lowO2 ? '#f87171' : '#22d3ee',
            textShadow: lowO2 ? '0 0 12px rgba(248,113,113,0.7)' : '0 0 9px rgba(34,211,238,0.55), 0 0 20px rgba(34,211,238,0.22)',
          }}
        >
          {player.o2}
        </span>
      </div>

      {/* ---- the frame art (all four stacked; opacity picks the state) ---- */}
      {[0, 1, 2, 3].map((i) => (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          key={i}
          src={`/hud/momentum-${i}.webp`}
          alt=""
          draggable={false}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ opacity: i === momentum ? 1 : 0, filter: 'brightness(0.84) saturate(0.85)' }}
        />
      ))}

      {/* ---- over-frame layers ---- */}

      {/* canister charge/spend pulses over the momentum strip */}
      {(momGained || momSpent) && (
        <div
          className={`absolute pointer-events-none ${momGained ? 'hud-canister-charge' : 'hud-canister-spend'}`}
          style={{ ...CANISTERS, background: momGained ? 'radial-gradient(ellipse at 50% 40%, rgba(163,230,53,0.55) 0%, transparent 70%)' : 'radial-gradient(ellipse at 50% 40%, rgba(248,113,113,0.4) 0%, transparent 70%)' }}
        />
      )}

      {rootEl && o2Events.length > 0 && <HudO2Popups anchor={rootEl} events={o2Events} popupClass={popupClass} />}
    </div>
  );
}

/** Giant O2 popups, portaled to document.body (see Commit 54.1 StatsPanel
 *  notes - preserve-3d ancestors bury any in-tree z-index under the lifted
 *  card columns). Anchored beside the tower's number window. */
function HudO2Popups({ anchor, events, popupClass }: { anchor: HTMLElement; events: VisualEvent[]; popupClass: (label?: string) => string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = anchor.getBoundingClientRect();
    wrap.style.left = `${r.left + r.width / 2}px`;
    wrap.style.top = `${r.top + r.height * 0.72}px`;
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
