'use client';

import { useEffect } from 'react';
import type { ApexDef, CardInstance, GameState } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { getPreviewAttackDamage } from '@/game/rules';
import Card from './Card';

/**
 * Commit 30.4 - the new attack UI, replacing the old inline CombatControls
 * strip: clicking a ready Apex now "blows it up" into this centered popup -
 * the card itself, large, with its real attacks listed as clickable options
 * right underneath it. Requested directly as the intended feel; this is
 * purely a presentation layer over the exact same chooseAttack function the
 * click flow already used before Commit 30's drag experiment - no new
 * attack-resolution logic here, just a much bigger, more direct picker.
 */
export default function AttackSelectorModal({
  attacker,
  state,
  availableSync,
  onChooseAttack,
  onCancel,
}: {
  attacker: CardInstance;
  state: GameState;
  availableSync: number;
  onChooseAttack: (attackId: string) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const def = getCardDef(attacker.defId) as ApexDef;
  const attackPreviews: Record<string, ReturnType<typeof getPreviewAttackDamage>> = {};
  for (const atk of def.attacks) {
    attackPreviews[atk.id] = getPreviewAttackDamage(state, attacker.instanceId, atk.id);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="drop-shadow-[0_20px_60px_rgba(0,0,0,0.9)] scale-125 sm:scale-150">
          <Card instance={attacker} size="xl" disableHoverPreview />
        </div>
        <div className="text-[11px] uppercase tracking-widest text-white/50">Choose an attack</div>
        <div className="flex flex-wrap items-center justify-center gap-2 max-w-md">
          {def.attacks.map((atk) => {
            const affordable = atk.syncCost <= availableSync;
            const preview = attackPreviews[atk.id];
            return (
              <button
                type="button"
                key={atk.id}
                disabled={!affordable}
                onClick={() => onChooseAttack(atk.id)}
                className={`px-3 py-2 rounded-lg border text-xs font-bold transition-colors ${
                  affordable
                    ? 'border-emerald-400/60 text-emerald-200 hover:bg-emerald-400/10 hover:border-emerald-300'
                    : 'border-white/10 text-white/25 cursor-not-allowed'
                }`}
              >
                <div>{atk.name}</div>
                <div className="text-[10px] font-normal opacity-80">
                  {atk.syncCost} Sync &middot; {preview?.modifiedDamage ?? atk.baseDamage} dmg
                </div>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded border border-white/20 text-white/60 text-xs hover:bg-white/10">
          Cancel
        </button>
      </div>
    </div>
  );
}
