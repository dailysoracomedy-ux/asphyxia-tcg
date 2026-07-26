'use client';

/**
 * Commit 55 - LADDER MODE. The full arc, in one file (same convention as
 * NewGameMenu.tsx managing several internal views itself):
 *
 *   'lore'        - one-time origin story + the permanent first-faction pick
 *                    (only shown before hasChosenFirstFaction()).
 *   'home'        - the ladder hub: each unlocked faction as a card showing
 *                    its two rival win-rings; locked factions show silhouette
 *                    teasers. "Continue Ladder" launches the next match.
 *
 * The actual MATCH is just a normal game - startNewGame + setLadderContext,
 * then GameBoard takes over exactly as it does for New Game / Simulated
 * Match. This component never touches match logic; it only decides which
 * two factions face off next and reacts once gameStore.status is back to
 * 'menu' (GameBoard's LadderResultScreen calls resetToMenu when the player
 * exits, which is what brings this component back on screen).
 */

import { useState } from 'react';
import type { Faction } from '@/types/game';
import { useGameStore } from '@/store/gameStore';
import { useLadderStore, ALL_FACTIONS, WINS_TO_UNLOCK, LADDER_O2, rivalsOf } from '@/store/ladderStore';
import { factionTheme } from '@/lib/theme';
import { playSfx } from '@/audio/sfx';
import LadderCoinFlip from './LadderCoinFlip';
import type { PlayerId } from '@/types/game';

/** Short, punchy - matches the game's own card-name voice rather than
 *  reading like a novel. Tunable copy; nothing here is load-bearing. */
const WORLD_LORE = `The Rift tore the sky over the city forty years ago and never closed. Three powers grew up in its light: the ones who want OUT from under anyone's boot, the ones who want everyone back UNDER control, and the ones who want to stop being human about it entirely. Pick a side. Prove it on the ladder. Earn the right to become the enemy too.`;

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

function WinRing({ wins, target, color }: { wins: number; target: number; color: string }) {
  const r = 15.5, c = 2 * Math.PI * r;
  const frac = Math.min(wins / target, 1);
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" className="shrink-0">
      <circle cx="19" cy="19" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
      <circle
        cx="19" cy="19" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
        transform="rotate(-90 19 19)"
        style={{ transition: 'stroke-dashoffset 400ms ease' }}
      />
      <text x="19" y="23" textAnchor="middle" fontSize="11" fontWeight="700" fill="white" fontFamily="monospace">
        {wins}
      </text>
    </svg>
  );
}

