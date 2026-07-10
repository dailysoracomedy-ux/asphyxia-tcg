import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

/**
 * Transient, UI-only visual events - deliberately a SEPARATE store from the main
 * game state (gameStore.ts). Combat resolves fully synchronously and instantly in
 * the game store; this store exists purely so components can react to "something
 * just happened" for a brief CSS animation, without that visual bookkeeping ever
 * touching game state, save/undo, simulations, or the AI. Events self-expire via
 * setTimeout and remove themselves - nothing here can leak or accumulate.
 */

export type VisualEventType =
  | 'ATTACK_DECLARED'
  | 'CARD_HIT'
  | 'O2_DAMAGE'
  | 'CARD_DESTROYED'
  | 'OVERFLOW_DAMAGE'
  | 'REACT_PLAYED'
  | 'CARD_NEGATED'
  | 'MOMENTUM_GAINED'
  | 'CARD_PLACED';

export interface VisualEvent {
  id: string;
  type: VisualEventType;
  /** Apex instance id this event is about, if it targets a specific card. */
  apexInstanceId?: string;
  /** Player id this event is about, if it targets a player's O2/Momentum area
   *  rather than a specific card (direct O2 damage, Momentum gain). */
  playerId?: string;
  /** For damage popups - the number to show ("-450", "-200 O2", etc). Pre-formatted
   *  by the emitter so this store stays pure UI plumbing with zero game-rule
   *  knowledge (it never computes a number, only displays one it's handed). */
  label?: string;
  faction?: string;
  createdAt: number;
  /** The card's definition id, so a consumer (the action banner) can look up its
   *  art/name without needing a live CardInstance - useful for React/Negate events
   *  in particular, where the card has already left the board/hand by the time
   *  this fires. */
  cardDefId?: string;
  /** CARD_DESTROYED only: a plain snapshot of the card as it looked the instant
   *  before it left the board, plus which owner/slot it came from. Game state
   *  removes a destroyed Apex from its slot in the same synchronous update that
   *  fires this event - without this snapshot, the slot would already read empty
   *  by the time React renders, and the destroy animation would never be visible
   *  at all (confirmed - this was the actual bug behind "I don't see any card
   *  animations"). The board renders this ghost in the vacated slot for exactly as
   *  long as this event stays alive, then the slot reverts to genuinely empty. */
  destroyedGhost?: { instance: import('@/types/game').CardInstance; ownerId: string; slotIndex: number };
}

interface AnimationStoreState {
  events: VisualEvent[];
  enqueue: (event: Omit<VisualEvent, 'id' | 'createdAt'>, durationMs?: number) => void;
}

let counter = 0;

export const useAnimationStore = create<AnimationStoreState>((set) => ({
  events: [],
  enqueue: (event, durationMs = 700) => {
    const id = `vfx-${Date.now()}-${counter++}`;
    const full: VisualEvent = { ...event, id, createdAt: Date.now() };
    set((s) => ({ events: [...s.events, full] }));
    setTimeout(() => {
      set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
    }, durationMs);
  },
}));

/** Convenience read hook - all currently-active events for a specific Apex.
 *  Wrapped in useShallow: without it, the inline .filter() below returns a brand
 *  new array reference on every single call, which React's useSyncExternalStore
 *  (what Zustand v5 uses internally) explicitly warns about and can escalate into
 *  an actual "Maximum update depth exceeded" crash - this is what was actually
 *  happening, confirmed by reproducing it, not assumed. useShallow keeps the same
 *  array reference whenever the filtered contents haven't actually changed. */
export function useApexVisualEvents(apexInstanceId: string): VisualEvent[] {
  return useAnimationStore(useShallow((s) => s.events.filter((e) => e.apexInstanceId === apexInstanceId)));
}

/** Convenience read hook - all currently-active events for a specific player's O2/Momentum area. */
export function usePlayerVisualEvents(playerId: string): VisualEvent[] {
  return useAnimationStore(useShallow((s) => s.events.filter((e) => e.playerId === playerId && !e.apexInstanceId)));
}

/** Convenience read hook - the destroy-ghost (if any) currently occupying a
 *  specific board slot, so a vacated Apex slot can keep showing the destroyed
 *  card mid-animation instead of instantly reverting to "empty." */
export function useSlotGhost(ownerId: string, slotIndex: number) {
  return useAnimationStore(
    useShallow((s) =>
      s.events.find(
        (e) => e.type === 'CARD_DESTROYED' && e.destroyedGhost?.ownerId === ownerId && e.destroyedGhost?.slotIndex === slotIndex
      )
    )
  );
}
