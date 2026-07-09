'use client';

import { getCardArt } from '@/lib/cardArt';

/**
 * Art rendering for every non-Apex card type (Engine, Equip, Special, React). No
 * dynamic overlay - unlike Apex, nothing on these faces changes live (an Engine's
 * chain/lock status is shown as a small badge via the existing `footer` prop from
 * whichever board slot renders it, same pattern as before art existed). Just the
 * baked art, full stop.
 */
export default function GenericArtCard({
  defId,
  onClick,
  selected,
  disabled,
  footer,
}: {
  defId: string;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  footer?: React.ReactNode;
}) {
  const art = getCardArt(defId);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative w-full h-full rounded-md overflow-hidden border-2 shrink-0 transition-transform ${
        disabled ? 'opacity-40 cursor-not-allowed' : onClick ? 'hover:-translate-y-1 cursor-pointer' : 'cursor-default'
      } ${selected ? 'ring-2 ring-yellow-300 ring-offset-1 ring-offset-black' : ''}`}
      style={{ borderColor: '#ffffff33' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art} alt="" className="absolute inset-0 w-full h-full object-contain" draggable={false} />
      {footer}
    </button>
  );
}
