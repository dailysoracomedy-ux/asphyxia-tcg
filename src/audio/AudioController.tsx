'use client';

import { useEffect, useRef } from 'react';
import { useAnimationStore, type VisualEvent, type VisualEventType } from '@/store/animationStore';
import { getCardDef } from '@/data/cards';
import { playSfx, type SfxKey } from './sfx';

/**
 * Bridges game/visual events to sound (Commit 25). Deliberately a silent,
 * render-nothing component rather than touching gameStore.ts or rules.ts at all -
 * it just watches the same animationStore events ActionBanner already watches, and
 * plays the matching SFX the instant a new one appears. This keeps every store
 * that simulate.ts and the test suite import completely audio-free; Node never
 * mounts this component, so headless runs are structurally unaffected.
 */
function sfxForEvent(e: VisualEvent): SfxKey | null {
  switch (e.type) {
    case 'ATTACK_DECLARED':
      return 'combat.attackDeclare';
    case 'CARD_HIT':
      return 'combat.hit';
    case 'CARD_DESTROYED':
      return 'combat.destroy';
    case 'OVERFLOW_DAMAGE':
      return 'combat.overflow';
    case 'O2_DAMAGE':
      return 'combat.directO2';
    case 'REACT_PLAYED':
      return 'card.reactPlay';
    case 'CARD_NEGATED':
      return 'card.negatePlay';
    case 'CARD_PLACED': {
      if (!e.cardDefId) return 'card.enginePlay';
      const def = getCardDef(e.cardDefId);
      if (def.type === 'Apex') return 'card.apexPlay';
      if (def.type === 'Equip') return 'card.equipAttach';
      return 'card.enginePlay';
    }
    default:
      return null;
  }
}

const EVENT_TYPES_HANDLED: VisualEventType[] = [
  'ATTACK_DECLARED',
  'CARD_HIT',
  'CARD_DESTROYED',
  'OVERFLOW_DAMAGE',
  'O2_DAMAGE',
  'REACT_PLAYED',
  'CARD_NEGATED',
  'CARD_PLACED',
];

export default function AudioController() {
  const events = useAnimationStore((s) => s.events);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const fresh = events.filter((e) => EVENT_TYPES_HANDLED.includes(e.type) && !seenIds.current.has(e.id));
    for (const e of fresh) {
      seenIds.current.add(e.id);
      const key = sfxForEvent(e);
      if (key) playSfx(key);
      // A React costs Momentum to play - a second, distinct sound layered on top
      // gives that cost its own audible beat without needing a dedicated
      // MOMENTUM_GAINED/SPENT event wired through gameStore.ts and every card
      // effect that touches Momentum (a much larger, riskier change deferred for
      // a future pass - see the README).
      if (e.type === 'REACT_PLAYED' || e.type === 'CARD_NEGATED') {
        playSfx('resource.momentumSpend');
      }
    }
  }, [events]);

  return null;
}
