'use client';

import { useEffect, useRef } from 'react';
import { useAnimationStore, type VisualEvent, type VisualEventType } from '@/store/animationStore';
import { useGameStore } from '@/store/gameStore';
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
    case 'CARD_HIT': {
      // Commit 32 - a real hit sound instead of always the same one: the
      // event's own label already carries the actual damage dealt (e.g.
      // "-650"), parsed here rather than guessed at, so "heavy" reflects a
      // real, meaningful hit rather than an arbitrary coin flip.
      const dmg = e.label ? Math.abs(parseInt(e.label, 10)) : 0;
      return dmg >= HEAVY_HIT_THRESHOLD ? 'combat.heavyHit' : 'combat.hit';
    }
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
    case 'MOMENTUM_GAINED':
      return 'resource.momentumGain';
    case 'MOMENTUM_SPENT':
      return 'resource.momentumSpend';
    case 'CARD_DRAWN':
      return 'card.draw';
    case 'EQUIP_SWAPPED':
      return 'card.equipSwap';
    case 'ENGINE_TRIGGER':
      return 'engine.trigger';
    case 'RIFT_TRIGGER':
      return 'rift.trigger';
    case 'CARD_PLACED': {
      if (!e.cardDefId) return 'card.enginePlay';
      const def = getCardDef(e.cardDefId);
      if (def.type === 'Apex') return 'card.apexPlay';
      if (def.type === 'Equip') return 'card.equipAttach';
      if (def.type === 'Special') return 'card.specialPlay';
      return 'card.enginePlay';
    }
    default:
      return null;
  }
}

const HEAVY_HIT_THRESHOLD = 500;

const EVENT_TYPES_HANDLED: VisualEventType[] = [
  'ATTACK_DECLARED',
  'CARD_HIT',
  'CARD_DESTROYED',
  'OVERFLOW_DAMAGE',
  'O2_DAMAGE',
  'REACT_PLAYED',
  'CARD_NEGATED',
  'CARD_PLACED',
  'CARD_DRAWN',
  'EQUIP_SWAPPED',
  'MOMENTUM_GAINED',
  'MOMENTUM_SPENT',
  'ENGINE_TRIGGER',
  'RIFT_TRIGGER',
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
    }
  }, [events]);

  // Commit 32 - resource.o2Loss: watched directly from real game state rather
  // than threading a VFX-emission callback through every O2-loss call site
  // inside the rules engine (loseO2Fn is called from many places - combat
  // resolution, overflow, direct effects). There's exactly one place O2
  // actually changes on either player, so watching it here is the lower-risk
  // way to get a real, meaningful trigger without touching rules.ts at all.
  const p1O2 = useGameStore((s) => s.players.player1.o2);
  const p2O2 = useGameStore((s) => s.players.player2.o2);
  const prevO2 = useRef<{ p1: number; p2: number } | null>(null);
  useEffect(() => {
    if (prevO2.current && (p1O2 < prevO2.current.p1 || p2O2 < prevO2.current.p2)) {
      playSfx('resource.o2Loss');
    }
    prevO2.current = { p1: p1O2, p2: p2O2 };
  }, [p1O2, p2O2]);

  return null;
}
