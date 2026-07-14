'use client';

import { useState } from 'react';
import Card from '@/components/Card';
import { createInstance } from '@/data/decks';
import { useTutorialStore } from '@/store/tutorialStore';

/**
 * Commit 31 - "Learn the Essentials," shown before the tutorial match board
 * exists at all. Nine slides, each a large card example plus plain-language
 * explanation of one piece of the game, ending in a hand-off into the real
 * guided match ("Now that you know the essentials, let's get into
 * gameplay."). Continue-driven, same as the old fully-scripted tutorial's
 * navigation - this part of the experience genuinely is explanation, not
 * gameplay, so a Continue button is the right fit here specifically (per
 * spec: Continue buttons belong on explanation/slideshow steps only, never
 * on real gameplay actions - see TutorialSteps.ts's guided steps for those).
 */

interface Slide {
  title: string;
  text: string;
  cardDefId?: string;
  cardType?: 'Apex' | 'AbilitySupport' | 'BatterySupport' | 'Equip' | 'Special' | 'Reaction';
  statsNote?: string;
}

const SLIDES: Slide[] = [
  {
    title: 'Apex',
    text: 'This is an Apex. Apexes are your fighters. They battle on the board, attack enemy Apexes, and deal damage to your opponent\u2019s O2.',
    cardDefId: 'nu-street-beast',
    cardType: 'Apex',
  },
  {
    title: 'Engine',
    text: 'This is an Engine. Engines provide Sync, which lets your Apex unleash stronger attacks.',
    cardDefId: 'nu-dead-battery',
    cardType: 'BatterySupport',
  },
  {
    title: 'Battery Engine',
    text: 'Battery Engines provide +1 Sync while they\u2019re on your board.',
    cardDefId: 'nu-dead-battery',
    cardType: 'BatterySupport',
  },
  {
    title: 'Ability Engine',
    text: 'Ability Engines also provide +1 Sync, but they can be chained to an Apex to give that Apex an extra perk.',
    cardDefId: 'nu-juice-box',
    cardType: 'AbilitySupport',
  },
  {
    title: 'Equip',
    text: 'This is an Equip. Equips attach to Apexes and strengthen them by boosting attack, defense, or giving extra protection.',
    cardDefId: 'nu-smog-jacket',
    cardType: 'Equip',
  },
  {
    title: 'Special',
    text: 'This is a Special. Specials create powerful one-time effects, like drawing cards, gaining benefits, or setting up big plays.',
    cardDefId: 'nu-overclock',
    cardType: 'Special',
  },
  {
    title: 'React',
    text: 'This is a React. Reacts are played in response to enemy attacks or enemy plays. Some Reacts can Negate attacks or cancel effects.',
    cardDefId: 'nu-glitch-step',
    cardType: 'Reaction',
  },
  {
    title: 'O2, Momentum & Rift Space',
    text: 'Both players start with 12 O2. Reduce your opponent\u2019s O2 to 0 to win. Momentum fuels powerful cards like Reacts. Rift Space changes the battle depending on the matchup.',
    statsNote: 'O2 12 \u00b7 MOM 0 \u00b7 RIFT SPACE',
  },
  {
    title: 'Ready?',
    text: 'Now that you know the essentials, let\u2019s get into gameplay.',
  },
];

export default function TutorialSlideshow({ onComplete }: { onComplete: () => void }) {
  const slideIndex = useTutorialStore((s) => s.slideIndex);
  const setSlideIndex = useTutorialStore((s) => s.setSlideIndex);
  const [cardCache] = useState(() => new Map<string, ReturnType<typeof createInstance>>());

  const slide = SLIDES[slideIndex];
  const isLast = slideIndex === SLIDES.length - 1;

  function getCardInstance(defId: string, type: NonNullable<Slide['cardType']>) {
    if (!cardCache.has(defId)) cardCache.set(defId, createInstance(defId, type));
    return cardCache.get(defId)!;
  }

  function next() {
    if (isLast) {
      onComplete();
    } else {
      setSlideIndex(slideIndex + 1);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 bg-[#05050a] p-6">
      <div className="text-[10px] uppercase tracking-widest text-white/30">
        Learn the Essentials &middot; {slideIndex + 1} / {SLIDES.length}
      </div>

      {slide.cardDefId && slide.cardType && (
        <div className="drop-shadow-[0_20px_60px_rgba(0,0,0,0.7)]">
          <Card instance={getCardInstance(slide.cardDefId, slide.cardType)} size="xl" disableHoverPreview />
        </div>
      )}

      {slide.statsNote && (
        <div className="flex items-center gap-4 px-6 py-4 rounded-lg border border-white/15 bg-white/5 text-sm font-mono text-white/80 tracking-widest">
          {slide.statsNote}
        </div>
      )}

      <div className="max-w-md text-center flex flex-col gap-2">
        <div className="text-lg font-bold text-white">{slide.title}</div>
        <div className="text-sm text-white/70 leading-relaxed">{slide.text}</div>
      </div>

      <button
        type="button"
        onClick={next}
        className="px-5 py-2 rounded-lg bg-emerald-400 text-black font-bold text-sm hover:bg-emerald-300 transition-colors"
      >
        {isLast ? 'Start Tutorial Match' : 'Continue'}
      </button>

      <div className="flex gap-1.5 mt-2">
        {SLIDES.map((_, i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full ${i === slideIndex ? 'bg-emerald-400' : 'bg-white/20'}`} />
        ))}
      </div>
    </div>
  );
}
