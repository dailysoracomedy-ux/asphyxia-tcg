'use client';

import { useAnimationStore } from '@/store/animationStore';

/**
 * Compact visual stack for a player's Deck or Void, shown in the board row's
 * otherwise-empty outer column (mirrors whichever side doesn't have Support slots -
 * see PlayerBoard.tsx). Deck is always count-only and never clickable, matching the
 * existing "never reveal deck contents" rule; Void is clickable to open the full
 * VoidInspectModal grid.
 */
export default function DeckVoidStack({
  label,
  count,
  onClick,
  accentColor,
  playerId,
}: {
  label: 'DECK' | 'VOID';
  count: number;
  onClick?: () => void;
  accentColor: string;
  /** Optional - when given, VOID pulses whenever a card actually lands in this
   *  player's Void (a destroyed Apex/Engine, or a negated card). DECK deliberately
   *  doesn't pulse on draw yet - that would need a dedicated draw event wired
   *  through Draw Phase's auto-resolve, a larger change deferred for now (see
   *  the README). */
  playerId?: string;
}) {
  const isEmpty = count === 0;
  const Wrapper = onClick && !isEmpty ? 'button' : 'div';
  const pulsing = useAnimationStore((s) =>
    label === 'VOID' && playerId
      ? s.events.some(
          (e) =>
            (e.type === 'CARD_DESTROYED' && e.destroyedGhost?.ownerId === playerId) ||
            (e.type === 'CARD_NEGATED' && e.playerId === playerId)
        )
      : false
  );

  return (
    <Wrapper
      type={Wrapper === 'button' ? 'button' : undefined}
      onClick={onClick && !isEmpty ? onClick : undefined}
      className={`relative flex flex-col items-center gap-1 shrink-0 ${onClick && !isEmpty ? 'cursor-pointer hover:-translate-y-0.5 transition-transform' : ''} ${pulsing ? 'vfx-place-glow' : ''}`}
      style={pulsing ? { ['--place-glow-color' as string]: `${accentColor}cc` } : undefined}
      title={label === 'VOID' ? (isEmpty ? 'Void is empty' : 'Click to inspect Void') : undefined}
    >
      <span className="text-[10px] font-bold tracking-wider leading-none" style={{ color: accentColor }}>
        {label} {count}
      </span>
      <div className="relative" style={{ width: 90, height: 126 }}>
        {isEmpty ? (
          <div className="absolute inset-0 rounded border border-dashed border-white/15" />
        ) : (
          <>
            {/* Stacked card-backs for visual depth - up to 3 layers regardless of real count. */}
            {[2, 1, 0].map((i) => (
              <div
                key={i}
                className="absolute rounded border overflow-hidden"
                style={{
                  width: 90,
                  height: 126,
                  left: i * 3,
                  top: -i * 3,
                  borderColor: `${accentColor}55`,
                  boxShadow: i === 0 ? `0 2px 6px rgba(0,0,0,0.6)` : undefined,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/art/card-back.webp" alt="" className="w-full h-full object-cover" draggable={false} />
              </div>
            ))}
          </>
        )}
      </div>
    </Wrapper>
  );
}
