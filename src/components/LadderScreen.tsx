'use client';

/**
 * Commit 56 - LADDER MODE. The full arc, in one file (same convention as
 * NewGameMenu.tsx managing several internal views itself):
 *
 *   'intro'   - the 11-beat cinematic lore intro, shown once ever
 *               (!introSeen), resolving into the 3-faction choice.
 *   'splash'  - a faction's voice-differentiated welcome, shown once per
 *               faction ever (splashSeen) - either right after the intro
 *               (the original pick) or the first time you enter a NEWLY
 *               UNLOCKED faction's own ladder from the hub.
 *   'home'    - the ladder hub: each unlocked faction as a card showing
 *               its two rival win-rings; locked factions show silhouette
 *               teasers. "Continue Ladder" launches the next match.
 *
 * The actual MATCH is just a normal game - startNewGame + setLadderContext,
 * then GameBoard takes over exactly as it does for New Game / Simulated
 * Match. This component never touches match logic; it only decides which
 * two factions face off next and reacts once gameStore.status is back to
 * 'menu' (GameBoard's LadderResultScreen calls resetToMenu when the player
 * exits, which is what brings this component back on screen).
 */

import { useState } from 'react';
import type { Faction, PlayerId } from '@/types/game';
import { useGameStore } from '@/store/gameStore';
import { useLadderStore, ALL_FACTIONS, WINS_TO_UNLOCK, LADDER_O2, rivalsOf } from '@/store/ladderStore';
import { factionTheme } from '@/lib/theme';
import { playSfx } from '@/audio/sfx';
import LadderCoinFlip from './LadderCoinFlip';
import LoreIntro from './lore/LoreIntro';
import FactionSplash from './lore/FactionSplash';

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

type Screen = 'intro' | 'splash' | 'home';

export default function LadderScreen({ onBack }: { onBack: () => void }) {
  const startNewGame = useGameStore((s) => s.startNewGame);
  const setLadderContext = useGameStore((s) => s.setLadderContext);
  const unlockedFactions = useLadderStore((s) => s.unlockedFactions);
  const ladders = useLadderStore((s) => s.ladders);
  const introSeen = useLadderStore((s) => s.introSeen);
  const splashSeen = useLadderStore((s) => s.splashSeen);
  const chooseFirstFaction = useLadderStore((s) => s.chooseFirstFaction);
  const markIntroSeen = useLadderStore((s) => s.markIntroSeen);
  const markSplashSeen = useLadderStore((s) => s.markSplashSeen);
  const nextRival = useLadderStore((s) => s.nextRival);

  const [screen, setScreen] = useState<Screen>(introSeen ? 'home' : 'intro');
  const [splashFaction, setSplashFaction] = useState<Faction | null>(null);
  // What to do once the current splash finishes - "go to the hub" (first-
  // ever pick) or "proceed into the coin flip for this faction" (entering
  // a just-unlocked faction's ladder for the first time). A plain closure
  // keeps those two call sites (below) from needing to know about each
  // other at all.
  const [afterSplash, setAfterSplash] = useState<(() => void) | null>(null);

  // Commit 55.1 - a real coin flip decides who goes first, same as every
  // other match in the game. Set to a pending matchup while the toss plays
  // out; cleared once resolved and the real match has launched.
  const [pendingLaunch, setPendingLaunch] = useState<{ home: Faction; rival: Faction } | null>(null);

  function showSplashThen(faction: Faction, then: () => void) {
    setSplashFaction(faction);
    setAfterSplash(() => then);
    setScreen('splash');
  }

  function launchMatch(home: Faction) {
    playSfx('ui.confirm');
    const doLaunch = () => setPendingLaunch({ home, rival: nextRival(home) });
    if (!splashSeen.includes(home)) {
      showSplashThen(home, doLaunch);
    } else {
      doLaunch();
    }
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

  if (screen === 'intro') {
    return (
      <LoreIntro
        onFactionChosen={(f) => {
          chooseFirstFaction(f);
          markIntroSeen();
          showSplashThen(f, () => setScreen('home'));
        }}
      />
    );
  }

  if (screen === 'splash' && splashFaction) {
    return (
      <FactionSplash
        faction={splashFaction}
        onDone={() => {
          markSplashSeen(splashFaction);
          setSplashFaction(null);
          const next = afterSplash;
          setAfterSplash(null);
          next?.();
        }}
      />
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
