'use client';

import { useState } from 'react';
import type { Faction, PlayerId } from '@/types/game';
import { useGameStore } from '@/store/gameStore';
import { factionTheme } from '@/lib/theme';
import { BUILD_VERSION } from '@/lib/version';
import { useTutorialStore } from '@/store/tutorialStore';
import AudioSettingsControl from '@/audio/AudioSettingsControl';
import { playSfx } from '@/audio/sfx';
import CoinFlip3D, { type CoinFace } from './CoinFlip3D';
import LockerMenu from './LockerMenu';
import { getCoin } from '@/lib/cosmetics';
import { useCosmeticsStore } from '@/store/cosmeticsStore';

const FACTIONS: Faction[] = ['Neon Underground', 'Dark White', 'Synth Ascendancy'];

function randomFaction(): Faction {
  return FACTIONS[Math.floor(Math.random() * FACTIONS.length)];
}

// Commit 47 - bespoke button art (public/ui/, provided at 4x, served at 2x).
const DECK_BUTTON_ART: Record<Faction, string> = {
  'Neon Underground': '/ui/deck-neon.webp',
  'Dark White': '/ui/deck-dark-white.webp',
  'Synth Ascendancy': '/ui/deck-synth-ascendancy.webp',
};
const O2_BUTTON_ART: Record<number, string> = {
  12: '/ui/o2-12.webp',
  24: '/ui/o2-24.webp',
  48: '/ui/o2-48.webp',
  96: '/ui/o2-96.webp',
};

function FactionPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Faction;
  onChange: (f: Faction) => void;
}) {
  return (
    <div className="flex-1 min-w-[150px]">
      <div className="text-xs uppercase tracking-widest text-white/40 mb-2">{label}</div>
      <div className="flex flex-col gap-2">
        {FACTIONS.map((f) => {
          const theme = factionTheme(f);
          const active = value === f;
          return (
            <button
              type="button"
              key={f}
              onClick={() => {
                playSfx('ui.click');
                onChange(f);
              }}
              onMouseEnter={() => playSfx('ui.hover')}
              // Commit 47 - hand-made deck button art (text baked in; the
              // real label is sr-only). Glow + sounds kept, per direction.
              className={`btn-art block w-full max-w-[330px] mx-auto rounded-md transition-all ${active ? 'scale-[1.02]' : 'opacity-60 hover:opacity-90'}`}
              style={{
                backgroundImage: `url(${DECK_BUTTON_ART[f]})`,
                aspectRatio: '1528 / 176',
                boxShadow: active ? `0 0 14px ${theme.primary}` : 'none',
              }}
            >
              <span className="sr-only">{f}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const O2_OPTIONS = [12, 24, 48, 96];

function O2Selector({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-white/40 mb-2">Select O2 Amount</div>
      <div className="flex gap-2">
        {O2_OPTIONS.map((n) => {
          const active = value === n;
          return (
            <button
              type="button"
              key={n}
              onClick={() => {
                playSfx('ui.click');
                onChange(n);
              }}
              onMouseEnter={() => playSfx('ui.hover')}
              // Commit 47 - art has a taller aspect than the old buttons
              // (295:158), so the container resizes to the art, not vice versa.
              className={`btn-art flex-1 rounded-md transition-all ${
                active ? 'shadow-[0_0_14px_rgba(34,211,238,0.6)] scale-[1.02]' : 'opacity-60 hover:opacity-90'
              }`}
              style={{ backgroundImage: `url(${O2_BUTTON_ART[n]})`, aspectRatio: '295 / 158' }}
            >
              <span className="sr-only">{n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A primary menu button - shared hover/click sound + glow, used for all three
 *  main-menu options so they behave and feel identically. */
function MenuButton({
  label,
  sublabel,
  colorClass,
  glowColorClass,
  onClick,
  art,
}: {
  /** Commit 47.1 - hand-made button plate (text baked in). When set, the
   *  image is the button; label/sublabel stay in the DOM as sr-only. */
  art?: string;
  label: string;
  sublabel: string;
  colorClass: string;
  glowColorClass: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        playSfx('ui.confirm');
        onClick();
      }}
      onMouseEnter={() => playSfx('ui.hover')}
      className={
        art
          ? `btn-art group w-full rounded-lg transition-all ${glowColorClass}`
          : `btn-3d group w-full py-4 rounded-lg border-2 font-bold tracking-widest text-lg transition-all hover:brightness-110 ${colorClass} ${glowColorClass}`
      }
      style={art ? { backgroundImage: `url(${art})`, aspectRatio: '2657 / 592' } : undefined}
    >
      {art ? (
        <span className="sr-only">
          {label} — {sublabel}
        </span>
      ) : (
        <>
          {label}
          <div className="text-[10px] font-normal tracking-normal opacity-60 mt-0.5 normal-case">{sublabel}</div>
        </>
      )}
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        playSfx('ui.click');
        onClick();
      }}
      onMouseEnter={() => playSfx('ui.hover')}
      className="text-xs text-white/40 hover:text-white/70 mb-4 flex items-center gap-1"
    >
      &larr; Back
    </button>
  );
}

type MenuView = 'main' | 'new-game' | 'simulated' | 'coin-flip' | 'locker';
type CallSide = 'heads' | 'tails';
type CoinStage = 'calling' | 'flipping' | 'result';

export default function NewGameMenu({ onOpenDeveloper }: { onOpenDeveloper?: () => void }) {
  const startNewGame = useGameStore((s) => s.startNewGame);
  const [view, setView] = useState<MenuView>('main');
  const [p1, setP1] = useState<Faction>('Neon Underground');
  const [p2, setP2] = useState<Faction>('Dark White');
  const [hotseat, setHotseat] = useState(false);
  const [o2Amount, setO2Amount] = useState(12);
  // Locked in the instant "Start" is pressed on the New Game screen, so the
  // coin flip screen that follows always launches the exact match that was
  // actually configured, not a freshly re-randomized opponent.
  const [pendingOpponent, setPendingOpponent] = useState<Faction>('Dark White');
  const [pendingHotseat, setPendingHotseat] = useState(false);

  const [coinStage, setCoinStage] = useState<CoinStage>('calling');
  const [called, setCalled] = useState<CallSide | null>(null);
  const [coinResult, setCoinResult] = useState<CallSide | null>(null);
  const [wonCall, setWonCall] = useState(false);
  // Commit 42 - each increment launches one 3D toss in CoinFlip3D. The coin
  // itself owns all spin/audio timing now; this component only decides the
  // outcome and reacts when the coin reports it has landed.
  const [flipId, setFlipId] = useState(0);
  const coinSkin = useCosmeticsStore((s) => getCoin(s.loadouts.player1.coin));

  function beginCoinFlip(opponent: Faction, isHotseat: boolean) {
    setPendingOpponent(opponent);
    setPendingHotseat(isHotseat);
    setCoinStage('calling');
    setCalled(null);
    setCoinResult(null);
    setView('coin-flip');
  }

  // Commit 42 - the old Commit 34.3 face-swap spin (timed to the 1.785s
  // flipLoop sound) is retired along with its whole timing dance: the 3D coin
  // tosses in ~1.1s + 0.55s settle, roughly half the old length, and fires
  // flipStart/flipLand itself at the physically right moments.
  function callCoin(side: CallSide) {
    playSfx('ui.confirm');
    const outcome: CallSide = Math.random() < 0.5 ? 'heads' : 'tails';
    setCalled(side);
    setCoinResult(outcome);
    setCoinStage('flipping');
    setFlipId((n) => n + 1); // hands off to CoinFlip3D
  }

  function handleCoinLanded() {
    if (!called || !coinResult) return;
    const won = called === coinResult;
    setWonCall(won);
    setCoinStage('result');
    setTimeout(() => playSfx(won ? 'match.victory' : 'ui.invalid'), 250);
    if (!won) {
      // The opponent won the call - their choice of who goes first is
      // random, since there's no one to meaningfully make it for them.
      const randomFirst: PlayerId = Math.random() < 0.5 ? 'player1' : 'player2';
      setTimeout(() => startNewGame(p1, pendingOpponent, !pendingHotseat, false, false, randomFirst, o2Amount), 1400);
    }
  }

  function chooseFirst(first: PlayerId) {
    playSfx('ui.confirm');
    startNewGame(p1, pendingOpponent, !pendingHotseat, false, false, first, o2Amount);
  }

  return (
    <div className="min-h-screen flex items-center justify-center scanlines">
      {/* Commit 46 - living film grain over the whole menu scene. */}
      <div className="world-grain" aria-hidden />
      <div className="max-w-md w-full mx-4 rounded-xl border border-cyan-500/30 bg-black p-8 shadow-[0_0_40px_rgba(34,211,238,0.15)]">
        {/* Commit 42 - the coin flip is a moment, not a menu: on that view the
            logo, version pill and audio sliders all step aside so nothing
            competes with the toss. Every other view keeps the full header. */}
        {view !== 'coin-flip' && (
          <>
            {/* Commit 33 - the real Asphyxia logo, replacing the plain text header.
                Transparent PNG built for a dark background - fits the card's own
                black backdrop with no extra framing needed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/* Commit 47 - the deck-select screen drops the version pill and
                audio sliders and runs the logo at 80%, so the hand-made deck
                buttons own the screen. Other views keep the full header. */}
            <img
              src="/images/asphyxia-logo.png"
              alt="ASPHYXIA"
              className={`w-full mx-auto mb-2 select-none pointer-events-none ${view === 'new-game' ? 'max-w-[224px]' : 'max-w-[280px]'}`}
              draggable={false}
            />

            {view !== 'new-game' && (
              <>
                <div className="text-center mb-6">
                  <span className="inline-block px-3 py-1 rounded-full border border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300 text-[10px] font-mono tracking-widest">
                    {BUILD_VERSION}
                  </span>
                </div>

                <div className="flex justify-center mb-6">
                  <AudioSettingsControl />
                </div>
              </>
            )}
          </>
        )}

        {view === 'main' && (
          <div className="flex flex-col gap-3">
            <MenuButton
              label="New Game"
              art="/ui/menu-new-game.webp"
              sublabel="Pick your deck. Your opponent's is a surprise."
              colorClass="border-fuchsia-400/60 text-fuchsia-200 bg-fuchsia-400/10"
              glowColorClass="hover:shadow-[0_0_20px_rgba(232,121,249,0.4)]"
              onClick={() => setView('new-game')}
            />
            <MenuButton
              label="Learn To Play"
              art="/ui/menu-learn-to-play.webp"
              sublabel="A guided walkthrough of the whole game."
              colorClass="border-emerald-400/60 text-emerald-200 bg-emerald-400/10"
              glowColorClass="hover:shadow-[0_0_20px_rgba(52,211,153,0.4)]"
              onClick={() => {
                startNewGame('Neon Underground', 'Dark White', false, false, true);
                useTutorialStore.getState().setSlideshowActive(true);
                useTutorialStore.getState().setSlideIndex(0);
                useTutorialStore.getState().setStep(0);
                useTutorialStore.getState().setHelperMessage(null);
              }}
            />
            <MenuButton
              label="Simulated Match"
              art="/ui/menu-simulated.webp"
              sublabel="Watch two AI decks of your choice fight it out."
              colorClass="border-cyan-400/60 text-cyan-200 bg-cyan-400/10"
              glowColorClass="hover:shadow-[0_0_20px_rgba(34,211,238,0.4)]"
              onClick={() => setView('simulated')}
            />

            <MenuButton
              label="The Locker"
              art="/ui/menu-locker.webp"
              sublabel="Playmats, sleeves, deck boxes & coins."
              colorClass="border-purple-400/60 text-purple-200 bg-purple-400/10"
              glowColorClass="hover:shadow-[0_0_20px_rgba(192,132,252,0.4)]"
              onClick={() => setView('locker')}
            />

            {onOpenDeveloper && (
              <button
                type="button"
                onClick={onOpenDeveloper}
                onMouseEnter={() => playSfx('ui.hover')}
                className="mx-auto mt-2 text-[10px] text-white/25 hover:text-white/50 underline"
              >
                Developer — Apex Card Gallery
              </button>
            )}
          </div>
        )}

        {view === 'new-game' && (
          <div>
            <BackButton onClick={() => setView('main')} />
            <FactionPicker label="Your Deck" value={p1} onChange={setP1} />

            <label className="flex items-center gap-2 mt-4 text-xs text-white/50 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hotseat}
                onChange={(e) => {
                  playSfx('ui.click');
                  setHotseat(e.target.checked);
                }}
              />
              2-Player (pass and play — pick both decks)
            </label>

            {hotseat && <div className="mt-4"><FactionPicker label="Player 2's Deck" value={p2} onChange={setP2} /></div>}

            <div className="mt-4">
              <O2Selector value={o2Amount} onChange={setO2Amount} />
            </div>

            <button
              type="button"
              onClick={() => {
                playSfx('ui.confirm');
                beginCoinFlip(hotseat ? p2 : randomFaction(), hotseat);
              }}
              onMouseEnter={() => playSfx('ui.hover')}
              className="btn-art block mt-5 w-[280px] mx-auto rounded-md transition-all hover:shadow-[0_0_18px_rgba(255,47,208,0.45)]"
              style={{ backgroundImage: 'url(/ui/start-button.webp)', aspectRatio: '448 / 109' }}
            >
              <span className="sr-only">START</span>
            </button>
            <p className="text-center text-white/25 text-[10px] mt-3">
              {hotseat
                ? 'Local 2-player game only. No accounts, no network play, no blockchain — just cards on a table.'
                : "You play as Player 1. The opponent's deck is chosen at random, and the built-in AI controls them."}
            </p>
          </div>
        )}

        {view === 'simulated' && (
          <div>
            <BackButton onClick={() => setView('main')} />
            <div className="flex gap-6 flex-wrap justify-center">
              <FactionPicker label="Deck A" value={p1} onChange={setP1} />
              <FactionPicker label="Deck B" value={p2} onChange={setP2} />
            </div>
            <div className="mt-4">
              <O2Selector value={o2Amount} onChange={setO2Amount} />
            </div>
            <button
              type="button"
              onClick={() => {
                playSfx('ui.confirm');
                startNewGame(p1, p2, false, true, false, undefined, o2Amount);
              }}
              onMouseEnter={() => playSfx('ui.hover')}
              className="mt-6 w-full py-3 rounded-md font-bold tracking-widest text-black bg-gradient-to-r from-fuchsia-400 to-cyan-300 hover:brightness-110 transition-all"
            >
              START SIMULATED MATCH
            </button>
            <p className="text-center text-white/25 text-[10px] mt-3">
              Both decks are AI-controlled. Sit back and watch the match play out.
            </p>
          </div>
        )}

        {view === 'locker' && (
          <div>
            <BackButton onClick={() => setView('main')} />
            <LockerMenu />
          </div>
        )}

        {view === 'coin-flip' && (
          <div className="flex flex-col items-center gap-0 -mx-8 -my-4">
            {/* Commit 48 - the canvas top is toss headroom (empty at rest);
                title and controls overlap into the transparent canvas so the
                idle layout is tight while the arc keeps its full runway. */}
            <div className="text-center relative z-10 -mb-[110px] pt-2">
              <div className="text-[11px] uppercase tracking-widest text-white/40 mb-1">Coin Flip</div>
              <div className="text-lg font-black text-fuchsia-300">
                {coinStage === 'calling' && 'Call it in the air'}
                {coinStage === 'flipping' && 'Flipping...'}
                {coinStage === 'result' && (wonCall ? 'You called it!' : 'Not this time.')}
              </div>
            </div>

            {/* Commit 47 - the coin's canvas runs edge-to-edge on the menu
                card (-mx-8 escapes the card padding; 446 = card inner width
                including it), and taller, so neither the toss arc nor the
                bloom can ever clip against a canvas boundary. */}
            <CoinFlip3D
              width={446}
              height={560}
              skinFilter={coinSkin.filter}
              flipId={flipId}
              flipTo={(coinResult ?? null) as CoinFace | null}
              onLanded={handleCoinLanded}
            />

            {coinStage === 'calling' && (
              <div className="flex gap-4 relative z-10 -mt-[72px] pb-2">
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

            {coinStage === 'result' && called && coinResult && (
              <div className="text-center flex flex-col items-center gap-3 relative z-10 -mt-[88px] pb-2">
                <div className="text-xs text-white/60">
                  You called <span className="font-bold text-white/90">{called}</span>, it landed on{' '}
                  <span className="font-bold text-white/90">{coinResult}</span>.
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
                  <div className="text-[11px] text-white/40 italic">The opponent won the toss and is deciding...</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
