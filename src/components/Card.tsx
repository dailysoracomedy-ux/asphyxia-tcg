'use client';

import type { ApexDef, CardInstance } from '@/types/game';
import type { AttackDamagePreview } from '@/game/rules';
import { getCardDef } from '@/data/cards';
import { factionTheme, CARD_TYPE_LABEL } from '@/lib/theme';

interface CardProps {
  instance: CardInstance;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'apexBoard' | 'supportBoard' | 'hand';
  /** Suppresses full rulesText and other long-form info - used for on-board cards,
   *  which are game pieces (compact tactical info only), not full card previews. */
  compact?: boolean;
  faceDown?: boolean;
  highlight?: 'valid-target' | 'attacked' | 'locked' | null;
  footer?: React.ReactNode;
  effectiveDef?: number;
  /** Per-attack damage preview, keyed by attack id - computed via getPreviewAttackDamage
   *  so the board display always agrees with the attack selector and combat resolution. */
  attackPreviews?: Record<string, AttackDamagePreview>;
  /** Opens a full detail view for this card - separate from onClick so it never
   *  conflicts with the card's normal gameplay action. */
  onInspect?: () => void;
}

const BOOST_GREEN = '#4ade80';
const NERF_RED = '#f87171';

export default function Card({
  instance,
  onClick,
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
}: CardProps) {
  if (faceDown) {
    return (
      <div
        className="rounded-md border border-cyan-900 bg-[repeating-linear-gradient(45deg,#0a0a12,#0a0a12_6px,#101018_6px,#101018_12px)] flex items-center justify-center text-cyan-800 text-[10px] tracking-widest"
        style={{ width: size === 'sm' ? 64 : 92, height: size === 'sm' ? 90 : 128 }}
      >
        ASPHYXIA
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
    // Board sizes are deliberately compact - board cards are game pieces, not full
    // previews. Hand cards get a bit more room since they're the "read the card" view.
    apexBoard: { w: 128, h: 152, text: 'text-[9.5px]' },
    supportBoard: { w: 96, h: 100, text: 'text-[8.5px]' },
    hand: { w: 118, h: 148, text: 'text-[9.5px]' },
  };
  const { w, h, text: textScale } = SIZE_MAP[size];

  const ringClass = selected
    ? 'ring-2 ring-yellow-300 ring-offset-1 ring-offset-black'
    : highlight === 'valid-target'
    ? 'ring-2 ring-red-400 animate-pulse'
    : highlight === 'locked'
    ? 'ring-2 ring-gray-600'
    : '';

  return (
    <div className="relative inline-block shrink-0">
    <button
      type="button"
      onClick={onClick}
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
        <span className="tracking-wider">{CARD_TYPE_LABEL[def.type]}</span>
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
