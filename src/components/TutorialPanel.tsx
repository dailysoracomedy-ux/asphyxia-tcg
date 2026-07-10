'use client';

import { useEffect } from 'react';
import type { GameState } from '@/types/game';
import { useGameStore } from '@/store/gameStore';
import { useTutorialStore } from '@/store/tutorialStore';

/** One tutorial step. autoAdvanceWhen is checked against live state every render -
 *  if it returns true, the step advances on its own without waiting for a Next
 *  click. Every step can still be skipped manually regardless (Commit 29's
 *  tutorial is explicitly meant to be forgiving, not a test - "Next" always
 *  works, whether or not the milestone happened yet). */
interface TutorialStep {
  title: string;
  text: string;
  autoAdvanceWhen?: (state: GameState) => boolean;
}

const STEPS: TutorialStep[] = [
  {
    title: 'O2: your life total',
    text: 'O2 is your life. Reduce your opponent\u2019s O2 to 0 and you win. Yours is shown at the top of the board.',
  },
  {
    title: 'Apexes: your fighters',
    text: 'Apexes are the fighters you play and attack with. Pick your starting Apex now to begin.',
    autoAdvanceWhen: (s) => s.status === 'playing',
  },
  {
    title: 'Engines: Sync generators',
    text: 'Play an Engine from your hand during Main Phase. Engines generate Sync, which you spend during Combat for stronger attacks.',
    autoAdvanceWhen: (s) => s.players.player1.supportSlots.some(Boolean),
  },
  {
    title: 'Equips: upgrade your Apex',
    text: 'Play Plasma Edge (or any Equip) onto your Apex. Equips attach underneath it and stay attached until swapped or the Apex is destroyed.',
    autoAdvanceWhen: (s) => s.players.player1.apexSlots.some((a) => !!a?.equip),
  },
  {
    title: 'Attacking',
    text: 'In Combat Phase, choose your Apex, pick an attack (stronger ones cost more Sync), and choose a target. If damage exceeds their DEF, the extra spills over as overflow O2 damage.',
    autoAdvanceWhen: (s) => s.players.player1.apexSlots.some((a) => a?.hasAttacked),
  },
  {
    title: 'Momentum fuels big plays',
    text: 'Momentum builds up from combat and Rift bonuses. Specials, Reacts, and Overdrive attacks all spend it - the more you have, the more options open up.',
    autoAdvanceWhen: (s) => s.players.player1.momentum > 0,
  },
  {
    title: 'Specials: swing the turn',
    text: 'Play a Special from your hand (one per turn) when you have one available and Momentum to spend - they create big, game-changing plays.',
    autoAdvanceWhen: (s) => s.players.player1.turnFlags.specialsPlayedThisTurn > 0,
  },
  {
    title: 'Reacts: respond to the opponent',
    text: 'When the opponent attacks or plays something big, you may get a Response Window to play a React from hand - reducing damage, saving your Apex, or cancelling their play outright.',
  },
  {
    title: 'Rifts change the board',
    text: 'The current Rift Space (shown near the top of the board) is a shared modifier both players deal with this match. Rifts can trigger bonuses, penalties, or entirely new choices as the game goes on.',
  },
  {
    title: 'Win the match',
    text: 'Keep attacking, keep Sync and Momentum flowing, and reduce your opponent\u2019s O2 to 0. That\u2019s the whole loop - now go play it for real.',
  },
];

export default function TutorialPanel() {
  const state = useGameStore();
  const step = useTutorialStore((s) => s.step);
  const setStep = useTutorialStore((s) => s.setStep);

  // Fresh tutorial run always starts at step 0 - guards against a stale step
  // index surviving from a previous tutorial attempt in the same browser session.
  useEffect(() => {
    if (state.turnNumber <= 1 && state.status === 'selectingOpeningApex') setStep(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = STEPS[step];
  useEffect(() => {
    if (!current?.autoAdvanceWhen) return;
    if (current.autoAdvanceWhen(state) && step < STEPS.length - 1) {
      const t = setTimeout(() => setStep(step + 1), 1200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, step]);

  if (!current) return null;

  return (
    <div className="fixed bottom-3 right-3 z-30 w-72 max-w-[calc(100vw-24px)] rounded-lg border-2 border-emerald-400/50 bg-[#05050ae8] p-3 shadow-[0_0_24px_rgba(52,211,153,0.25)]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] uppercase tracking-widest text-emerald-300/70">
          Learn To Play &middot; Step {step + 1} / {STEPS.length}
        </span>
        <button
          type="button"
          onClick={() => useGameStore.getState().resetToMenu()}
          className="text-[9px] text-white/30 hover:text-white/60 underline"
        >
          Exit
        </button>
      </div>
      <div className="text-sm font-bold text-emerald-200 mb-1">{current.title}</div>
      <div className="text-[11px] text-white/70 leading-snug mb-2">{current.text}</div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep(Math.max(0, step - 1))}
          className="px-2 py-1 rounded border border-white/15 text-[10px] text-white/50 hover:bg-white/10 disabled:opacity-30"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setStep(0)}
          className="px-2 py-1 rounded border border-white/15 text-[10px] text-white/50 hover:bg-white/10"
        >
          Restart
        </button>
        <button
          type="button"
          disabled={step >= STEPS.length - 1}
          onClick={() => setStep(Math.min(STEPS.length - 1, step + 1))}
          className="px-2 py-1 rounded border border-emerald-400/50 text-[10px] text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </div>
  );
}
