'use client';

import { useAnimationStore } from '@/store/animationStore';
import { getSleeve, getDeckBox, SLEEVE_BASE_SRC, COIN_FRONT_SRC } from '@/lib/cosmetics';
import { useCosmeticsStore } from '@/store/cosmeticsStore';
import type { PlayerId } from '@/types/game';

/**
 * Compact visual stack for a player's Deck or Void, shown in the board row's
 * otherwise-empty outer column (mirrors whichever side doesn't have Support slots -
 * see PlayerBoard.tsx). Deck is always count-only and never clickable, matching the
 * existing "never reveal deck contents" rule; Void is clickable to open the full
 * VoidInspectModal grid.
 *
 * Commit 42 - cosmetics-aware. Card backs wear this seat's equipped sleeve
 * (tint + rim from cosmeticsStore), and the DECK pile sits inside the seat's
 * equipped deck box when one is selected ('bare' keeps the classic stack).
 * The VOID is always a bare stack - destroyed cards don't go back in the box.
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
  /** Whose gear this pile wears, and (for VOID) whose destruction events make
   *  it pulse. When omitted, default cosmetics apply. */
  playerId?: PlayerId | string;
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

  const seat: PlayerId = playerId === 'player2' ? 'player2' : 'player1';
  const sleeve = useCosmeticsStore((s) => getSleeve(s.loadouts[seat].sleeve));
  const deckBox = useCosmeticsStore((s) => getDeckBox(s.loadouts[seat].deckbox));
  const boxed = label === 'DECK' && deckBox.body !== null && !isEmpty;

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
      <div className="relative" style={{ width: 104, height: 146 }}>
        {isEmpty ? (
          <div className="absolute inset-0 rounded border border-dashed border-white/15" />
        ) : boxed ? (
          /* Deck box: the pile lives inside a case - lid strip up top, coin
             emblem on the front, top card peeking out so it still clearly
             reads as "your deck". */
          <div
            className="absolute inset-0 rounded-md border flex flex-col items-center overflow-hidden"
            style={{
              background: deckBox.body!,
              borderColor: `${deckBox.edge}99`,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -6px 12px rgba(0,0,0,0.5), 0 3px 8px rgba(0,0,0,0.6)`,
            }}
          >
            {/* peeking sleeved top card */}
            <div
              className="mt-1 rounded-t-sm border border-b-0 overflow-hidden"
              style={{ width: 84, height: 30, borderColor: sleeve.rim }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={SLEEVE_BASE_SRC} alt="" className="w-full object-cover" style={{ filter: sleeve.filter, height: 118 }} draggable={false} />
            </div>
            {/* lid seam */}
            <div className="w-full h-[3px]" style={{ background: `${deckBox.edge}55`, boxShadow: `0 1px 2px rgba(0,0,0,0.6)` }} />
            {/* front face with emblem */}
            <div className="flex-1 w-full flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={COIN_FRONT_SRC}
                alt=""
                className="w-12 h-12 rounded-full opacity-90"
                style={{ filter: deckBox.emblemFilter, boxShadow: `0 0 10px rgba(0,0,0,0.6)` }}
                draggable={false}
              />
            </div>
            {/* base plate */}
            <div className="w-full h-2" style={{ background: 'rgba(0,0,0,0.35)', borderTop: `1px solid ${deckBox.edge}44` }} />
          </div>
        ) : (
          <>
            {/* Stacked sleeved card-backs for visual depth - up to 3 layers regardless of real count. */}
            {[2, 1, 0].map((i) => (
              <div
                key={i}
                className="absolute rounded border overflow-hidden"
                style={{
                  width: 104,
                  height: 146,
                  left: i * 3,
                  top: -i * 3,
                  borderColor: sleeve.id === 'asphyxia' ? `${accentColor}55` : sleeve.rim,
                  boxShadow: i === 0 ? `0 2px 6px rgba(0,0,0,0.6)` : undefined,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={SLEEVE_BASE_SRC} alt="" className="w-full h-full object-cover" style={{ filter: sleeve.filter }} draggable={false} />
              </div>
            ))}
          </>
        )}
      </div>
    </Wrapper>
  );
}
