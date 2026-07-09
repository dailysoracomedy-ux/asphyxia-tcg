'use client';

import { useState } from 'react';
import { ALL_CARDS } from '@/data/cards';
import { createInstance } from '@/data/decks';
import type { ApexDef, Faction } from '@/types/game';
import { factionTheme } from '@/lib/theme';
import { getCardArt } from '@/lib/cardArt';
import ApexCardRenderer from './ApexCardRenderer';

const FACTIONS: Faction[] = ['Neon Underground', 'Dark White', 'Synth Ascendancy'];
const CARD_W = 240;
const CARD_H = 360;

/**
 * Developer tool for validating and tuning the shared Apex overlay template
 * (Commit 19) against every known Apex, with a debug toggle to outline each
 * dynamic zone. Uses the exact same ApexCardRenderer the live match UI uses -
 * there is no separate one-off gallery renderer. Not linked from normal gameplay;
 * reached via the "Developer" button on the main menu.
 */
export default function DevCardGallery({ onBack }: { onBack: () => void }) {
  const [debugZones, setDebugZones] = useState(false);

  const apexCards = ALL_CARDS.filter((c): c is ApexDef => c.type === 'Apex');

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-fuchsia-300">Developer — Apex Card Gallery</h1>
          <p className="text-xs text-white/40 mt-1">
            Validates the shared overlay template (Commit 19) against every current Apex. Cards render with a
            placeholder art background here since no images are mapped yet - real art will render automatically
            once entries are added to <code className="text-cyan-300">lib/cardArt.ts</code>.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={debugZones} onChange={(e) => setDebugZones(e.target.checked)} className="accent-cyan-400 w-4 h-4" />
            Show Apex Overlay Zones
          </label>
          <button type="button" onClick={onBack} className="px-3 py-1.5 rounded border border-white/20 hover:bg-white/10 text-sm">
            ← Back to Menu
          </button>
        </div>
      </div>

      {FACTIONS.map((faction) => {
        const theme = factionTheme(faction);
        const cards = apexCards.filter((c) => c.faction === faction);
        return (
          <div key={faction} className="mb-8">
            <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={{ color: theme.primary }}>
              {faction} ({cards.length})
            </h2>
            <div className="flex gap-4 flex-wrap">
              {cards.map((def) => {
                const instance = createInstance(def.id, 'Apex');
                const hasRealArt = !!getCardArt(def.id);
                return (
                  <div key={def.id} className="flex flex-col items-center gap-1">
                    <div style={{ width: CARD_W, height: CARD_H }}>
                      <ApexCardRenderer
                        instance={instance}
                        effectiveDef={def.baseDef}
                        cardWidth={CARD_W}
                        forceArtPlaceholder={!hasRealArt}
                        debugZones={debugZones}
                      />
                    </div>
                    <div className="text-[10px] text-white/50">
                      {def.name} {hasRealArt ? <span className="text-emerald-400">● art mapped</span> : <span className="text-white/25">○ no art yet</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
