'use client';

import { useEffect, useState } from 'react';
import { useAnimationStore, type VisualEvent } from '@/store/animationStore';
import { getCardDef } from '@/data/cards';
import { factionTheme } from '@/lib/theme';

/**
 * Commit 54 (reworked 54.1 per direct spec) - Apex summon splash. When an
 * APEX hits the board, that character's full splash art GLITCHES IN on the
 * summoning player's screen edge - player1 always LEFT, player2 always RIGHT
 * - holds for ~2 seconds like the character is announcing themselves, then
 * fades out slowly. ~3.5s total (0.3s glitch materialization, 2s hold, 1.2s
 * fade).
 *
 * LATEST-WINS PER SIDE: if a second Apex is played while a splash is still
 * live on that side, there is no queue and no crossfade - a HARD CUT: the new
 * character seizes the lane instantly (the replacement IS a glitch event).
 * Sides are independent: a player2 play never cuts player1's splash, so
 * back-to-back plays put both characters facing off across the screen.
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

/** Per-side state: at most ONE live splash per lane (latest-wins hard cut). */
type Lanes = { left: ActiveSplash | null; right: ActiveSplash | null };

export default function ApexSplash() {
  const [lanes, setLanes] = useState<Lanes>({ left: null, right: null });
  const [failedArt] = useState(() => new Set<string>());

  // Imperative store subscription (exactly the VfxCanvas pattern): new events
  // are diffed by id inside the subscription callback, so state updates are
  // event-driven rather than render-effect-driven. Self-expire timers give
  // each splash its own 1150ms window (in + hold + out) independent of the
  // source event's lifetime.
  useEffect(() => {
    const seen = new Set<string>();
    // one expiry timer per lane - replacing a splash cancels the old timer,
    // which is what makes the hard cut clean instead of the old splash's
    // timer killing the new one mid-hold
    const laneTimers: { left?: ReturnType<typeof setTimeout>; right?: ReturnType<typeof setTimeout> } = {};
    const SPLASH_TOTAL_MS = 3500; // 300 glitch-in + 2000 hold + 1200 fade

    function handle(e: VisualEvent) {
      if (e.type !== 'CARD_PLACED' || !e.cardDefId || !e.playerId) return;
      if (seen.has(e.id)) return;
      seen.add(e.id);
      const def = safeDef(e);
      if (!def || def.type !== 'Apex') return;
      if (failedArt.has(def.id)) return;
      const side: 'left' | 'right' = e.playerId === 'player1' ? 'left' : 'right';
      const splash: ActiveSplash = { id: e.id, defId: def.id, side, faction: e.faction ?? def.faction };
      clearTimeout(laneTimers[side]);
      setLanes((prev) => ({ ...prev, [side]: splash })); // hard cut: keyed remount restarts the glitch
      laneTimers[side] = setTimeout(() => {
        setLanes((prev) => (prev[side]?.id === splash.id ? { ...prev, [side]: null } : prev));
      }, SPLASH_TOTAL_MS);
    }

    // Commit 54.1 - on mount, still-fresh placements SPLASH rather than being
    // pre-seeded as seen. GameBoard (and therefore this component) mounts only
    // when the match reaches 'playing' - the opening-Apex placements fire
    // moments earlier, on the selection screen. Processing fresh events here
    // is what makes both openers glitch in facing each other the instant the
    // board appears; anything older than a splash's own glitch window is
    // marked seen and skipped.
    const FRESH_MS = 1200;
    const now = Date.now();
    for (const e of useAnimationStore.getState().events) {
      if (e.type === 'CARD_PLACED' && now - e.createdAt < FRESH_MS) handle(e);
      else seen.add(e.id);
    }

    const unsub = useAnimationStore.subscribe((s) => {
      for (const e of s.events) handle(e);
      if (seen.size > 200) {
        const live = new Set(s.events.map((e) => e.id));
        for (const id of seen) if (!live.has(id)) seen.delete(id);
      }
    });
    return () => {
      unsub();
      clearTimeout(laneTimers.left);
      clearTimeout(laneTimers.right);
    };
  }, [failedArt]);

  const active = [lanes.left, lanes.right].filter((x): x is ActiveSplash => !!x);
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
                setLanes((prev) => ({
                  left: prev.left?.id === s.id ? null : prev.left,
                  right: prev.right?.id === s.id ? null : prev.right,
                }));
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
