'use client';

import type { ApexDef, GameState } from '@/types/game';
import { getPreviewAttackDamage, getAttackOutcomePreview } from '@/game/rules';
import { getCardDef } from '@/data/cards';

interface CombatControlsProps {
  apexDef: ApexDef | null;
  state: GameState;
  attackerInstanceId: string | null;
  availableSync: number;
  hasAttacked: boolean;
  selectedAttackId: string | null;
  onChooseAttack: (attackId: string) => void;
  onCancel: () => void;
  awaitingTarget: boolean;
}

export default function CombatControls({
  apexDef,
  state,
  attackerInstanceId,
  availableSync,
  hasAttacked,
  selectedAttackId,
  onChooseAttack,
  onCancel,
  awaitingTarget,
}: CombatControlsProps) {
  if (!apexDef) {
    // The "select an Apex to attack with" guidance is already covered by the
    // more compact phasePrompt text above the board (Commit 29) - this used to
    // duplicate that in its own bordered/padded box, which was real, reported
    // visual clutter (two boxes saying almost the same thing, one of them
    // pushing the Equip flap out of view below it).
    return null;
  }

  return (
    <div className="panel-3d rounded-lg border border-orange-500/40 bg-[#05050a] p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold text-orange-300">{apexDef.name} — choose an attack</div>
        <button type="button" onClick={onCancel} className="text-[10px] text-white/40 hover:text-white/80">
          cancel
        </button>
      </div>
      {hasAttacked ? (
        <div className="text-xs text-white/40 italic">This Apex has already attacked this turn.</div>
      ) : awaitingTarget ? (
        <div>
          <div className="text-xs text-yellow-300 animate-pulse mb-2">
            Now click an enemy Apex (or confirm direct O2 attack) to target.
          </div>
          {attackerInstanceId && selectedAttackId && (
            <OutcomePreviewList state={state} attackerInstanceId={attackerInstanceId} attackId={selectedAttackId} />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {apexDef.attacks.map((atk) => {
            const affordable = atk.syncCost <= availableSync;
            const preview = attackerInstanceId ? getPreviewAttackDamage(state, attackerInstanceId, atk.id) : null;
            const isModified = !!preview && preview.modifiedDamage !== preview.baseDamage;
            const dmgColorClass = isModified ? (preview!.modifiedDamage > preview!.baseDamage ? 'text-emerald-300' : 'text-red-300') : '';
            return (
              <div
                key={atk.id}
                className={`btn-3d rounded border text-[11px] transition-colors ${
                  selectedAttackId === atk.id
                    ? 'border-yellow-300 bg-yellow-300/10 text-yellow-200'
                    : affordable
                    ? 'border-orange-400/50 text-orange-200'
                    : 'border-white/10 text-white/25'
                }`}
              >
                <button
                  type="button"
                  disabled={!affordable}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    const scrollY = window.scrollY;
                    onChooseAttack(atk.id);
                    requestAnimationFrame(() => {
                      if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: 'auto' });
                    });
                  }}
                  className={`w-full text-left px-2 py-1.5 ${affordable ? 'hover:bg-orange-400/10 cursor-pointer' : 'cursor-not-allowed'}`}
                >
                  <div className="font-bold flex items-center justify-between gap-1">
                    <span>
                      [{atk.syncCost} Sync] {atk.name}
                    </span>
                    {preview && <span className={`font-mono shrink-0 ${dmgColorClass}`}>{preview.modifiedDamage}</span>}
                  </div>
                </button>
                {preview && preview.modifiers.length > 0 && (
                  <details className="px-2 pb-1 -mt-1 opacity-80">
                    <summary className="cursor-pointer text-[9px] text-white/40 hover:text-white/70">details</summary>
                    <div className="mt-0.5 space-y-0.5">
                      <div className="text-white/50">{preview.baseDamage} base</div>
                      {preview.modifiers.map((mod, i) => (
                        <div key={i} className={mod.amount >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                          {mod.amount >= 0 ? '+' : ''}
                          {mod.amount} {mod.label}
                        </div>
                      ))}
                      <div className="text-white/50">= {preview.modifiedDamage} final</div>
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OutcomePreviewList({
  state,
  attackerInstanceId,
  attackId,
}: {
  state: GameState;
  attackerInstanceId: string;
  attackId: string;
}) {
  const attackerHit = Object.entries(state.players).find(([, p]) => p.apexSlots.some((a) => a?.instanceId === attackerInstanceId));
  if (!attackerHit) return null;
  const [attackerPlayerId] = attackerHit;
  const opponentId = attackerPlayerId === 'player1' ? 'player2' : 'player1';
  const opponent = state.players[opponentId];
  const enemyApexes = opponent.apexSlots.filter(Boolean);

  if (enemyApexes.length === 0) {
    const preview = getAttackOutcomePreview(state, attackerInstanceId, attackId);
    if (!preview) return null;
    return (
      <div className="panel-3d rounded border border-yellow-400/30 bg-[#05050a] p-2 text-[10px] space-y-0.5">
        <div className="font-bold text-yellow-200">Direct O2 attack</div>
        <div>Final damage: {preview.finalDamage}</div>
        <div>Expected O2 loss: {preview.o2Loss}</div>
      </div>
    );
  }

  return (
    <div className="panel-3d rounded border border-yellow-400/30 bg-[#05050a] px-2 py-1.5 text-[10px] flex items-center gap-3 flex-wrap w-fit max-w-full mx-auto">
      {enemyApexes.map((apex) => {
        if (!apex) return null;
        const name = getCardDef(apex.defId).name;
        const preview = getAttackOutcomePreview(state, attackerInstanceId, attackId, apex.instanceId);
        if (!preview) return null;
        return (
          <div key={apex.instanceId} className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-yellow-200 font-bold">→ {name}:</span>
            <span className="font-mono">{preview.finalDamage} dmg / {preview.targetDef} DEF</span>
            {preview.willDestroy ? (
              <span className="text-red-300 font-bold">
                Destroys{preview.overflow > 0 ? ` (${preview.overflow} ovf \u2192 ${preview.o2Loss} O2)` : ''}
              </span>
            ) : (
              <span className="text-white/50">Survives</span>
            )}
            {preview.apexBreakRewardWouldTrigger && <span className="text-fuchsia-300">+1 Mom</span>}
          </div>
        );
      })}
    </div>
  );
}
