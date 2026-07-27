'use client';

/**
 * Commit 56 - the per-faction welcome splash. Plays FACTION_SPLASH_BEATS
 * for the given faction, then holds on a "Continue" prompt. Visual pacing
 * differs by faction (SPLASH_VARIANT), matching the voice each faction
 * speaks in: Neon cuts fast with a flicker on its ALL-CAPS emphasis, Dark
 * White holds long and slow (especially before its threat line), Synth
 * renders cold and clinical, like a terminal readout more than dialogue.
 *
 * Shown once per faction, ever - on the very first time a player enters
 * that faction's ladder, whether that's their original pick from LoreIntro
 * or a faction they just unlocked (ladderStore.splashSeen decides which;
 * this component itself doesn't know or care which case it is).
 */

import { useState } from 'react';
import type { Faction } from '@/types/game';
import CinematicBeat from './CinematicBeat';
import { FACTION_SPLASH_BEATS, SPLASH_VARIANT } from '@/lib/loreContent';
import { factionTheme } from '@/lib/theme';
import { playSfx } from '@/audio/sfx';

const VARIANT_TEXT_CLASS: Record<string, string> = {
  neon: 'lore-text-neon text-2xl md:text-3xl font-black text-fuchsia-200 leading-snug',
  dw: 'lore-text-dw text-xl md:text-2xl font-bold text-cyan-100 leading-relaxed',
  synth: 'lore-text-synth text-lg md:text-xl font-bold text-violet-200 leading-relaxed',
};

const VARIANT_GRADIENT: Record<string, string> = {
  neon: 'radial-gradient(ellipse at 50% 45%, #3a0e2e 0%, #0a0308 70%)',
  dw: 'radial-gradient(ellipse at 50% 45%, #10242a 0%, #030808 70%)',
  synth: 'radial-gradient(ellipse at 50% 45%, #1c1240 0%, #05040c 70%)',
};

const VARIANT_POST_HOLD_MS: Record<string, number> = {
  neon: 150,
  dw: 950,
  synth: 300,
};

export default function FactionSplash({ faction, onDone }: { faction: Faction; onDone: () => void }) {
  const beats = FACTION_SPLASH_BEATS[faction];
  const variant = SPLASH_VARIANT[faction];
  const theme = factionTheme(faction);
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);

  const atStory = index < beats.length;
  const currentBeat = atStory ? beats[index] : beats[beats.length - 1];

  return (
    <div className="fixed inset-0 z-40 bg-black overflow-hidden">
      {atStory ? (
        <CinematicBeat
          key={currentBeat.id}
          beat={currentBeat}
          gradient={VARIANT_GRADIENT[variant]}
          textClassName={VARIANT_TEXT_CLASS[variant]}
          postHoldMs={VARIANT_POST_HOLD_MS[variant]}
          onComplete={() => {
            if (index < beats.length - 1) setIndex((i) => i + 1);
            else setFinished(true);
          }}
        />
      ) : (
        <div className="absolute inset-0" style={{ background: VARIANT_GRADIENT[variant] }} />
      )}

      {finished && (
        <div className="absolute inset-0 z-10 flex items-end justify-center pb-[10%] lore-cards-in">
          <button
            type="button"
            onClick={() => {
              playSfx('ui.confirm');
              onDone();
            }}
            className="px-8 py-3 rounded-lg border-2 font-black tracking-widest text-sm uppercase hover:scale-105 transition-all"
            style={{ borderColor: theme.primary, color: theme.primary, background: `${theme.primary}15` }}
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
