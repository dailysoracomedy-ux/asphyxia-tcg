'use client';

import { useEffect, useRef, useState } from 'react';
import type { GameState } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { getCardArt } from '@/lib/cardArt';
import { factionTheme } from '@/lib/theme';
import { useAnimationStore, CEREMONY_MS, type VisualEvent } from '@/store/animationStore';
import { currentShowcaseMultiplier } from '@/store/showcaseStore';

const BANNER_TYPES: VisualEvent['type'][] = ['CARD_PLACED', 'REACT_PLAYED', 'CARD_NEGATED'];
const FALLBACK_DISPLAY_MS = 900;

interface QueuedBanner {
  id: string;
  type: VisualEvent['type'];
  playerId?: string;
  cardDefId?: string;
  faction?: string;
  logLines: string[];
}

/**
 * The "what just happened" banner (Commit 24) - solves a real point of confusion:
 * a card's own log line can read fine in isolation but get lost among several
 * other lines, especially for React/Negate effects whose outcome (an Apex
 * surviving at reduced DEF, an attack being cancelled) isn't visible anywhere on
 * the board itself. Shows the card's art, name, and the log lines its play
 * actually generated - reusing the real log text rather than a hand-written
 * summary that could drift from what actually happened, since every relevant
 * message is already sitting in state.log by the time this fires (combat and card
 * resolution are fully synchronous - see gameStore.ts).
 *
 * Deliberately reuses the existing CARD_PLACED/REACT_PLAYED/CARD_NEGATED events
 * rather than adding a parallel banner-specific event at every call site - one
 * event, two consumers (the small in-place glow and this banner).
 */
export default function ActionBanner({ state }: { state: GameState }) {
  const [queue, setQueue] = useState<QueuedBanner[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const events = useAnimationStore((s) => s.events);

  useEffect(() => {
    const fresh = events.filter((e) => BANNER_TYPES.includes(e.type) && !seenIds.current.has(e.id));
    if (fresh.length === 0) return;
    for (const e of fresh) seenIds.current.add(e.id);

    setQueue((q) => [
      ...q,
      ...fresh.map((e) => ({
        id: e.id,
        type: e.type,
        playerId: e.playerId,
        cardDefId: e.cardDefId,
        faction: e.faction,
        // Snapshot the tail of the log right now - by the time this effect runs,
        // the synchronous mutation that fired the event (and everything it logged
        // as a result) has already completed.
        logLines: state.log.slice(-4).map((l) => l.message),
      })),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const current = queue[0] ?? null;
  const displayMs = (current ? CEREMONY_MS[current.type] ?? FALLBACK_DISPLAY_MS : FALLBACK_DISPLAY_MS) * currentShowcaseMultiplier();

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), displayMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!current || !current.cardDefId) return null;
  const def = getCardDef(current.cardDefId);
  const art = getCardArt(current.cardDefId);
  const theme = factionTheme(def.faction);

  return (
    <div
      key={current.id}
      className="fixed left-1/2 top-[18%] z-40 pointer-events-none vfx-banner-in"
      style={{ ['--banner-color' as string]: theme.primary, animationDuration: `${displayMs}ms` }}
    >
      <div
        className="panel-3d flex items-center gap-3 rounded-lg border-2 px-4 py-2.5 max-w-md"
        style={{ borderColor: theme.primary, background: '#05050ae8', boxShadow: `0 0 30px ${theme.primary}66` }}
      >
        {art && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art} alt="" className="w-12 h-16 object-cover rounded shrink-0" draggable={false} />
        )}
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: theme.primary }}>
            {def.name}
          </div>
          <div className="text-[11px] text-white/85 leading-snug space-y-0.5 mt-0.5">
            {current.logLines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
