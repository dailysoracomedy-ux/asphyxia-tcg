/**
 * Commit 42 - per-seat cosmetic loadouts (playmat / sleeve / deck box / coin),
 * persisted to localStorage so your gear survives reloads. Seat-keyed rather
 * than account-keyed on purpose: player1 is always "you" in solo play, and in
 * hotseat both seats can dress their own side from the Locker.
 *
 * Deliberately separate from gameStore - cosmetics are pure presentation and
 * must never touch match state, saves, or the simulator (which imports
 * gameStore in Node, where localStorage doesn't exist; nothing in /scripts
 * imports this file).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlayerId } from '@/types/game';
import type { CosmeticKind } from '@/lib/cosmetics';

export interface Loadout {
  playmat: string;
  sleeve: string;
  coin: string;
}

// Commit 45 - deckbox removed from the loadout (the concept is scrapped; the
// deck is a full-bleed sleeved stack now). A stale 'deckbox' key in persisted
// localStorage data is harmless: merge() spreads it into the object where
// nothing reads it.
const DEFAULT_LOADOUT: Loadout = {
  playmat: 'faction',
  sleeve: 'asphyxia',
  coin: 'rift-standard',
};

interface CosmeticsStore {
  loadouts: Record<PlayerId, Loadout>;
  setItem: (seat: PlayerId, kind: CosmeticKind, id: string) => void;
}

export const useCosmeticsStore = create<CosmeticsStore>()(
  persist(
    (set) => ({
      loadouts: {
        player1: { ...DEFAULT_LOADOUT },
        player2: { ...DEFAULT_LOADOUT },
      },
      setItem: (seat, kind, id) =>
        set((s) => ({
          loadouts: {
            ...s.loadouts,
            [seat]: { ...s.loadouts[seat], [kind]: id },
          },
        })),
    }),
    {
      name: 'asphyxia-cosmetics-v1',
      // merge keeps forward-compat: new loadout fields added later fall back
      // to defaults instead of being wiped out by an older stored object.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CosmeticsStore>;
        return {
          ...current,
          loadouts: {
            player1: { ...current.loadouts.player1, ...p.loadouts?.player1 },
            player2: { ...current.loadouts.player2, ...p.loadouts?.player2 },
          },
        };
      },
    }
  )
);

/** Convenience selector - a seat's full loadout with guaranteed defaults. */
export function useLoadout(seat: PlayerId): Loadout {
  return useCosmeticsStore((s) => s.loadouts[seat]);
}
