'use client';

/**
 * Commit 55.1 - Ladder Mode needed its own coin flip: matches were launching
 * with the human forced to go first every time ("locked to player1"),
 * which Daily correctly flagged - it should be a real coin toss like every
 * other match in the game. This mirrors NewGameMenu's coin-flip view
 * exactly (same CoinFlip3D usage, same call/flip/result staging, same
 * "loser's side is randomized" rule when the human loses the call) but as
 * its own small component so LadderScreen and LadderResultScreen can both
 * drop it in front of a match launch without duplicating the state machine.
 */

import { useState } from 'react';
import type { PlayerId } from '@/types/game';
import CoinFlip3D, { type CoinFace } from './CoinFlip3D';
import { getCoin } from '@/lib/cosmetics';
import { useCosmeticsStore } from '@/store/cosmeticsStore';
import { playSfx } from '@/audio/sfx';

type CallSide = 'heads' | 'tails';
type Stage = 'calling' | 'flipping' | 'result';

export default function LadderCoinFlip({ onResolved }: { onResolved: (first: PlayerId) => void }) {
  const [stage, setStage] = useState<Stage>('calling');
  const [called, setCalled] = useState<CallSide | null>(null);
  const [result, setResult] = useState<CallSide | null>(null);
  const [wonCall, setWonCall] = useState(false);
  const [flipId, setFlipId] = useState(0);
  const coinSkin = useCosmeticsStore((s) => getCoin(s.loadouts.player1.coin));

  function callCoin(side: CallSide) {
    playSfx('ui.confirm');
    const outcome: CallSide = Math.random() < 0.5 ? 'heads' : 'tails';
    setCalled(side);
    setResult(outcome);
    setStage('flipping');
    setFlipId((n) => n + 1);
  }

  function handleLanded() {
    if (!called || !result) return;
    const won = called === result;
    setWonCall(won);
    setStage('result');
    setTimeout(() => playSfx(won ? 'match.victory' : 'ui.invalid'), 250);
    if (!won) {
      // Lost the call - the AI's "choice" of who goes first is random,
      // exactly like every other AI opponent in the game (there's no one
      // to meaningfully make the choice for).
      const randomFirst: PlayerId = Math.random() < 0.5 ? 'player1' : 'player2';
      setTimeout(() => onResolved(randomFirst), 1400);
    }
  }

  function chooseFirst(first: PlayerId) {
    playSfx('ui.confirm');
    onResolved(first);
  }

  return (
    <div className="flex flex-col items-center gap-0 -mx-8 -my-4">
      <div className="text-center relative z-10 -mb-[90px] pt-2">
        <div className="text-[11px] uppercase tracking-widest text-white/40 mb-1">Coin Flip</div>
        <div className="text-lg font-black text-fuchsia-300">
          {stage === 'calling' && 'Call it in the air'}
          {stage === 'flipping' && 'Flipping...'}
          {stage === 'result' && (wonCall ? 'You called it!' : 'Not this time.')}
        </div>
      </div>

      <CoinFlip3D
        width={446}
        height={460}
        frontSrc={coinSkin.frontImage ?? undefined}
        flipId={flipId}
        flipTo={(result ?? null) as CoinFace | null}
        onLanded={handleLanded}
      />

      {stage === 'calling' && (
        <div className="flex gap-4 relative z-10 -mt-[59px] pb-2">
          <button
            type="button"
            onClick={() => callCoin('heads')}
            onMouseEnter={() => playSfx('ui.hover')}
            className="btn-art w-[113px] h-[48px] rounded-lg hover:scale-105 transition-all hover:shadow-[0_0_16px_rgba(255,47,208,0.5)]"
            style={{ backgroundImage: 'url(/ui/heads-button.webp)' }}
          >
            <span className="sr-only">HEADS</span>
          </button>
          <button
            type="button"
            onClick={() => callCoin('tails')}
            onMouseEnter={() => playSfx('ui.hover')}
            className="btn-art w-[113px] h-[48px] rounded-lg hover:scale-105 transition-all hover:shadow-[0_0_16px_rgba(34,211,238,0.5)]"
            style={{ backgroundImage: 'url(/ui/tails-button.webp)' }}
          >
            <span className="sr-only">TAILS</span>
          </button>
        </div>
      )}

      {stage === 'result' && called && result && (
        <div className="text-center flex flex-col items-center gap-3 relative z-10 -mt-[72px] pb-2">
          <div className="text-xs text-white/60">
            You called <span className="font-bold text-white/90">{called}</span>, it landed on{' '}
            <span className="font-bold text-white/90">{result}</span>.
          </div>
          {wonCall ? (
            <>
              <div className="text-[11px] text-white/50">Choose who goes first:</div>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => chooseFirst('player1')}
                  onMouseEnter={() => playSfx('ui.hover')}
                  className="px-4 py-2 rounded-lg border-2 border-emerald-400/60 text-emerald-200 bg-emerald-400/10 font-bold text-sm tracking-wide hover:scale-105 hover:brightness-110 transition-all"
                >
                  Go First
                </button>
                <button
                  type="button"
                  onClick={() => chooseFirst('player2')}
                  onMouseEnter={() => playSfx('ui.hover')}
                  className="px-4 py-2 rounded-lg border-2 border-white/25 text-white/70 bg-white/5 font-bold text-sm tracking-wide hover:scale-105 hover:brightness-110 transition-all"
                >
                  Go Second
                </button>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-white/40">The rival calls the toss on this one...</div>
          )}
        </div>
      )}
    </div>
  );
}
