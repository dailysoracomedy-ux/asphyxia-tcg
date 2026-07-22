'use client';

import { useEffect, useState } from 'react';
import { useAnimationStore, type VisualEvent } from '@/store/animationStore';
import { getCardDef } from '@/data/cards';
import { factionTheme } from '@/lib/theme';

/**
 * Commit 54 - fighting-game style summon splash. When an APEX hits the board,
 * that character's full splash art sweeps in on the summoning player's screen
 * edge - player1 from the LEFT, player2 from the RIGHT - holds a beat behind a
 * faction-colored glow + scanline wipe, and sweeps back out. ~1.15s total, so
 * it punctuates the play without slowing the game down.
 *
 * Art contract: /splash/{cardDefId}.png (source of truth: static2/splash/,
 * synced by scripts/sync-static.mjs like all Commit 47.2 assets). Transparent
 * background, tall portrait crop (~5:8, e.g. 1000x1600). MISSING ART IS FINE:
 * the <img> onError simply cancels that splash, so art can land one card at a
 * time - the system was shipped before any of the 12 PNGs existed.
 *
 * Reads the same CARD_PLACED events everything else uses; filters to defs
 * whose type === 'Apex' (supports/equips placed on board never splash). The
 * event's playerId (added to Apex placements this commit) picks the side -
 * ACTUAL seat, not viewer orientation, so in hotseat P1 is always the left
 * splash and P2 always the right, a stable identity players learn.
 *
 * Never mounted in headless/e2e runs (GameBoard gates it the same way as the
 * other pure-chrome layers), and reduced-motion collapses the sweep to a
 * simple fade via the CSS class pair.
 */

interface ActiveSplash {
  id: string;
  defId: string;
  side: 'left' | 'right';
  faction: string;
}

export default function ApexSplash() {
  const [active, setActive] = useState<ActiveSplash[]>([]);
  const [failedArt] = useState(() => new Set<string>());

  // Imperative store subscription (exactly the VfxCanvas pattern): new events
  // are diffed by id inside the subscription callback, so state updates are
  // event-driven rather than render-effect-driven. Self-expire timers give
  // each splash its own 1150ms window (in + hold + out) independent of the
  // source event's lifetime.
  useEffect(() => {
    const seen = new Set<string>(useAnimationStore.getState().events.map((e) => e.id));
    const timers: ReturnType<typeof setTimeout>[] = [];
    const unsub = useAnimationStore.subscribe((s) => {
      for (const e of s.events) {
        if (e.type !== 'CARD_PLACED' || !e.cardDefId || !e.playerId) continue;
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        const def = safeDef(e);
        if (!def || def.type !== 'Apex') continue;
        if (failedArt.has(def.id)) continue;
        const splash: ActiveSplash = {
          id: e.id,
          defId: def.id,
          side: e.playerId === 'player1' ? 'left' : 'right',
          faction: e.faction ?? def.faction,
        };
        setActive((prev) => [...prev, splash]);
        timers.push(setTimeout(() => setActive((prev) => prev.filter((a) => a.id !== splash.id)), 1150));
      }
      if (seen.size > 200) {
        const live = new Set(s.events.map((e) => e.id));
        for (const id of seen) if (!live.has(id)) seen.delete(id);
      }
    });
    return () => {
      unsub();
      timers.forEach(clearTimeout);
    };
  }, [failedArt]);

  if (active.length === 0) return null;

  return (
    <>
      {active.map((s) => {
        const theme = factionTheme(s.faction as Parameters<typeof factionTheme>[0]);
        return (
          <div
            key={s.id}
            aria-hidden
            className={`vfx-splash-lane ${s.side === 'left' ? 'vfx-splash-left' : 'vfx-splash-right'}`}
            style={{ ['--splash-glow' as string]: theme.primary }}
          >
            <div className="vfx-splash-glow" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/splash/${s.defId}.png`}
              alt=""
              className="vfx-splash-art"
              draggable={false}
              onError={() => {
                // No art for this card yet - remember and never retry, and
                // kill this splash immediately (glow with no character in it
                // would read as a bug, not a feature).
                failedArt.add(s.defId);
                setActive((prev) => prev.filter((a) => a.id !== s.id));
              }}
            />
            <div className="vfx-splash-scanwipe" />
          </div>
        );
      })}
    </>
  );
}

function safeDef(e: VisualEvent) {
  try {
    return getCardDef(e.cardDefId!);
  } catch {
    return null;
  }
}
