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

/**
 * Commit 54.1 - condensed to ONE row (wrapping to two at most on narrow
 * viewports). The previous stacked layout - header line, instruction line,
 * and its own preview list, PLUS GameBoard's separate AttackOutcomePreview
 * box showing the same numbers again - overflowed the mid-field row's 104px
 * cap and produced a scroll box ("my only gripe"). Now: attacker name,
 * the attack buttons (or the targeting instruction + inline outcome chips),
 * and cancel all live on a single flex-wrap line; the duplicate GameBoard
 * preview box is gone, and the mid-field row no longer scrolls at all.
 * Per-attack modifier breakdowns moved from a <details> disclosure into the
 * button's title tooltip - same information, zero vertical cost.
 */
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
    // more compact phasePrompt text above the board (Commit 29).
    return null;
  }

  return (
    <div className="panel-3d rounded-lg border border-orange-500/40 bg-[#05050a] px-3 py-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap w-fit max-w-full mx-auto text-[11px]">
      <span className="font-bold text-orange-300 shrink-0">{apexDef.name}</span>
      {hasAttacked ? (
        <span className="text-white/40 italic">has already attacked this turn.</span>
      ) : awaitingTarget ? (
        <>
          <span className="text-yellow-300 animate-pulse">click an enemy Apex (or their O2 panel) to target</span>
          {attackerInstanceId && selectedAttackId && (
            <InlineOutcomePreviews state={state} attackerInstanceId={attackerInstanceId} attackId={selectedAttackId} />
          )}
        </>
      ) : (
        <>
          {apexDef.attacks.map((atk) => {
            const affordable = atk.syncCost <= availableSync;
            const preview = attackerInstanceId ? getPreviewAttackDamage(state, attackerInstanceId, atk.id) : null;
            const isModified = !!preview && preview.modifiedDamage !== preview.baseDamage;
            const dmgColorClass = isModified ? (preview!.modifiedDamage > preview!.baseDamage ? 'text-emerald-300' : 'text-red-300') : 'text-white/70';
            const tooltip =
              preview && preview.modifiers.length > 0
                ? `${preview.baseDamage} base ${preview.modifiers
                    .map((m) => `${m.amount >= 0 ? '+' : ''}${m.amount} ${m.label}`)
                    .join(' ')} = ${preview.modifiedDamage}`
                : undefined;
            return (
              <button
                key={atk.id}
                type="button"
                disabled={!affordable}
                title={tooltip}
                onClick={(e) => {
                  e.currentTarget.blur();
                  const scrollY = window.scrollY;
                  onChooseAttack(atk.id);
                  requestAnimationFrame(() => {
                    if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: 'auto' });
                  });
                }}
                className={`btn-3d rounded border px-2 py-1 whitespace-nowrap transition-colors ${
                  selectedAttackId === atk.id
                    ? 'border-yellow-300 bg-yellow-300/10 text-yellow-200'
                    : affordable
                    ? 'border-orange-400/50 text-orange-200 hover:bg-orange-400/10 cursor-pointer'
                    : 'border-white/10 text-white/25 cursor-not-allowed'
                }`}
              >
                <span className="font-bold">
                  [{atk.syncCost}] {atk.name}
                </span>{' '}
                {preview && <span className={`font-mono ${dmgColorClass}`}>{preview.modifiedDamage}</span>}
              </button>
            );
          })}
        </>
      )}
      <button type="button" onClick={onCancel} className="text-[10px] text-white/40 hover:text-white/80 shrink-0">
        cancel
      </button>
    </div>
  );
}

/** Bare inline outcome chips - no panel of their own; they ride the single
 *  CombatControls row (the row's flex-wrap handles narrow viewports). */
function InlineOutcomePreviews({
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
  const enemyApexes = state.players[opponentId].apexSlots.filter(Boolean);

  if (enemyApexes.length === 0) {
    const preview = getAttackOutcomePreview(state, attackerInstanceId, attackId);
    if (!preview) return null;
    return (
      <span className="whitespace-nowrap">
        <span className="text-yellow-200 font-bold">Direct O2:</span>{' '}
        <span className="font-mono">{preview.finalDamage} dmg</span>{' '}
        <span className="text-red-300 font-bold">-{preview.o2Loss} O2</span>
      </span>
    );
  }

  return (
    <>
      {enemyApexes.map((apex) => {
        if (!apex) return null;
        const name = getCardDef(apex.defId).name;
        const preview = getAttackOutcomePreview(state, attackerInstanceId, attackId, apex.instanceId);
        if (!preview) return null;
        return (
          <span key={apex.instanceId} className="whitespace-nowrap">
            <span className="text-yellow-200 font-bold">→ {name}:</span>{' '}
            <span className="font-mono">{preview.finalDamage}/{preview.targetDef}</span>{' '}
            {preview.willDestroy ? (
              <span className="text-red-300 font-bold">
                Destroys{preview.overflow > 0 ? ` (-${preview.o2Loss} O2)` : ''}
              </span>
            ) : (
              <span className="text-white/50">Survives</span>
            )}
            {preview.apexBreakRewardWouldTrigger && <span className="text-fuchsia-300"> +1 Mom</span>}
          </span>
        );
      })}
    </>
  );
}
