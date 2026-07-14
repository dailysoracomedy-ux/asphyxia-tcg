'use client';

import { useState, useRef, useEffect } from 'react';
import type { ApexDef, CardInstance } from '@/types/game';
import type { AttackDamagePreview } from '@/game/rules';
import { getCardDef } from '@/data/cards';
import { factionTheme, getCardTypeLabel } from '@/lib/theme';
import { getCardArt, getArtAspectRatio } from '@/lib/cardArt';
import ApexCardRenderer from './ApexCardRenderer';
import GenericArtCard from './GenericArtCard';

interface CardProps {
  instance: CardInstance;
  onClick?: () => void;
  /** Commit 30 - starts a potential drag (see useDragDrop's beginPotentialDrag).
   *  Additive alongside onClick, never a replacement - a plain click (pointerdown
   *  + pointerup with no meaningful movement) still fires onClick as before. */
  onPointerDown?: (e: React.PointerEvent) => void;
  selected?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'apexBoard' | 'supportBoard' | 'hand';
  /** Suppresses full rulesText and other long-form info - used for on-board cards,
   *  which are game pieces (compact tactical info only), not full card previews. */
  compact?: boolean;
  faceDown?: boolean;
  highlight?: 'valid-target' | 'attacked' | 'locked' | 'tutorial-target' | 'tutorial-dim' | null;
  footer?: React.ReactNode;
  effectiveDef?: number;
  /** Per-attack damage preview, keyed by attack id - computed via getPreviewAttackDamage
   *  so the board display always agrees with the attack selector and combat resolution. */
  attackPreviews?: Record<string, AttackDamagePreview>;
  /** Opens a full detail view for this card - separate from onClick so it never
   *  conflicts with the card's normal gameplay action. */
  onInspect?: () => void;
  /** Commit 30.6 - see ApexOverlayLayer's own doc. Threaded through to
   *  ApexCardRenderer for the attack popup's card-integrated selector. */
  attackSelectMode?: boolean;
  affordableAttackIds?: Set<string>;
  onSelectAttack?: (attackId: string) => void;
  tutorialHighlightAttackId?: string | null;
  /** Internal - set on the enlarged preview copy itself so it doesn't try to spawn
   *  a hover preview of its own. Not meant to be passed by normal callers. */
  disableHoverPreview?: boolean;
  /** Purely visual dimming for hand-context "this can't be played right now" cues
   *  (Commit 23). Never affects onClick/disabled - a dimmed card is still exactly
   *  as clickable as it already was, same as any other currently-invalid target in
   *  this app (the store rejects the play with a log message, same pattern used
   *  everywhere else). Only ever pass this from Hand.tsx - CardHoverPreview never
   *  receives it, which is what keeps zoom/hover always full brightness by
   *  construction rather than by remembering to opt out. */
  isPlayable?: boolean;
}

const BOOST_GREEN = '#4ade80';
const NERF_RED = '#f87171';

