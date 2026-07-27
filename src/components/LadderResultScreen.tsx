'use client';

/**
 * Commit 55 - shown instead of the normal GameOverScreen whenever
 * state.ladderContext is set (see GameBoard.tsx's GameOverScreen, which
 * branches to this at the very top before rendering anything else).
 *
 * On a WIN: records the win once (ref-guarded against React's double-effect
 * in dev), reveals the reward - a lightweight inline reveal for cosmetics
 * (drip rewards shouldn't gate the grind), or the full PackOpening3D ritual
 * for packs, which is the bigger moment. A faction-unlock is called out with
 * its own banner on top of whichever reward fired.
 *
 * On a LOSS: no store writes at all - "unlimited play" means a loss costs
 * nothing. "Continue Ladder" after a loss naturally rematches the SAME
 * rival (ladderStore.nextRival's parity is untouched by a loss); after a
 * win it naturally advances to the other rival. No special-casing needed.
 */

import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useLadderStore, LADDER_O2, WINS_TO_UNLOCK, type RewardEvent } from '@/store/ladderStore';
import { factionTheme } from '@/lib/theme';
import { playSfx } from '@/audio/sfx';
import PackOpening3D from './vfx/PackOpening3D';
import LadderCoinFlip from './LadderCoinFlip';
import LockerHeroPreview3D from './LockerHeroPreview3D';
import { getPlaymat, getSleeve } from '@/lib/cosmetics';
import type { PlayerId, Faction } from '@/types/game';

/** Commit 55.7 - "the prize preview should be like the bigger preview up top
 *  in the Locker": swapped the flat 56px thumbnail for the SAME
 *  LockerHeroPreview3D used there - a real mouse-steered 3D object (a cloth
 *  plate for playmats, a glossy plastic card for sleeves, a lit cylinder for
 *  coins), not a static image. Accent color (the playmat's stitched edge /
 *  the sleeve's plastic rim) is looked up directly from the cosmetics
 *  registry rather than threading it through RewardEvent - ladderStore
 *  already tracks the winning id, that's all this needs. */
function RewardCard({ reward }: { reward: RewardEvent }) {
  if (reward.kind !== 'cosmetic') return null;
  const accent =
    reward.cosmeticKind === 'playmat' ? getPlaymat(reward.id).edge
    : reward.cosmeticKind === 'sleeve' ? getSleeve(reward.id).rim
    : '#ff2fd0'; // coins: same fixed accent the Locker's hero preview uses
  return (
    <div className="rounded-lg border border-white/15 bg-black/50 p-4 mb-4 flex flex-col items-center">
      <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
        {reward.cosmeticKind} unlocked
      </div>
      <LockerHeroPreview3D
        kind={reward.cosmeticKind}
        image={reward.image}
        accent={accent}
        size={reward.cosmeticKind === 'playmat' ? 220 : 190}
      />
      <div className="text-base font-bold text-white mt-2">{reward.name}</div>
    </div>
  );
}

