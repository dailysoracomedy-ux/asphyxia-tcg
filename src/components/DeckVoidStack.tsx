'use client';

import { useAnimationStore } from '@/store/animationStore';
import { getSleeve, getDeckBox, SLEEVE_BASE_SRC, COIN_FRONT_SRC } from '@/lib/cosmetics';
import { useCosmeticsStore } from '@/store/cosmeticsStore';
import type { PlayerId } from '@/types/game';

/**
 * Compact visual stack for a player's Deck or Void (see PlayerBoard.tsx).
 * Deck is count-only and never clickable ("never reveal deck contents");
 * Void opens the full VoidInspectModal grid.
 *
 * Commit 44 - physicality pass, fixing the reported deck-box problems:
 * - The old "peeking card" cropped to the top ~25% of the card-back art,
 *   which is mostly its white distressed border - it read as a mis-sized
 *   white sticker. The peek now crops PAST the border into the art itself,
 *   at nearly full card width, so the visible slice is recognizably a
 *   sleeved card sitting in a box.
 * - Box proportions: real deck boxes are slightly LARGER than their cards,
 *   not smaller - the box is now 112x152 around 104x146 cards, with thin
 *   visible walls, a lit lid face (a trapezoid that reads as its top surface
 *   under the board's existing 11-degree tilt), and a two-part shadow.
 * - Bare piles get a paper-edge strip whose thickness scales with the REAL
 *   card count, so the deck visibly thins over the course of a match.
 */

const CARD_W = 104;
const CARD_H = 146;
const BOX_W = 112;
const BOX_H = 152;

/** Two-part shadow: tight contact + soft ambient - what actually makes a
 *  pile sit ON the mat instead of floating in it. Light source is top-left
 *  (the app-wide convention - see globals.css "unified light" note). */
const PILE_SHADOW = 'drop-shadow(0 2px 2px rgba(0,0,0,0.6)) drop-shadow(0 9px 12px rgba(0,0,0,0.38))';

/** Paper-edge thickness for a pile of `count` cards, in px. */
function edgePx(count: number): number {
  return Math.max(2, Math.min(10, Math.round(count * 0.35)));
}

function PaperEdge({ count, width }: { count: number; width: number }) {
  const h = edgePx(count);
  return (
    <div
      aria-hidden
      className="absolute left-[2px] rounded-b-[2px]"
      style={{
        top: '100%',
        marginTop: -1,
        width: width - 4,
        height: h,
        background:
          'repeating-linear-gradient(0deg, #b7b2a9 0px, #b7b2a9 1px, #6e6a62 1px, #6e6a62 2px)',
        boxShadow: 'inset 0 -1px 1px rgba(0,0,0,0.5)',
      }}
    />
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

  const frameW = boxed ? BOX_W : CARD_W;
  const frameH = boxed ? BOX_H : CARD_H;

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
      <div className="relative" style={{ width: frameW, height: frameH }}>
        {isEmpty ? (
          /* Empty pile - etched into the mat, not floating over it. */
          <div className="absolute inset-0 rounded slot-etched" />
        ) : boxed ? (
          <div className="absolute inset-0" style={{ filter: PILE_SHADOW }}>
            {/* Lid face - the box's top surface, catching the light. Under the
                board's 11-degree tilt a lit trapezoid up top reads as looking
                slightly down INTO the box, which the perspective implies. */}
            <div
              aria-hidden
              className="absolute left-0 right-0"
              style={{
                top: -7,
                height: 8,
                clipPath: 'polygon(7% 0, 93% 0, 100% 100%, 0 100%)',
                background: `linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.05)), ${deckBox.body}`,
                borderBottom: `1px solid ${deckBox.edge}66`,
              }}
            />
            {/* Box body */}
            <div
              className="absolute inset-0 rounded-[5px] border flex flex-col items-center overflow-hidden"
              style={{
                background: deckBox.body!,
                borderColor: `${deckBox.edge}99`,
                // bevel: top edge catches the light, bottom falls into shadow
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -5px 10px rgba(0,0,0,0.5)`,
              }}
            >
              {/* Sleeved card seated in the box - near full card width, thin
                  walls, cropped PAST the card back's white border so the
                  visible slice is unmistakably the sleeve art. */}
              <div
                className="relative mt-[5px] rounded-t-[3px] border border-b-0 overflow-hidden"
                style={{
                  width: CARD_W - 8,
                  height: 44,
                  borderColor: sleeve.rim,
                  boxShadow: 'inset 0 3px 5px rgba(0,0,0,0.55)', // seated IN the box
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={SLEEVE_BASE_SRC}
                  alt=""
                  className="absolute left-0 w-full object-cover"
                  style={{
                    filter: sleeve.filter,
                    height: Math.round((CARD_W - 8) * (CARD_H / CARD_W)),
                    top: -16, // skip the art's own white grunge border
                  }}
                  draggable={false}
                />
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
                  style={{ filter: deckBox.emblemFilter, boxShadow: `0 2px 6px rgba(0,0,0,0.6)` }}
                  draggable={false}
                />
              </div>
              {/* base plate */}
              <div className="w-full h-2" style={{ background: 'rgba(0,0,0,0.35)', borderTop: `1px solid ${deckBox.edge}44` }} />
            </div>
          </div>
        ) : (
          <div className="absolute inset-0" style={{ filter: PILE_SHADOW }}>
            {/* Stacked sleeved card-backs; the paper edge below the front card
                scales with the real count, so the pile visibly thins. */}
            {[2, 1, 0].map((i) => (
              <div
                key={i}
                className="absolute rounded border overflow-hidden"
                style={{
                  width: CARD_W,
                  height: CARD_H,
                  left: i * 3,
                  top: -i * 3,
                  borderColor: sleeve.id === 'asphyxia' ? `${accentColor}55` : sleeve.rim,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={SLEEVE_BASE_SRC} alt="" className="w-full h-full object-cover" style={{ filter: sleeve.filter }} draggable={false} />
              </div>
            ))}
            <PaperEdge count={count} width={CARD_W} />
          </div>
        )}
      </div>
    </Wrapper>
  );
}
