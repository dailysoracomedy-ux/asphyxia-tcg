'use client';

/**
 * Commit 42 - THE LOCKER: pick your gear. Four tabs (Playmat / Sleeves /
 * Deck Box / Coin), each a grid of live CSS previews built from the same
 * cosmetics registry the game itself renders from - so the preview tile IS
 * the real look, not a screenshot that can drift out of date.
 *
 * Seat switcher at the top: player1 is "you" in solo games; in hotseat,
 * Player 2 can dress their own side too. Selections persist via
 * cosmeticsStore (localStorage).
 */

import { useState } from 'react';
import type { PlayerId } from '@/types/game';
import {
  PLAYMATS,
  SLEEVES,
  DECK_BOXES,
  COINS,
  SLEEVE_BASE_SRC,
  COIN_FRONT_SRC,
  type CosmeticKind,
} from '@/lib/cosmetics';
import { useCosmeticsStore } from '@/store/cosmeticsStore';
import { playSfx } from '@/audio/sfx';

const TABS: { kind: CosmeticKind; label: string }[] = [
  { kind: 'playmat', label: 'Playmats' },
  { kind: 'sleeve', label: 'Sleeves' },
  { kind: 'deckbox', label: 'Deck Boxes' },
  { kind: 'coin', label: 'Coins' },
];

function PlaymatPreview({ background, edge }: { background: string | null; edge: string | null }) {
  return (
    <div
      className="w-full h-16 rounded-md border"
      style={{
        background:
          background ??
          'radial-gradient(ellipse at 50% 100%, rgba(255,47,208,0.14), #05050a 70%)',
        borderColor: edge ? `${edge}66` : 'rgba(255,255,255,0.15)',
        boxShadow: edge ? `inset 0 0 12px ${edge}22` : undefined,
      }}
    />
  );
}

function SleevePreview({ filter, rim }: { filter: string; rim: string }) {
  return (
    <div className="w-11 h-[62px] rounded-[4px] overflow-hidden border mx-auto" style={{ borderColor: rim }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={SLEEVE_BASE_SRC} alt="" className="w-full h-full object-cover" style={{ filter }} draggable={false} />
    </div>
  );
}

function DeckBoxPreview({ body, edge, emblemFilter }: { body: string | null; edge: string; emblemFilter: string }) {
  if (!body) {
    // "No Box" - the classic bare stack.
    return (
      <div className="relative w-12 h-16 mx-auto">
        {[2, 1, 0].map((i) => (
          <div
            key={i}
            className="absolute rounded-[3px] border overflow-hidden"
            style={{ width: 44, height: 60, left: i * 2, top: -i * 2 + 4, borderColor: edge }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SLEEVE_BASE_SRC} alt="" className="w-full h-full object-cover" draggable={false} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      className="relative w-12 h-16 mx-auto rounded-[4px] border flex items-center justify-center"
      style={{ background: body, borderColor: `${edge}88`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), 0 3px 8px rgba(0,0,0,0.5)` }}
    >
      <div className="absolute top-0 left-0 right-0 h-2 rounded-t-[3px]" style={{ background: 'rgba(255,255,255,0.10)', borderBottom: `1px solid ${edge}66` }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={COIN_FRONT_SRC} alt="" className="w-7 h-7 rounded-full opacity-90" style={{ filter: emblemFilter }} draggable={false} />
    </div>
  );
}

function CoinPreview({ filter }: { filter: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={COIN_FRONT_SRC} alt="" className="w-14 h-14 rounded-full mx-auto" style={{ filter }} draggable={false} />
  );
}

export default function LockerMenu() {
  const [tab, setTab] = useState<CosmeticKind>('playmat');
  const [seat, setSeat] = useState<PlayerId>('player1');
  const loadout = useCosmeticsStore((s) => s.loadouts[seat]);
  const setItem = useCosmeticsStore((s) => s.setItem);

  const selectedId = loadout[tab];

  // Typed per-tab: (preview, name, blurb) rows - avoids union-narrowing
  // gymnastics across four structurally different skin shapes.
  const rows: { id: string; name: string; blurb: string; preview: React.ReactNode }[] =
    tab === 'playmat'
      ? PLAYMATS.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb, preview: <PlaymatPreview background={p.background} edge={p.edge} /> }))
      : tab === 'sleeve'
      ? SLEEVES.map((s) => ({ id: s.id, name: s.name, blurb: s.blurb, preview: <SleevePreview filter={s.filter} rim={s.rim} /> }))
      : tab === 'deckbox'
      ? DECK_BOXES.map((d) => ({ id: d.id, name: d.name, blurb: d.blurb, preview: <DeckBoxPreview body={d.body} edge={d.edge} emblemFilter={d.emblemFilter} /> }))
      : COINS.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb, preview: <CoinPreview filter={c.filter} /> }));

  return (
    <div>
      {/* Seat switcher */}
      <div className="flex justify-center gap-2 mb-3">
        {(['player1', 'player2'] as PlayerId[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              playSfx('ui.click');
              setSeat(p);
            }}
            onMouseEnter={() => playSfx('ui.hover')}
            className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-widest border transition-all ${
              seat === p ? 'border-fuchsia-400/70 text-fuchsia-200 bg-fuchsia-400/10' : 'border-white/15 text-white/40 hover:text-white/70'
            }`}
          >
            {p === 'player1' ? 'PLAYER 1 (YOU)' : 'PLAYER 2 (HOTSEAT)'}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => {
              playSfx('ui.click');
              setTab(t.kind);
            }}
            onMouseEnter={() => playSfx('ui.hover')}
            className={`flex-1 py-1.5 rounded-md text-[10px] font-bold tracking-widest border transition-all ${
              tab === t.kind
                ? 'border-cyan-400/60 text-cyan-200 bg-cyan-400/10'
                : 'border-white/10 text-white/35 hover:text-white/60 hover:border-white/25'
            }`}
          >
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-1">
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
              className={`text-left rounded-lg border-2 p-2 transition-all ${
                active
                  ? 'border-fuchsia-400/80 bg-fuchsia-400/10 shadow-[0_0_14px_rgba(255,47,208,0.35)]'
                  : 'border-white/10 hover:border-white/30 bg-black/30'
              }`}
            >
              {item.preview}
              <div className="mt-1.5 text-[11px] font-bold" style={{ color: active ? '#ffd6f7' : 'rgba(255,255,255,0.75)' }}>
                {item.name}
                {active && <span className="ml-1 text-fuchsia-300">✓</span>}
              </div>
              <div className="text-[9px] text-white/35 leading-tight">{item.blurb}</div>
            </button>
          );
        })}
      </div>

      <p className="text-center text-white/25 text-[9px] mt-3">
        Gear is per-seat and saved on this device. Player 2&apos;s gear shows in hotseat games; the AI keeps Player 2&apos;s look in solo games.
      </p>
    </div>
  );
}