export default function Card({
  instance,
  onClick,
  onPointerDown,
  selected,
  disabled,
  size = 'md',
  compact,
  faceDown,
  highlight,
  footer,
  effectiveDef,
  attackPreviews,
  onInspect,
  attackSelectMode,
  affordableAttackIds,
  onSelectAttack,
  tutorialHighlightAttackId,
  disableHoverPreview,
  isPlayable,
}: CardProps) {
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearHoverTimer() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }

  useEffect(() => clearHoverTimer, []);

  function handleMouseEnter(e: React.MouseEvent) {
    if (disableHoverPreview || size === 'lg' || size === 'xl') return;
    // Hover-only devices, not touch - avoids a "sticky" enlarged preview after a tap.
    if (typeof window !== 'undefined' && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const x = e.clientX;
    const y = e.clientY;
    clearHoverTimer();
    hoverTimer.current = setTimeout(() => setHoverPos({ x, y }), 350);
  }

  function handleMouseLeave() {
    clearHoverTimer();
    setHoverPos(null);
  }

  const hoverPreview =
    hoverPos && !disableHoverPreview ? (
      <CardHoverPreview
        x={hoverPos.x}
        y={hoverPos.y}
        instance={instance}
        effectiveDef={effectiveDef}
        attackPreviews={attackPreviews}
      />
    ) : null;

  if (faceDown) {
    const fdW = size === 'sm' ? 64 : 92;
    const fdH = size === 'sm' ? 90 : 128;
    return (
      <div className="rounded-md border border-cyan-900 overflow-hidden" style={{ width: fdW, height: fdH }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/card-back.webp" alt="" className="w-full h-full object-cover" draggable={false} />
      </div>
    );
  }

  const def = getCardDef(instance.defId);
  const theme = factionTheme(def.faction);
  const isApex = def.type === 'Apex';
  const apexDef = isApex ? (def as ApexDef) : null;

  const SIZE_MAP: Record<string, { w: number; h: number; text: string }> = {
    sm: { w: 104, h: 148, text: 'text-[9px]' },
    md: { w: 144, h: 204, text: 'text-[10.5px]' },
    lg: { w: 200, h: 280, text: 'text-[13px]' },
    // xl is the hover-preview size - genuinely renders everything bigger (not just a
    // bigger box around the same 'lg' content), including Apex overlay text, since
    // that scales off the actual rendered card width.
    xl: { w: 380, h: 532, text: 'text-[18px]' },
    // Board sizes are deliberately compact - board cards are game pieces, not full
    // previews. Hand cards get a bit more room since they're the "read the card" view.
    apexBoard: { w: 128, h: 152, text: 'text-[9.5px]' },
    supportBoard: { w: 96, h: 100, text: 'text-[8.5px]' },
    hand: { w: 136, h: 170, text: 'text-[10.5px]' },
  };
  const { w, h, text: textScale } = SIZE_MAP[size];
  // Purely visual - isPlayable defaults to undefined everywhere except Hand.tsx, so
  // every other caller (board, inspect modal, gallery, hover preview) is completely
  // unaffected by this and stays exactly as bright as it always was.
  const dimStyle: React.CSSProperties | undefined =
    isPlayable === false ? { opacity: 0.5, filter: 'grayscale(55%)', transition: 'opacity 150ms, filter 150ms' } : undefined;

  const ringClass = selected
    ? 'ring-2 ring-yellow-300 ring-offset-1 ring-offset-black'
    : highlight === 'valid-target'
    ? 'ring-2 ring-red-400 animate-pulse'
    : highlight === 'locked'
    ? 'ring-2 ring-gray-600'
    : '';

  // Apex cards with a mapped base image use the dynamic overlay template instead of
  // the flow-based layout below. Cards with no art entry in lib/cardArt.ts fall
  // through unchanged - this is purely additive, never required.
  // Cards with a mapped base image use the art-based layout instead of the flow-
  // based layout below. Cards with no art entry in lib/cardArt.ts fall through
  // unchanged - this is purely additive, never required. Apex gets the full dynamic
  // DEF/attack overlay (ApexCardRenderer); every other card type is art-only
  // (GenericArtCard), since nothing on their face changes live.
  if (getCardArt(instance.defId)) {
    // Anchor to the size preset's height (keeps board/hand row rhythm unchanged) and
    // derive width from the art's own ratio, rather than reusing SIZE_MAP's width -
    // that mismatch would otherwise force object-fit to either crop the frame edges
    // or pillarbox the image, throwing off Apex's percentage-based overlay zones.
    // Apex art is 600x900 (2:3); every other card type's art is 1500x2100 (5:7).
    const artRatio = getArtAspectRatio(def.type);
    const artW = Math.round(h * artRatio);
    return (
      <div
        className={`relative inline-block shrink-0 ${
          highlight === 'tutorial-target' ? 'tutorial-spotlight' : highlight === 'tutorial-dim' ? 'pointer-events-none' : ''
        }`}
        style={{ width: artW, height: h, opacity: highlight === 'tutorial-dim' ? 0.35 : undefined, filter: highlight === 'tutorial-dim' ? 'grayscale(70%)' : undefined, transition: 'opacity 150ms, filter 150ms', ...dimStyle }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {hoverPreview}
        {isApex && apexDef ? (
          <ApexCardRenderer
            instance={instance}
            effectiveDef={effectiveDef ?? apexDef.baseDef}
            cardWidth={artW}
            attackPreviews={attackPreviews}
            onClick={onClick}
            onPointerDown={onPointerDown}
            selected={selected}
            disabled={disabled}
            footer={footer}
            attackSelectMode={attackSelectMode}
            affordableAttackIds={affordableAttackIds}
            onSelectAttack={onSelectAttack}
            tutorialHighlightAttackId={tutorialHighlightAttackId}
          />
        ) : (
          <GenericArtCard defId={instance.defId} onClick={onClick} onPointerDown={onPointerDown} selected={selected} disabled={disabled} footer={footer} />
        )}
        {onInspect && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInspect();
            }}
            title="View full card details"
            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 border border-white/30 text-white/70 text-[9px] leading-none flex items-center justify-center hover:bg-black/90 hover:text-white z-10"
          >
            i
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative inline-block shrink-0" style={dimStyle} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
    {hoverPreview}
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      disabled={disabled}
      style={{
        width: w,
        height: h,
        background: theme.bg,
        borderColor: theme.border,
        color: theme.text,
        boxShadow: selected ? `0 0 10px ${theme.primary}` : `0 0 4px ${theme.primary}66`,
      }}
      className={`relative flex flex-col text-left rounded-md border-2 p-1.5 overflow-hidden shrink-0 transition-transform ${textScale} ${ringClass} ${
        disabled ? 'opacity-40 cursor-not-allowed' : onClick ? 'hover:-translate-y-1 cursor-pointer' : 'cursor-default'
      } ${highlight === 'attacked' ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-bold leading-tight truncate" style={{ color: theme.primary }}>
          {def.name}
        </span>
      </div>
      <div className="flex items-center justify-between mt-0.5 opacity-80" style={{ color: theme.secondary }}>
        <span className="tracking-wider">{getCardTypeLabel(def)}</span>
        {apexDef &&
          (() => {
            const shownDef = effectiveDef ?? apexDef.baseDef;
            const defDelta = shownDef - apexDef.baseDef;
            const defColor = defDelta > 0 ? BOOST_GREEN : defDelta < 0 ? NERF_RED : theme.secondary;
            return (
              <span className="font-mono font-bold" style={{ color: defColor }}>
                DEF {shownDef}
                {defDelta !== 0 && <span className="ml-0.5">({defDelta > 0 ? '+' : ''}{defDelta})</span>}
              </span>
            );
          })()}
      </div>

      {'cost' in def && (
        <div className="mt-0.5 font-mono" style={{ color: theme.secondary }}>
          Cost: {(def as { cost: number }).cost} Momentum
        </div>
      )}

      {apexDef && (
        <div className="mt-1 flex-1 overflow-y-auto space-y-0.5 leading-tight">
          {apexDef.attacks.map((atk) => {
            const preview = attackPreviews?.[atk.id];
            const shownDamage = preview?.modifiedDamage ?? atk.baseDamage;
            const isModified = preview ? preview.modifiedDamage !== preview.baseDamage : false;
            const dmgColor = isModified ? (shownDamage > atk.baseDamage ? BOOST_GREEN : NERF_RED) : undefined;
            return (
              <div key={atk.id} className="flex justify-between gap-1 opacity-90">
                <span className="truncate">
                  [{atk.syncCost}] {atk.name}
                </span>
                <span className="font-mono font-bold shrink-0" style={dmgColor ? { color: dmgColor } : undefined}>
                  {shownDamage}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {!apexDef && !compact && (
        <div className="mt-1 flex-1 overflow-y-auto leading-tight opacity-85">{def.rulesText}</div>
      )}

      {instance.counters && (instance.counters.choke || instance.counters.upgrade || instance.counters.glitch) ? (
        <div className="mt-0.5 flex gap-1 flex-wrap">
          {instance.counters.choke > 0 && (
            <span className="px-1 rounded bg-black/50 border border-red-400 text-red-300">CHK {instance.counters.choke}</span>
          )}
          {instance.counters.upgrade > 0 && (
            <span className="px-1 rounded bg-black/50 border border-amber-300 text-amber-200">UPG {instance.counters.upgrade}</span>
          )}
          {instance.counters.glitch > 0 && (
            <span className="px-1 rounded bg-black/50 border border-fuchsia-400 text-fuchsia-200">GLT {instance.counters.glitch}</span>
          )}
        </div>
      ) : null}

      {instance.equip && (
        <div className="mt-0.5 px-1 rounded bg-black/40 border border-white/20 truncate">
          Equip: {getCardDef(instance.equip.defId).name}
        </div>
      )}

      {footer}
    </button>
    {onInspect && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onInspect();
        }}
        title="View full card details"
        className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 border border-white/30 text-white/70 text-[9px] leading-none flex items-center justify-center hover:bg-black/90 hover:text-white z-10"
      >
        i
      </button>
    )}
    </div>
  );
}

/** The enlarged hover copy - fixed-position, click-through (pointer-events-none, so
 *  it can never intercept a real click), and clamped to stay fully inside the
 *  viewport regardless of where on screen the source card sits. Reuses Card's own
 *  'lg' rendering (same one Card Inspect and the Developer gallery use) rather than
 *  duplicating any layout, so art cards show their real art here too. */
export function CardHoverPreview({
  x,
  y,
  instance,
  effectiveDef,
  attackPreviews,
}: {
  x: number;
  y: number;
  instance: CardInstance;
  effectiveDef?: number;
  attackPreviews?: Record<string, AttackDamagePreview>;
}) {
  const PREVIEW_W = 380;
  const PREVIEW_H = 532;
  const OFFSET = 24;
  const MARGIN = 10;

  let left = x + OFFSET;
  let top = y - PREVIEW_H / 2;

  if (typeof window !== 'undefined') {
    if (left + PREVIEW_W > window.innerWidth - MARGIN) left = x - OFFSET - PREVIEW_W;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - PREVIEW_W - MARGIN));
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - PREVIEW_H - MARGIN));
  }

  return (
    <div className="fixed z-40 pointer-events-none" style={{ left, top, filter: 'drop-shadow(0 10px 30px rgba(0,0,0,0.7))' }}>
      <Card instance={instance} size="xl" effectiveDef={effectiveDef} attackPreviews={attackPreviews} disableHoverPreview />
    </div>
  );
}
