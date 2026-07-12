'use client';

import { useState } from 'react';
import { ALL_CARDS } from '@/data/cards';
import { createInstance } from '@/data/decks';
import type { ApexDef, CardDef, Faction } from '@/types/game';
import { factionTheme } from '@/lib/theme';
import { getCardArt } from '@/lib/cardArt';
import ApexCardRenderer from './ApexCardRenderer';
import GenericArtCard from './GenericArtCard';

const FACTIONS: Faction[] = ['Neon Underground', 'Dark White', 'Synth Ascendancy'];
const CARD_W = 240;
const CARD_H = 360;
// Non-Apex art is a different source ratio (1500x2100, 5:7) - sized down a bit since
// there are far more of these per faction (11) than Apexes (4).
const OTHER_CARD_W = 170;
const OTHER_CARD_H = 238;

/**
 * Developer tool for validating card art against every current card (Commit 19's
 * Apex overlay template, plus Commit 20's art for every other type). Uses the exact
 * same renderers the live match UI uses (ApexCardRenderer, GenericArtCard) - there
 * is no separate one-off gallery renderer. Not linked from normal gameplay; reached
 * via the "Developer" button on the main menu.
 */
export default function DevCardGallery({ onBack }: { onBack: () => void }) {
  const [debugZones, setDebugZones] = useState(false);

  const apexCards = ALL_CARDS.filter((c): c is ApexDef => c.type === 'Apex');
  const otherCards = ALL_CARDS.filter((c) => c.type !== 'Apex');

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-fuchsia-300">Developer — Card Gallery</h1>
          <p className="text-xs text-white/40 mt-1">
            Validates card art against every current card. Apex cards use the dynamic overlay template (DEF/attack
            zones tunable below); everything else is art-only, since nothing on those faces changes live.
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

      <h2 className="text-lg font-bold text-white/70 mb-2">Apex (dynamic overlay)</h2>
      {FACTIONS.map((faction) => {
        const theme = factionTheme(faction);
        const cards = apexCards.filter((c) => c.faction === faction);
        return (
          <div key={faction} className="mb-8">
            <h3 className="text-sm font-bold uppercase tracking-widest mb-3" style={{ color: theme.primary }}>
              {faction} ({cards.length})
            </h3>
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

      <h2 className="text-lg font-bold text-white/70 mb-2 mt-4">Engine / Equip / Special / React (art-only)</h2>
      {FACTIONS.map((faction) => {
        const theme = factionTheme(faction);
        const cards = otherCards.filter((c) => c.faction === faction);
        return (
          <div key={faction} className="mb-8">
            <h3 className="text-sm font-bold uppercase tracking-widest mb-3" style={{ color: theme.primary }}>
              {faction} ({cards.length})
            </h3>
            <div className="flex gap-3 flex-wrap">
              {cards.map((def: CardDef) => {
                const hasRealArt = !!getCardArt(def.id);
                return (
                  <div key={def.id} className="flex flex-col items-center gap-1">
                    <div style={{ width: OTHER_CARD_W, height: OTHER_CARD_H }}>
                      {hasRealArt ? (
                        <GenericArtCard defId={def.id} />
                      ) : (
                        <div className="w-full h-full rounded-md border-2 border-white/15 flex items-center justify-center text-[10px] text-white/25 text-center px-2">
                          no art yet
                        </div>
                      )}
                    </div>
                    <div className="text-[9px] text-white/50 text-center max-w-[170px]">
                      {def.name} {hasRealArt ? <span className="text-emerald-400">●</span> : <span className="text-white/25">○</span>}
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
