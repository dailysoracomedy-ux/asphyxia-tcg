'use client';

import { useState } from 'react';
import type { Faction } from '@/types/game';
import { useGameStore } from '@/store/gameStore';
import { factionTheme } from '@/lib/theme';
import { BUILD_VERSION } from '@/lib/version';

const FACTIONS: Faction[] = ['Neon Underground', 'Dark White', 'Synth Ascendancy'];

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
            <button type="button"
              key={f}
              onClick={() => onChange(f)}
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

export default function NewGameMenu({ onOpenDeveloper }: { onOpenDeveloper?: () => void }) {
  const startNewGame = useGameStore((s) => s.startNewGame);
  const [p1, setP1] = useState<Faction>('Neon Underground');
  const [p2, setP2] = useState<Faction>('Dark White');
  const [vsAI, setVsAI] = useState(true);

  return (
    <div className="min-h-screen flex items-center justify-center scanlines">
      <div className="max-w-3xl w-full mx-4 rounded-xl border border-cyan-500/30 bg-black/70 p-8 shadow-[0_0_40px_rgba(34,211,238,0.15)]">
        <h1 className="text-4xl font-black text-center mb-1 tracking-tight">
          <span className="text-fuchsia-400 text-shadow-glow">ASPHYXIA</span>
        </h1>
        <p className="text-center text-white/40 text-xs tracking-[0.3em] mb-8">v0.2.1 · LOCAL HOTSEAT PROTOTYPE</p>

        <div className="text-center -mt-6 mb-6">
          <span className="inline-block px-3 py-1 rounded-full border border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300 text-[10px] font-mono tracking-widest">
            {BUILD_VERSION}
          </span>
        </div>

        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="text-xs uppercase tracking-widest text-white/40 mr-2">Mode</span>
          <button
            type="button"
            onClick={() => setVsAI(true)}
            className={`px-3 py-1.5 rounded-md text-xs font-bold border-2 transition-all ${
              vsAI ? 'border-fuchsia-400 text-fuchsia-200 bg-fuchsia-400/10' : 'border-white/15 text-white/40 hover:opacity-80'
            }`}
          >
            Single Player
          </button>
          <button
            type="button"
            onClick={() => setVsAI(false)}
            className={`px-3 py-1.5 rounded-md text-xs font-bold border-2 transition-all ${
              !vsAI ? 'border-cyan-400 text-cyan-200 bg-cyan-400/10' : 'border-white/15 text-white/40 hover:opacity-80'
            }`}
          >
            2-Player
          </button>
        </div>

        <div className="flex gap-6 flex-wrap justify-center">
          <FactionPicker label="Player 1" value={p1} onChange={setP1} />
          <FactionPicker label={vsAI ? 'Player 2 (AI)' : 'Player 2'} value={p2} onChange={setP2} />
        </div>

        <button type="button"
          onClick={() => startNewGame(p1, p2, vsAI)}
          className="mt-8 w-full py-3 rounded-md font-bold tracking-widest text-black bg-gradient-to-r from-fuchsia-400 to-cyan-300 hover:brightness-110 transition-all"
        >
          START NEW GAME
        </button>

        <p className="text-center text-white/25 text-[10px] mt-4">
          {vsAI
            ? 'You play as Player 1. The built-in AI controls Player 2 and takes its turns automatically.'
            : 'Local 2-player game only. No accounts, no network play, no blockchain — just cards on a table.'}
        </p>

        {onOpenDeveloper && (
          <button
            type="button"
            onClick={onOpenDeveloper}
            className="block mx-auto mt-3 text-[10px] text-white/25 hover:text-white/50 underline"
          >
            Developer — Apex Card Gallery
          </button>
        )}
      </div>
    </div>
  );
}
