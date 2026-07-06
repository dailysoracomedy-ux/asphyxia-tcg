'use client';

import type { ApexDef, CardInstance } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { factionTheme, CARD_TYPE_LABEL } from '@/lib/theme';

interface CardProps {
  instance: CardInstance;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  faceDown?: boolean;
  highlight?: 'valid-target' | 'attacked' | 'locked' | null;
  footer?: React.ReactNode;
  effectiveDef?: number;
  attackBonusPreview?: number;
}

const BOOST_GREEN = '#4ade80';
const NERF_RED = '#f87171';

export default function Card({
  instance,
  onClick,
  selected,
  disabled,
  size = 'md',
  faceDown,
  highlight,
  footer,
  effectiveDef,
  attackBonusPreview,
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

  const widthClass = size === 'sm' ? 'w-[104px] h-[148px]' : size === 'lg' ? 'w-[200px] h-[280px]' : 'w-[144px] h-[204px]';
  const textScale = size === 'sm' ? 'text-[9px]' : size === 'lg' ? 'text-[13px]' : 'text-[10.5px]';

  const ringClass = selected
    ? 'ring-2 ring-yellow-300 ring-offset-1 ring-offset-black'
    : highlight === 'valid-target'
    ? 'ring-2 ring-red-400 animate-pulse'
    : highlight === 'locked'
    ? 'ring-2 ring-gray-600'
    : '';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative flex flex-col text-left rounded-md border-2 p-1.5 overflow-hidden shrink-0 transition-transform ${widthClass} ${textScale} ${ringClass} ${
        disabled ? 'opacity-40 cursor-not-allowed' : onClick ? 'hover:-translate-y-1 cursor-pointer' : 'cursor-default'
      } ${highlight === 'attacked' ? 'opacity-50' : ''}`}
      style={{
        background: theme.bg,
        borderColor: theme.border,
        color: theme.text,
        boxShadow: selected ? `0 0 10px ${theme.primary}` : `0 0 4px ${theme.primary}66`,
      }}
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
            const bonus = attackBonusPreview ?? 0;
            const shownDamage = atk.baseDamage + bonus;
            const dmgColor = bonus > 0 ? BOOST_GREEN : bonus < 0 ? NERF_RED : undefined;
            return (
              <div key={atk.id} className="flex justify-between gap-1 opacity-90">
                <span className="truncate">
                  [{atk.syncCost}] {atk.name}
                </span>
                <span className="font-mono font-bold shrink-0" style={dmgColor ? { color: dmgColor } : undefined}>
                  {shownDamage}
                  {bonus !== 0 && <span className="ml-0.5">({bonus > 0 ? '+' : ''}{bonus})</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {!apexDef && (
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
  );
}