export default function LadderResultScreen() {
  const state = useGameStore();
  const startNewGame = useGameStore((s) => s.startNewGame);
  const setLadderContext = useGameStore((s) => s.setLadderContext);
  const resetToMenu = useGameStore((s) => s.resetToMenu);
  const recordWin = useLadderStore((s) => s.recordWin);
  const nextRival = useLadderStore((s) => s.nextRival);
  const ladders = useLadderStore((s) => s.ladders);

  const ctx = state.ladderContext!;
  const won = state.winnerId === 'player1';
  const theme = factionTheme(ctx.home);

  const recordedRef = useRef(false);
  const [reward, setReward] = useState<RewardEvent | null>(null);
  const [unlockedFaction, setUnlockedFaction] = useState(false);
  const [showPack, setShowPack] = useState(false);
  const [packClaimed, setPackClaimed] = useState(false);
  // Commit 55.1 - "Continue Ladder" now flips a coin first instead of
  // forcing the human to always go first.
  const [coinFlipTarget, setCoinFlipTarget] = useState<{ home: Faction; rival: Faction } | null>(null);

  useEffect(() => {
    if (!won || recordedRef.current) return;
    recordedRef.current = true;
    const result = recordWin(ctx.home, ctx.rival);
    setReward(result.reward);
    setUnlockedFaction(result.unlockedFaction);
    playSfx(result.unlockedFaction ? 'match.victory' : 'ui.confirm');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [won]);

  const ladder = ladders[ctx.home];
  const winsVsRival = ladder?.wins[ctx.rival] ?? 0;

  function continueLadder() {
    playSfx('ui.confirm');
    setCoinFlipTarget({ home: ctx.home, rival: nextRival(ctx.home) });
  }
  function onCoinResolved(first: PlayerId) {
    if (!coinFlipTarget) return;
    startNewGame(coinFlipTarget.home, coinFlipTarget.rival, true, false, false, first, LADDER_O2);
    setLadderContext({ home: coinFlipTarget.home, rival: coinFlipTarget.rival });
    setCoinFlipTarget(null);
  }
  function exitToMenu() {
    playSfx('ui.click');
    resetToMenu();
  }

  const rewardPending = won && reward?.kind === 'pack' && !packClaimed;

  if (showPack) {
    return <PackOpening3D onComplete={() => { setShowPack(false); setPackClaimed(true); }} />;
  }
  if (coinFlipTarget) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="panel-3d-deep max-w-md w-full rounded-xl border-2 border-white/15 p-8">
          <LadderCoinFlip onResolved={onCoinResolved} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div
        className="panel-3d-deep max-w-lg w-full rounded-xl border-2 p-8 text-center"
        style={{ borderColor: won ? theme.border : '#883333', boxShadow: won ? `0 0 40px ${theme.primary}55` : undefined }}
      >
        <div className="text-[11px] uppercase tracking-widest text-white/40 mb-1">
          {ctx.home} Ladder — vs {ctx.rival}
        </div>
        <div className="text-3xl font-black mb-3" style={{ color: won ? theme.primary : '#f87171' }}>
          {won ? 'Victory' : 'Defeated'}
        </div>

        {won ? (
          <div className="text-xs text-white/60 mb-4">
            {winsVsRival} / {WINS_TO_UNLOCK} wins vs {ctx.rival}
          </div>
        ) : (
          <div className="text-xs text-white/50 mb-4">No penalty — take another shot whenever you&apos;re ready.</div>
        )}

        {unlockedFaction && (
          <div className="mb-4 py-2.5 px-3 rounded-md bg-emerald-400/10 border border-emerald-400/40">
            <div className="text-sm font-black text-emerald-300">{ctx.rival} UNLOCKED</div>
            <div className="text-[10px] text-emerald-200/70 mt-0.5">Its own ladder is ready in the hub.</div>
          </div>
        )}

        {won && reward?.kind === 'cosmetic' && <RewardCard reward={reward} />}

        {rewardPending && (
          <button
            type="button"
            onClick={() => setShowPack(true)}
            className="w-full mb-4 py-2.5 rounded-md font-bold text-sm bg-gradient-to-r from-fuchsia-400 to-cyan-300 text-black hover:opacity-90"
          >
            Open Pack
          </button>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={continueLadder}
            disabled={rewardPending}
            className={`w-full py-2.5 rounded-md font-bold text-sm ${
              rewardPending ? 'bg-white/5 text-white/25 cursor-not-allowed' : 'bg-gradient-to-r from-fuchsia-400 to-cyan-300 text-black hover:opacity-90'
            }`}
          >
            Continue Ladder — next: {nextRival(ctx.home)}
          </button>
          <button type="button" onClick={exitToMenu} className="w-full py-2 rounded-md text-xs font-bold bg-white/10 hover:bg-white/20">
            Exit to Menu
          </button>
        </div>
      </div>
    </div>
  );
}
