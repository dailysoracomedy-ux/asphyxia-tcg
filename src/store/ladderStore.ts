/**
 * Commit 55 - Ladder Mode progress. Persisted to localStorage, same pattern
 * as cosmeticsStore/audioStore/vfxSettingsStore (Zustand persist middleware,
 * no-ops safely in Node so scripts/ never breaks).
 *
 * THE SHAPE OF THE MODE (confirmed with Daily before building):
 * - You pick ONE faction as your first ladder, ever (a permanent identity
 *   choice, made once from the lore screen). That faction is immediately
 *   unlocked; its ladder starts at 0 wins against each of the other two.
 * - Matches on a faction's ladder STRICTLY ALTERNATE between its two rivals
 *   (e.g. Neon's ladder goes DW, SA, DW, SA...).
 * - Every win drips a reward - no waiting for a milestone. Losses cost
 *   nothing and don't advance or reset any counter; you just refight the
 *   same rival.
 * - Beating a specific rival 10 times unlocks THAT FACTION as a new,
 *   independent ladder (its own two counters, starting at zero - beating
 *   Dark White on Neon's ladder does NOT give Dark White's own ladder a
 *   head start against Neon). Full completion is 3 ladders x 2 rivals x 10
 *   wins = 60 wins, by design (confirmed, not a bug to "fix" later).
 * - IMPORTANT SCOPE NOTE: "unlock that deck to play with" is scoped to
 *   LADDER MODE's own faction picker only. New Game and Simulated Match
 *   keep letting you pick any of the 3 factions freely, exactly as before -
 *   this does not lock the base game for existing saves/testing. If you'd
 *   rather the lock applied everywhere, say so and it's a small follow-up.
 *
 * REWARD TABLE (tunable - see REWARD_PATTERN below): each win is assigned a
 * reward by its position (1-10) within that specific rival counter. Cosmetic
 * wins pull the next NOT-YET-OWNED playmat/sleeve/coin (cycling kind order);
 * once every cosmetic is owned, cosmetic slots fall back to a Pack instead
 * (no dead rewards). Win #10 always additionally carries the faction-unlock
 * moment itself, which is the real prize.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Faction } from '@/types/game';
import { PLAYMATS, SLEEVES, COINS, type CosmeticKind } from '@/lib/cosmetics';

export const ALL_FACTIONS: Faction[] = ['Neon Underground', 'Dark White', 'Synth Ascendancy'];
export const WINS_TO_UNLOCK = 10;
/** Ladder matches skip the coin-flip ceremony and always run at this O2 - a
 *  grind mode should stay fast to repeat. Tune freely. */
export const LADDER_O2 = 24;

export function rivalsOf(home: Faction): [Faction, Faction] {
  const rivals = ALL_FACTIONS.filter((f) => f !== home);
  return [rivals[0], rivals[1]];
}

/** Win-index (1-10) -> reward TYPE. 3 and 3 and 3 cosmetics, 3 packs at a
 *  steady clip, win 10 is always the big one (handled separately in
 *  recordWin - it always also carries the faction unlock). */
const REWARD_PATTERN: Array<'cosmetic' | 'pack'> = [
  'cosmetic', 'cosmetic', 'pack',
  'cosmetic', 'cosmetic', 'pack',
  'cosmetic', 'cosmetic', 'pack',
  'pack', // win 10 - always a celebratory pack, on top of the faction unlock
];

export type RewardEvent =
  | { kind: 'pack' }
  | { kind: 'cosmetic'; cosmeticKind: CosmeticKind; id: string; name: string; image: string | null }
  | { kind: 'none' }; // cosmetic pool exhausted and pattern said cosmetic - shouldn't happen (falls back to pack) but typed for safety

export interface FactionLadder {
  /** Wins recorded against each rival on THIS faction's ladder. Only the two
   *  non-home factions are ever populated; reading the home faction's own
   *  key is meaningless and never done. */
  wins: Record<Faction, number>;
}