export default function LadderScreen({ onBack }: { onBack: () => void }) {
  const startNewGame = useGameStore((s) => s.startNewGame);
  const setLadderContext = useGameStore((s) => s.setLadderContext);
  const unlockedFactions = useLadderStore((s) => s.unlockedFactions);
  const ladders = useLadderStore((s) => s.ladders);
  const chooseFirstFaction = useLadderStore((s) => s.chooseFirstFaction);
  const nextRival = useLadderStore((s) => s.nextRival);

  const [view, setView] = useState<'lore' | 'home'>(unlockedFactions.length > 0 ? 'home' : 'lore');
  // Commit 55.1 - a real coin flip decides who goes first, same as every
  // other match in the game (this used to hardcode the human first, which
  // was wrong). Set to a pending matchup while the toss plays out; cleared
  // once resolved and the real match has launched.
  const [pendingLaunch, setPendingLaunch] = useState<{ home: Faction; rival: Faction } | null>(null);

  function launchMatch(home: Faction) {
    playSfx('ui.confirm');
    setPendingLaunch({ home, rival: nextRival(home) });
  }
  function onCoinResolved(first: PlayerId) {
    if (!pendingLaunch) return;
    startNewGame(pendingLaunch.home, pendingLaunch.rival, true, false, false, first, LADDER_O2);
    setLadderContext({ home: pendingLaunch.home, rival: pendingLaunch.rival });
    setPendingLaunch(null);
  }

  if (pendingLaunch) {
    return <LadderCoinFlip onResolved={onCoinResolved} />;
  }

  if (view === 'lore') {
    return (
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-5">
          <div className="text-[11px] uppercase tracking-[0.3em] text-white/40 mb-2">Ladder Mode</div>
          <div className="text-2xl font-black text-white mb-4">Choose Your Path</div>
          <p className="text-sm text-white/60 leading-relaxed">{WORLD_LORE}</p>
        </div>

        <div className="flex flex-col gap-2.5">
          {ALL_FACTIONS.map((f) => {
            const theme = factionTheme(f);
            const pitch = FACTION_PITCH[f];
            return (
              <button
                key={f}
                type="button"
                onClick={() => {
                  playSfx('ui.confirm');
                  chooseFirstFaction(f);
                  setView('home');
                }}
                onMouseEnter={() => playSfx('ui.hover')}
                className="panel-3d text-left rounded-lg border-2 p-4 transition-all hover:scale-[1.01]"
                style={{ borderColor: `${theme.primary}55` }}
              >
                <div className="text-base font-black mb-1" style={{ color: theme.primary }}>{f}</div>
                <div className="text-xs italic text-white/70 mb-1.5">{pitch.tag}</div>
                <div className="text-[11px] text-white/45 leading-relaxed">{pitch.body}</div>
              </button>
            );
          })}
        </div>

        <p className="text-center text-white/30 text-[10px] mt-5 leading-relaxed">
          This choice is permanent - it&apos;s who you start as. Beat each rival {WINS_TO_UNLOCK} times to earn
          the right to play as them too, each with their own ladder.
        </p>

        <button type="button" onClick={onBack} className="block mx-auto mt-5 text-[11px] text-white/30 hover:text-white/60 underline">
          Back
        </button>
      </div>
    );
  }

  // 'home' - the ladder hub
  return (
    <div className="max-w-xl mx-auto">
      <div className="text-center mb-5">
        <div className="text-[11px] uppercase tracking-[0.3em] text-white/40 mb-1">Ladder Mode</div>
        <div className="text-xl font-black text-white">Your Ladders</div>
      </div>

      <div className="flex flex-col gap-3">
        {ALL_FACTIONS.map((f) => {
          const theme = factionTheme(f);
          const unlocked = unlockedFactions.includes(f);
          if (!unlocked) {
            return (
              <div key={f} className="rounded-lg border-2 border-white/5 p-4 opacity-40">
                <div className="text-sm font-black text-white/50 mb-1">🔒 {f}</div>
                <div className="text-[11px] text-white/30">Beat {f} {WINS_TO_UNLOCK} times on another ladder to unlock this one.</div>
              </div>
            );
          }
          const ladder = ladders[f];
          const [r1, r2] = rivalsOf(f);
          const w1 = ladder?.wins[r1] ?? 0, w2 = ladder?.wins[r2] ?? 0;
          const complete = w1 >= WINS_TO_UNLOCK && w2 >= WINS_TO_UNLOCK;
          return (
            <div key={f} className="panel-3d rounded-lg border-2 p-4" style={{ borderColor: `${theme.primary}55` }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-black" style={{ color: theme.primary }}>{f}</div>
                {complete && <span className="text-[10px] font-black text-emerald-300 tracking-wider">LADDER COMPLETE</span>}
              </div>
              <div className="flex items-center gap-5 mb-3.5">
                <div className="flex items-center gap-2">
                  <WinRing wins={w1} target={WINS_TO_UNLOCK} color={factionTheme(r1).primary} />
                  <div className="text-[10px] text-white/50 leading-tight">
                    vs<br /><span className="text-white/75 font-bold">{r1}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <WinRing wins={w2} target={WINS_TO_UNLOCK} color={factionTheme(r2).primary} />
                  <div className="text-[10px] text-white/50 leading-tight">
                    vs<br /><span className="text-white/75 font-bold">{r2}</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => launchMatch(f)}
                onMouseEnter={() => playSfx('ui.hover')}
                disabled={complete}
                className={`w-full py-2 rounded-md text-xs font-bold tracking-wide ${
                  complete ? 'bg-white/5 text-white/30 cursor-not-allowed' : 'bg-gradient-to-r from-fuchsia-400 to-cyan-300 text-black hover:opacity-90'
                }`}
              >
                {complete ? 'Ladder Complete' : `Continue \u2014 next up: ${nextRival(f)}`}
              </button>
            </div>
          );
        })}
      </div>

      <button type="button" onClick={onBack} className="block mx-auto mt-5 text-[11px] text-white/30 hover:text-white/60 underline">
        Back to Menu
      </button>
    </div>
  );
}
