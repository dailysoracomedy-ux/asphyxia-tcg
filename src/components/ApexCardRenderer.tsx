'use client';

import type { CardInstance, ApexDef } from '@/types/game';
import { getCardDef } from '@/data/cards';
import type { AttackDamagePreview } from '@/game/rules';
import { CardArtLayer, ApexOverlayLayer } from './apex-overlay/ApexOverlaySystem';

interface ApexCardRendererProps {
  instance: CardInstance;
  effectiveDef: number;
  /** Actual rendered width in px - required so overlay text scales correctly
   *  instead of using a fixed/inherited font size (the bug this fixes: numbers
   *  were rendering at browser-default size regardless of how small the card was). */
  cardWidth: number;
  /** Per-attack damage preview, keyed by attack id - same shape/source Card.tsx
   *  already receives (getPreviewAttackDamage), so the overlay can never disagree
   *  with the board, the attack selector, or combat resolution. */
  attackPreviews?: Record<string, AttackDamagePreview>;
  onClick?: () => void;
  /** Commit 30 - starts a potential drag. See Card.tsx's identical prop doc -
   *  this is the actual render path real gameplay cards use once art is
   *  mapped (nearly every card), so this needs the same wiring the fallback
   *  path already has. */
  onPointerDown?: (e: React.PointerEvent) => void;
  selected?: boolean;
  disabled?: boolean;
  /** Forces the art layer to render its placeholder gradient even if real art is
   *  mapped - used by the Developer gallery for template tuning. */
  forceArtPlaceholder?: boolean;
  debugZones?: boolean;
  footer?: React.ReactNode;
}

/**
 * The single reusable Apex card template: a baked art/frame layer (Layer 1) plus a
 * dynamic percentage-positioned overlay (Layer 2) for DEF, attack damage, and
 * counters. Used identically by the live match UI (via Card.tsx, once a card has
 * real art mapped in lib/cardArt.ts) and the Developer card gallery - there is no
 * separate one-off gallery renderer.
 */
export default function ApexCardRenderer({
  instance,
  effectiveDef,
  cardWidth,
  attackPreviews,
  onClick,
  onPointerDown,
  selected,
  disabled,
  forceArtPlaceholder,
  debugZones,
  footer,
}: ApexCardRendererProps) {
  const def = getCardDef(instance.defId) as ApexDef;

  const attackDamages: Record<string, number> = {};
  for (const atk of def.attacks) {
    attackDamages[atk.id] = attackPreviews?.[atk.id]?.modifiedDamage ?? atk.baseDamage;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      disabled={disabled}
      className={`relative w-full h-full rounded-md overflow-hidden border-2 shrink-0 transition-transform ${
        disabled ? 'opacity-40 cursor-not-allowed' : onClick ? 'hover:-translate-y-1 cursor-pointer' : 'cursor-default'
      } ${selected ? 'ring-2 ring-yellow-300 ring-offset-1 ring-offset-black' : ''}`}
      style={{ borderColor: '#ffffff33' }}
    >
      <CardArtLayer defId={instance.defId} faction={def.faction} forcePlaceholder={forceArtPlaceholder} />
      <ApexOverlayLayer
        instance={instance}
        apexDef={def}
        effectiveDef={effectiveDef}
        attackDamages={attackDamages}
        cardWidth={cardWidth}
        debugZones={debugZones}
      />
      {footer}
    </button>
  );
}