interface LadderStore {
  /** Which factions can be chosen as a ladder home. Empty until the player's
   *  first-ever pick; grows as rivals get unlocked. */
  unlockedFactions: Faction[];
  /** One entry per unlocked faction - that faction's own ladder. */
  ladders: Partial<Record<Faction, FactionLadder>>;
  /** Ids of cosmetics earned through the ladder, per kind. The Locker treats
   *  the 3 sentinel defaults ('faction' / 'none' / 'rift-standard') as
   *  always-owned regardless of this list - see cosmetics.ts DEFAULT_IDS. */
  ownedCosmetics: Record<CosmeticKind, string[]>;
  /** Rotates which cosmetic KIND a cosmetic-reward starts searching from, so
   *  unlocks feel varied (playmat/sleeve/coin/playmat/...) instead of
   *  clearing one whole category before touching the next. */
  cosmeticCycle: number;

  /** True once any ladder has been started - drives the lore screen showing
   *  the one-time "choose your path" framing vs. the returning ladder-select
   *  framing. */
  hasChosenFirstFaction: () => boolean;
  /** Bootstrap: the player's first-ever faction pick. No-ops if a faction
   *  has already been chosen (permanent choice, by design). */
  chooseFirstFaction: (faction: Faction) => void;
  /** Record a win for `home`'s ladder against `rival`. Returns the reward to
   *  show, and whether this win unlocked `rival` as a new playable faction.
   *  No-ops (returns 'none' / false) if home's ladder isn't unlocked or the
   *  rival counter is already at WINS_TO_UNLOCK (shouldn't happen via normal
   *  UI flow, guarded defensively anyway). */
  recordWin: (home: Faction, rival: Faction) => { reward: RewardEvent; unlockedFaction: boolean };
  /** Whichever rival comes next in the strict-alternation sequence for this
   *  ladder, based on total matches already played (wins only - see note in
   *  LadderScreen about losses not advancing the sequence). */
  nextRival: (home: Faction) => Faction;
}

function ownedSet(owned: Record<CosmeticKind, string[]>, kind: CosmeticKind): Set<string> {
  return new Set(owned[kind]);
}

/** Next not-yet-owned cosmetic across playmat -> sleeve -> coin -> repeat,
 *  cycling the START kind each call so unlocks feel varied rather than
 *  clearing one whole category before touching the next. */
function pickNextCosmetic(owned: Record<CosmeticKind, string[]>, cycleIdx: number): RewardEvent {
  const pools: Record<CosmeticKind, { id: string; name: string; image: string | null }[]> = {
    playmat: PLAYMATS.filter((p) => p.id !== 'faction').map((p) => ({ id: p.id, name: p.name, image: p.image })),
    sleeve: SLEEVES.filter((s) => s.id !== 'none').map((s) => ({ id: s.id, name: s.name, image: s.image })),
    coin: COINS.filter((c) => c.id !== 'rift-standard').map((c) => ({ id: c.id, name: c.name, image: c.frontImage })),
  };
  const order: CosmeticKind[] = ['playmat', 'sleeve', 'coin'];
  const start = cycleIdx % 3;
  for (let i = 0; i < 3; i++) {
    const kind = order[(start + i) % 3];
    const have = ownedSet(owned, kind);
    const next = pools[kind].find((item) => !have.has(item.id));
    if (next) return { kind: 'cosmetic', cosmeticKind: kind, id: next.id, name: next.name, image: next.image };
  }
  return { kind: 'pack' }; // every cosmetic owned - fall back rather than reward nothing
}

