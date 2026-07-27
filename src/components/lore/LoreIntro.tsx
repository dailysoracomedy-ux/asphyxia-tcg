'use client';

/**
 * Commit 56 - the cinematic lore intro. Plays LORE_INTRO_BEATS (11 beats)
 * in sequence, then the 12th beat (LORE_CALL_TO_ACTION) whose narration
 * resolves INTO the three faction cards fading in beneath it, rather than
 * fading out like every beat before it. Skip Intro jumps straight to that
 * choice - it skips the story, never the choice itself.
 *
 * Shown once ever (ladderStore.introSeen) - LadderScreen is what decides
 * whether to mount this at all.
 */

import { useState } from 'react';
import type { Faction } from '@/types/game';
import CinematicBeat from './CinematicBeat';
import { LORE_INTRO_BEATS, LORE_CALL_TO_ACTION } from '@/lib/loreContent';
import { factionTheme } from '@/lib/theme';
import { playSfx } from '@/audio/sfx';

const ALL_FACTIONS: Faction[] = ['Neon Underground', 'Dark White', 'Synth Ascendancy'];

const FACTION_PITCH: Record<Faction, { tag: string; body: string }> = {
  'Neon Underground': {
    tag: 'Freedom, by force if it has to be.',
    body: 'No masters, no clean rooms, no upload. Just the street, the signal, and whoever\u2019s fast enough to keep both.',
  },
  'Dark White': {
    tag: 'Order is mercy. Chaos is a disease.',
    body: 'The Rift didn\u2019t break the world - people did, the moment no one was watching them. Dark White watches. Always.',
  },
  'Synth Ascendancy': {
    tag: 'The body was always the weak part.',
    body: 'Flesh fails. Code doesn\u2019t have to. Ascendancy isn\u2019t trying to survive the Rift - it\u2019s trying to become it.',
  },
};

/** Themed placeholder gradients until real background art exists - each
 *  roughly matches its beat's tone (bleak cold-open, warmer rebellion,
 *  per-faction color at the reveal beats, fractured violet at Chronos). */
const FALLBACK_GRADIENT: Record<string, string> = {
  'cold-open': 'radial-gradient(ellipse at 50% 30%, #1a1a22 0%, #050506 70%)',
  rebellion: 'radial-gradient(ellipse at 50% 40%, #2a1f12 0%, #0a0704 70%)',
  fracture: 'radial-gradient(ellipse at 50% 40%, #241428 0%, #08050a 70%)',
  'neon-reveal': 'radial-gradient(ellipse at 50% 40%, #3a0e2e 0%, #0a0308 70%)',
  'darkwhite-reveal': 'radial-gradient(ellipse at 50% 40%, #10242a 0%, #030808 70%)',
  'synth-reveal': 'radial-gradient(ellipse at 50% 40%, #1c1240 0%, #05040c 70%)',
  war: 'radial-gradient(ellipse at 50% 40%, #2a1010 0%, #0a0303 70%)',
  chronos: 'radial-gradient(ellipse at 50% 50%, #2a0838 0%, #050208 70%)',
  sting: 'radial-gradient(ellipse at 50% 50%, #150818 0%, #030103 70%)',
  loop: 'radial-gradient(ellipse at 50% 50%, #1c0a2c 0%, #040207 70%)',
  thesis: 'radial-gradient(ellipse at 50% 50%, #24102e 0%, #050308 70%)',
  'call-to-action': 'radial-gradient(ellipse at 50% 35%, #200a2c 0%, #040207 75%)',
};
const DEFAULT_GRADIENT = 'radial-gradient(ellipse at 50% 40%, #1a1420 0%, #050408 70%)';

export default function LoreIntro({ onFactionChosen, onSkip }: { onFactionChosen: (faction: Faction) => void; onSkip?: () => void }) {
  const [index, setIndex] = useState(0);
  const [showChoice, setShowChoice] = useState(false);

  const atStory = index < LORE_INTRO_BEATS.length;
  const currentBeat = atStory ? LORE_INTRO_BEATS[index] : LORE_CALL_TO_ACTION;

  function skip() {
    playSfx('ui.click');
    setIndex(LORE_INTRO_BEATS.length);
    setShowChoice(true);
    onSkip?.();
  }

  return (
    <div className="fixed inset-0 z-40 bg-black overflow-hidden">
      <button type="button" onClick={skip} className="lore-skip-btn">
        SKIP INTRO
      </button>

      <CinematicBeat
        key={currentBeat.id}
        beat={currentBeat}
        gradient={FALLBACK_GRADIENT[currentBeat.id] ?? DEFAULT_GRADIENT}
        holdText={!atStory}
        onComplete={() => {
          if (atStory) setIndex((i) => i + 1);
          else setShowChoice(true);
        }}
      />

      {showChoice && (
        <div className="absolute inset-0 z-10 flex items-end justify-center pb-[6%] px-6">
          <div className="w-full max-w-3xl grid grid-cols-1 sm:grid-cols-3 gap-3 lore-cards-in">
            {ALL_FACTIONS.map((f) => {
              const theme = factionTheme(f);
              const pitch = FACTION_PITCH[f];
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    playSfx('ui.confirm');
                    onFactionChosen(f);
                  }}
                  onMouseEnter={() => playSfx('ui.hover')}
                  className="panel-3d text-left rounded-lg border-2 p-3.5 transition-all hover:scale-[1.02] bg-black/70"
                  style={{ borderColor: `${theme.primary}77`, boxShadow: `0 0 22px ${theme.primary}33` }}
                >
                  <div className="text-sm font-black mb-1" style={{ color: theme.primary }}>{f}</div>
                  <div className="text-[11px] italic text-white/70 mb-1">{pitch.tag}</div>
                  <div className="text-[10px] text-white/40 leading-snug">{pitch.body}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
