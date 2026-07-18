'use client';

import { useAnimationStore } from '@/store/animationStore';
import { getSleeve, SLEEVE_BASE_SRC, type SleeveSkin } from '@/lib/cosmetics';
import { useCosmeticsStore } from '@/store/cosmeticsStore';
import type { PlayerId } from '@/types/game';

/**
 * Compact visual stack for a player's Deck or Void (see PlayerBoard.tsx).
 * Deck is count-only and never clickable ("never reveal deck contents");
 * Void opens the full VoidInspectModal grid.
 *
 * Commit 45 - deck boxes are scrapped (per direction): both piles are now
 * full-bleed sleeved card-back stacks. Physicality from Commit 44 stays:
 * two-part shadows, and a paper-edge strip whose thickness tracks the REAL
 * card count so the deck visibly thins over a match.
 *
 * Commit 50.4 - sleeves are real full-back-REPLACEMENT art now, not a tint
 * layered over the original back. `sleeve.image` (null for 'none') decides
 * which single image renders; there's no filter/overlay compositing left.
 */

const CARD_W = 104;
const CARD_H = 146;

/** Two-part shadow: tight contact + soft ambient (unified top-left light). */
const PILE_SHADOW = 'drop-shadow(0 2px 2px rgba(0,0,0,0.6)) drop-shadow(0 9px 12px rgba(0,0,0,0.38))';


/** One sleeved card back: the sleeve's own art if it has one, otherwise the
 *  original printed back - a straight image swap, no filter/overlay. */
function SleevedBack({ sleeve }: { sleeve: SleeveSkin }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={sleeve.image ?? SLEEVE_BASE_SRC} alt="" className="w-full h-full object-cover" draggable={false} />
  );
}

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
  /** Whose sleeve this pile wears, and (for VOID) whose destruction events
   *  make it pulse. When omitted, default cosmetics apply. */
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

  return (
    <Wrapper
      type={Wrapper === 'button' ? 'button' : undefined}
      onClick={onClick && !isEmpty ? onClick : undefined}
      className={`relative flex flex-col items-center gap-1 shrink-0 ${onClick && !isEmpty ? 'cursor-pointer hover:-translate-y-0.5 transition-transform' : ''} ${pulsing ? 'vfx-place-glow' : ''}`}
      style={pulsing ? { ['--place-glow-color' as string]: `${accentColor}cc` } : undefined}
      title={label === 'VOID' ? (isEmpty ? 'Void is empty' : 'Click to inspect Void') : undefined}
    >
      <span className="text-[11px] font-bold tracking-wider leading-none" style={{ color: accentColor }}>
        {label} {count}
      </span>
      <div className="relative" style={{ width: CARD_W, height: CARD_H }}>
        {isEmpty ? (
          /* Empty pile - etched into the mat, not floating over it. */
          <div className="absolute inset-0 rounded slot-etched" />
        ) : (
          <div className="absolute inset-0" style={{ filter: PILE_SHADOW }}>
            {[2, 1, 0].map((i) => (
              <div
                key={i}
                className="absolute rounded border overflow-hidden"
                style={{
                  width: CARD_W,
                  height: CARD_H,
                  left: i * 3,
                  top: -i * 3,
                  borderColor: sleeve.id === 'none' ? `${accentColor}55` : sleeve.rim,
                }}
              >
                <SleevedBack sleeve={sleeve} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Wrapper>
  );
}
