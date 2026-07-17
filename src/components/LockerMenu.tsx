'use client';

/**
 * Commit 42 - THE LOCKER: pick your gear. Three tabs (Playmat / Sleeves /
 * Coins), each a grid of live previews built from the same cosmetics
 * registry the game itself renders from - so the preview tile IS the real
 * look, not a screenshot that can drift out of date.
 *
 * Seat switcher at the top: player1 is "you" in solo games; in hotseat,
 * Player 2 can dress their own side too. Selections persist via
 * cosmeticsStore (localStorage).
 *
 * Commit 50 (section 12) - restyled as an industrial loadout terminal: the
 * seat switcher is a segmented mechanical toggle, the category tabs are
 * shallow grunge plates with an illuminated top edge on the active one.
 *
 * Commit 50.4 - real art everywhere, and bigger/more physical previews:
 * playmat tiles are ~65% taller and show the actual playmat art; sleeve
 * tiles are noticeably bigger and tilted in real CSS 3D space (perspective +
 * rotateY), like a card propped up on a shelf; coin tiles are genuinely
 * live WebGL (CoinPreview3D) - the same emissive-bloom coin technique as the
 * Coin Flip screen, just tuned down to render ~10 of them at once cheaply.
 */

import { useState } from 'react';
import type { PlayerId } from '@/types/game';
import {
  PLAYMATS,
  SLEEVES,
  COINS,
  SLEEVE_BASE_SRC,
  type CosmeticKind,
} from '@/lib/cosmetics';
import { useCosmeticsStore } from '@/store/cosmeticsStore';
import { playSfx } from '@/audio/sfx';
import CoinPreview3D from './CoinPreview3D';

const TABS: { kind: CosmeticKind; label: string }[] = [
  { kind: 'playmat', label: 'Playmats' },
  { kind: 'sleeve', label: 'Sleeves' },
  { kind: 'coin', label: 'Coins' },
];

/** Section 12 + Commit 50.4 - the playmat preview is now the big, dominant
 *  tile: real cover-fit art for every skin except 'faction' (which keeps the
 *  original dynamic per-faction gradient, since it has no single "look" -
 *  that IS its look). ~65% taller than the Commit 50 size. */
function PlaymatPreview({ image, edge }: { image: string | null; edge: string | null }) {
  return (
    <div
      className="w-full h-32 rounded-md border bg-cover bg-center"
      style={{
        backgroundImage: image
          ? `url(${image})`
          : 'radial-gradient(ellipse at 50% 100%, rgba(255,47,208,0.14), #05050a 70%)',
        borderColor: edge ? `${edge}66` : 'rgba(255,255,255,0.15)',
        boxShadow: edge ? `inset 0 0 12px ${edge}22` : undefined,
      }}
    />
  );
}

/** Commit 50.4 - real full-back-replacement sleeve art (image is null only
 *  for 'None'), shown at a slight 3D tilt via a CSS perspective + rotateY -
 *  a card propped up rather than lying flat, with a matching drop shadow to
 *  sell the depth. Bigger than the Commit 50 sleeve tiles (w-11 -> w-20). */