export const useLadderStore = create<LadderStore>()(
  persist(
    (set, get) => ({
      unlockedFactions: [],
      ladders: {},
      ownedCosmetics: { playmat: [], sleeve: [], coin: [] },
      cosmeticCycle: 0,

      hasChosenFirstFaction: () => get().unlockedFactions.length > 0,

      chooseFirstFaction: (faction) =>
        set((s) => {
          if (s.unlockedFactions.length > 0) return s; // permanent, one-time choice
          const [r1, r2] = rivalsOf(faction);
          return {
            unlockedFactions: [faction],
            ladders: { ...s.ladders, [faction]: { wins: { [r1]: 0, [r2]: 0 } as Record<Faction, number> } },
          };
        }),

      nextRival: (home) => {
        const ladder = get().ladders[home];
        const [r1, r2] = rivalsOf(home);
        if (!ladder) return r1;
        // total wins so far decides parity; strict alternation means the
        // NEXT match is r1 if the combined win count is even, else r2 -
        // matches the fixed DW,SA,DW,SA... sequence regardless of which
        // counter each individual win landed on.
        const total = ladder.wins[r1] + ladder.wins[r2];
        return total % 2 === 0 ? r1 : r2;
      },

      recordWin: (home, rival) => {
        let reward: RewardEvent = { kind: 'none' };
        let unlockedFaction = false;
        set((s) => {
          const ladder = s.ladders[home];
          if (!ladder) return s; // ladder not started - defensive no-op
          const current = ladder.wins[rival] ?? 0;
          if (current >= WINS_TO_UNLOCK) return s; // already maxed - defensive no-op
          const winIndex = current + 1; // 1-10
          const rewardType = REWARD_PATTERN[winIndex - 1];

          const cosmeticCycle = s.cosmeticCycle ?? 0;
          reward =
            rewardType === 'pack'
              ? { kind: 'pack' }
              : pickNextCosmetic(s.ownedCosmetics, cosmeticCycle);

          const nextOwned = { ...s.ownedCosmetics };
          if (reward.kind === 'cosmetic') {
            nextOwned[reward.cosmeticKind] = [...nextOwned[reward.cosmeticKind], reward.id];
          }

          const nextWins: Record<Faction, number> = { ...ladder.wins, [rival]: winIndex };
          const nextLadders = { ...s.ladders, [home]: { wins: nextWins } };
          let nextUnlocked = s.unlockedFactions;

          if (winIndex >= WINS_TO_UNLOCK && !s.unlockedFactions.includes(rival)) {
            unlockedFaction = true;
            nextUnlocked = [...s.unlockedFactions, rival];
            const [rr1, rr2] = rivalsOf(rival);
            (nextLadders as Record<Faction, FactionLadder>)[rival] = { wins: { [rr1]: 0, [rr2]: 0 } as Record<Faction, number> };
          }

          return {
            ladders: nextLadders,
            unlockedFactions: nextUnlocked,
            ownedCosmetics: nextOwned,
            cosmeticCycle: cosmeticCycle + (reward.kind === 'cosmetic' ? 1 : 0),
          } as Partial<LadderStore>;
        });
        return { reward, unlockedFaction };
      },
    }),
    {
      name: 'asphyxia-ladder-v1',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LadderStore>;
        return {
          ...current,
          unlockedFactions: p.unlockedFactions ?? current.unlockedFactions,
          ladders: p.ladders ?? current.ladders,
          ownedCosmetics: {
            playmat: p.ownedCosmetics?.playmat ?? [],
            sleeve: p.ownedCosmetics?.sleeve ?? [],
            coin: p.ownedCosmetics?.coin ?? [],
          },
          cosmeticCycle: p.cosmeticCycle ?? 0,
        };
      },
    }
  )
);

/** Locker helper: is this cosmetic usable? True for the 3 always-free
 *  sentinel defaults, or anything present in ladderStore.ownedCosmetics. */
export function isCosmeticOwned(kind: CosmeticKind, id: string): boolean {
  if (id === 'faction' || id === 'none' || id === 'rift-standard') return true;
  return useLadderStore.getState().ownedCosmetics[kind].includes(id);
}
