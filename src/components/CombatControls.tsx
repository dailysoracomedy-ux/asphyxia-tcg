'use client';

import type { ApexDef } from '@/types/game';

interface CombatControlsProps {
  apexDef: ApexDef | null;
  availableSync: number;
  hasAttacked: boolean;
  selectedAttackId: string | null;
  onChooseAttack: (attackId: string) => void;
  onCancel: () => void;
  awaitingTarget: boolean;
}

export default function CombatControls({
  apexDef,
  availableSync,
  hasAttacked,
  selectedAttackId,
  onChooseAttack,
  onCancel,
  awaitingTarget,
}: CombatControlsProps) {
  if (!apexDef) {
    return (
      <div className="rounded-lg border border-orange-500/30 bg-black/50 p-3 text-xs text-white/40">
        Select one of your Apexes above to attack with it.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-orange-500/40 bg-black/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold text-orange-300">{apexDef.name} — choose an attack</div>
        <button type="button" onClick={onCancel} className="text-[10px] text-white/40 hover:text-white/80">
          cancel
        </button>
      </div>
      {hasAttacked ? (
        <div className="text-xs text-white/40 italic">This Apex has already attacked this turn.</div>
      ) : awaitingTarget ? (
        <div className="text-xs text-yellow-300 animate-pulse">Now click an enemy Apex (or confirm direct O2 attack) to target.</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {apexDef.attacks.map((atk) => {
            const affordable = atk.syncCost <= availableSync;
            return (
              <button type="button"
                key={atk.id}
                disabled={!affordable}
                onClick={(e) => {
                  e.currentTarget.blur();
                  const scrollY = window.scrollY;
                  onChooseAttack(atk.id);
                  requestAnimationFrame(() => {
                    if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: 'auto' });
                  });
                }}
                className={`text-left px-2 py-1.5 rounded border text-[11px] transition-colors ${
                  selectedAttackId === atk.id
                    ? 'border-yellow-300 bg-yellow-300/10 text-yellow-200'
                    : affordable
                    ? 'border-orange-400/50 hover:bg-orange-400/10 text-orange-200'
                    : 'border-white/10 text-white/25 cursor-not-allowed'
                }`}
              >
                <div className="font-bold">
                  [{atk.syncCost} Sync] {atk.name}
                </div>
                <div className="opacity-80">{atk.description}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