function SleevePreview({ image, rim }: { image: string | null; rim: string }) {
  return (
    <div className="py-1 flex items-center justify-center" style={{ perspective: '420px' }}>
      <div
        className="w-20 h-[112px] rounded-[5px] overflow-hidden border"
        style={{
          borderColor: rim,
          transform: 'rotateY(-16deg) rotateX(3deg)',
          boxShadow: '10px 14px 22px rgba(0,0,0,0.55)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image ?? SLEEVE_BASE_SRC} alt="" className="w-full h-full object-cover" draggable={false} />
      </div>
    </div>
  );
}

export default function LockerMenu() {
  const [tab, setTab] = useState<CosmeticKind>('playmat');
  const [seat, setSeat] = useState<PlayerId>('player1');
  const loadout = useCosmeticsStore((s) => s.loadouts[seat]);
  const setItem = useCosmeticsStore((s) => s.setItem);

  const selectedId = loadout[tab];

  // Typed per-tab: (preview, name, blurb) rows - avoids union-narrowing
  // gymnastics across three structurally different skin shapes.
  const rows: { id: string; name: string; blurb: string; preview: React.ReactNode }[] =
    tab === 'playmat'
      ? PLAYMATS.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb, preview: <PlaymatPreview image={p.image} edge={p.edge} /> }))
      : tab === 'sleeve'
      ? SLEEVES.map((s) => ({ id: s.id, name: s.name, blurb: s.blurb, preview: <SleevePreview image={s.image} rim={s.rim} /> }))
      : COINS.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb, preview: <CoinPreview3D frontSrc={c.frontImage ?? undefined} size={104} /> }));

  return (
    <div>
      {/* Seat switcher: one segmented industrial toggle. */}
      <div className="flex rounded-md border border-white/15 bg-black overflow-hidden mb-4 shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)]">
        {(['player1', 'player2'] as PlayerId[]).map((p, i) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              playSfx('ui.click');
              setSeat(p);
            }}
            onMouseEnter={() => playSfx('ui.hover')}
            aria-pressed={seat === p}
            className={`flex-1 py-2 text-[10px] font-bold tracking-widest transition-all ${i === 0 ? 'border-r border-white/10' : ''} ${
              seat === p
                ? 'bg-fuchsia-400/15 text-fuchsia-200 shadow-[inset_0_2px_0_rgba(255,47,208,0.8)]'
                : 'text-white/35 hover:text-white/60 hover:bg-white/5'
            }`}
          >
            {p === 'player1' ? 'PLAYER 1 (YOU)' : 'PLAYER 2 (HOTSEAT)'}
          </button>
        ))}
      </div>

      {/* Category tabs: shallow grunge plates, illuminated top edge = active. */}
      <div className="flex gap-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => {
              playSfx('ui.click');
              setTab(t.kind);
            }}
            onMouseEnter={() => playSfx('ui.hover')}
            aria-pressed={tab === t.kind}
            className={`panel-3d relative flex-1 py-2 rounded-sm text-[10px] font-bold tracking-widest border transition-all ${
              tab === t.kind ? 'border-cyan-400/50 text-cyan-200' : 'border-white/10 text-white/35 hover:text-white/60 hover:border-white/25'
            }`}
          >
            {tab === t.kind && (
              <span
                aria-hidden
                className="absolute top-0 left-2 right-2 h-[2px] rounded-b-sm"
                style={{ background: '#22d3ee', boxShadow: '0 0 8px rgba(34,211,238,0.9)' }}
              />
            )}
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Cosmetic tiles: textured grunge card surface, EQUIPPED badge,
          responsive 2-col -> 1-col collapse. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[420px] overflow-y-auto pr-1">
        {rows.map((item) => {
          const active = selectedId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                playSfx('ui.confirm');
                setItem(seat, tab, item.id);
              }}
              onMouseEnter={() => playSfx('ui.hover')}
              aria-pressed={active}
              className={`panel-3d relative text-left rounded-lg border-2 p-2.5 transition-all ${
                active ? 'border-fuchsia-400/80 shadow-[0_0_14px_rgba(255,47,208,0.35)]' : 'border-white/10 hover:border-white/30'
              }`}
            >
              {active && (
                <span className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-fuchsia-500/90 text-black text-[8px] font-black tracking-wider shadow-[0_0_8px_rgba(255,47,208,0.7)]">
                  ✓ EQUIPPED
                </span>
              )}
              {item.preview}
              <div className="mt-2 text-[12px] font-bold" style={{ color: active ? '#ffd6f7' : 'rgba(255,255,255,0.8)' }}>
                {item.name}
              </div>
              <div className="text-[10px] text-white/40 leading-snug mt-0.5">{item.blurb}</div>
            </button>
          );
        })}
      </div>

      <p className="text-center text-white/35 text-[10px] leading-relaxed mt-3">
        Gear is per-seat and saved on this device. Player 2&apos;s gear shows in hotseat games; the AI keeps Player 2&apos;s look in solo games.
      </p>
    </div>
  );
}
