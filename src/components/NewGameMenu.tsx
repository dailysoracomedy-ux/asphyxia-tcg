'use client';

import { useState } from 'react';
import type { Faction } from '@/types/game';
import { useGameStore } from '@/store/gameStore';
import { factionTheme } from '@/lib/theme';
import { BUILD_VERSION } from '@/lib/version';
import { useTutorialStore } from '@/store/tutorialStore';
import AudioSettingsControl from '@/audio/AudioSettingsControl';
import { playSfx } from '@/audio/sfx';

const FACTIONS: Faction[] = ['Neon Underground', 'Dark White', 'Synth Ascendancy'];

function randomFaction(): Faction {
  return FACTIONS[Math.floor(Math.random() * FACTIONS.length)];
}

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
    <div className="flex-1 min-w-[220px]">
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
              className={`text-left px-3 py-2 rounded-md border-2 transition-all ${active ? 'scale-[1.02]' : 'opacity-60 hover:opacity-90'}`}
              style={{
                borderColor: theme.border,
                background: theme.bg,
                boxShadow: active ? `0 0 14px ${theme.primary}` : 'none',
                color: theme.text,
              }}
            >
              <div className="font-bold" style={{ color: theme.primary }}>
                {f}
              </div>
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
}: {
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
      className={`group w-full py-4 rounded-lg border-2 font-bold tracking-widest text-lg transition-all hover:scale-[1.02] hover:brightness-110 ${colorClass} ${glowColorClass}`}
    >
      {label}
      <div className="text-[10px] font-normal tracking-normal opacity-60 mt-0.5 normal-case">{sublabel}</div>
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

type MenuView = 'main' | 'new-game' | 'simulated';

export default function NewGameMenu({ onOpenDeveloper }: { onOpenDeveloper?: () => void }) {
  const startNewGame = useGameStore((s) => s.startNewGame);
  const [view, setView] = useState<MenuView>('main');
  const [p1, setP1] = useState<Faction>('Neon Underground');
  const [p2, setP2] = useState<Faction>('Dark White');
  const [hotseat, setHotseat] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center scanlines">
      <div className="max-w-md w-full mx-4 rounded-xl border border-cyan-500/30 bg-black/70 p-8 shadow-[0_0_40px_rgba(34,211,238,0.15)]">
        {/* Commit 33 - the real Asphyxia logo, replacing the plain text header.
            Transparent PNG built for a dark background - fits the card's own
            black backdrop with no extra framing needed. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/asphyxia-logo.png" alt="ASPHYXIA" className="w-full max-w-[280px] mx-auto mb-2 select-none pointer-events-none" draggable={false} />

        <div className="text-center mb-6">
          <span className="inline-block px-3 py-1 rounded-full border border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300 text-[10px] font-mono tracking-widest">
            {BUILD_VERSION}
          </span>
        </div>

        <div className="flex justify-center mb-6">
          <AudioSettingsControl />
        </div>

        {view === 'main' && (
          <div className="flex flex-col gap-3">
            <MenuButton
              label="New Game"
              sublabel="Pick your deck. Your opponent's is a surprise."
              colorClass="border-fuchsia-400/60 text-fuchsia-200 bg-fuchsia-400/10"
              glowColorClass="hover:shadow-[0_0_20px_rgba(232,121,249,0.4)]"
              onClick={() => setView('new-game')}
            />
            <MenuButton
              label="Learn To Play"
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
              sublabel="Watch two AI decks of your choice fight it out."
              colorClass="border-cyan-400/60 text-cyan-200 bg-cyan-400/10"
              glowColorClass="hover:shadow-[0_0_20px_rgba(34,211,238,0.4)]"
              onClick={() => setView('simulated')}
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

            <button
              type="button"
              onClick={() => {
                playSfx('ui.confirm');
                startNewGame(p1, hotseat ? p2 : randomFaction(), !hotseat);
              }}
              onMouseEnter={() => playSfx('ui.hover')}
              className="mt-6 w-full py-3 rounded-md font-bold tracking-widest text-black bg-gradient-to-r from-fuchsia-400 to-cyan-300 hover:brightness-110 transition-all"
            >
              START
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
            <button
              type="button"
              onClick={() => {
                playSfx('ui.confirm');
                startNewGame(p1, p2, false, true);
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
      </div>
    </div>
  );
}
