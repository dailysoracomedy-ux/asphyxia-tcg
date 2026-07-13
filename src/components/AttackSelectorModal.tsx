'use client';

import { useEffect } from 'react';
import type { ApexDef, CardInstance, GameState } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { getPreviewAttackDamage } from '@/game/rules';
import Card from './Card';
import { TUTORIAL_STEPS } from '@/tutorial/tutorialSteps';
import { useTutorialStore } from '@/store/tutorialStore';

/**
 * Commit 30.4 introduced this as a popup with the card next to a separate row
 * of attack buttons underneath. Commit 30.6 folds that button row directly
 * onto the card face instead - hovering an attack row on the card itself
 * highlights it (a light backing bar, matching the requested reference
 * design), and clicking that same row selects it. See ApexOverlayLayer's own
 * attackSelectMode doc for how the row hit-zones/hover state work; this
 * component is now just the popup shell around the card.
 *
 * Commit 30.6 also softened the backdrop from a flat black screen to a
 * vignette - the board stays visible and in color behind the popup (just
 * dimmed toward the edges via a radial gradient), so this reads as "the game
 * brought this card into focus" rather than "a separate screen opened over
 * the game." The backdrop is still a real, full-screen click target (click
 * anywhere outside the card to cancel) and still sits above everything else
 * in the stacking order, so the rest of the board stays fully inert while
 * this is open - unchanged from before, just less visually heavy-handed
 * about it.
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
  const attackPreviews: Record<string, NonNullable<ReturnType<typeof getPreviewAttackDamage>>> = {};
  for (const atk of def.attacks) {
    const preview = getPreviewAttackDamage(state, attacker.instanceId, atk.id);
    if (preview) attackPreviews[atk.id] = preview;
  }
  const affordableAttackIds = new Set(def.attacks.filter((a) => a.syncCost <= availableSync).map((a) => a.id));

  const tutorialStep = useTutorialStore((s) => s.step);
  const guided = state.tutorialMode ? TUTORIAL_STEPS[tutorialStep]?.guided : undefined;
  const tutorialHighlightAttackId =
    guided?.kind === 'selectAttack' ? def.attacks.find((a) => a.syncCost === guided.syncCost)?.id ?? null : null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4"
      style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.75) 100%)', backdropFilter: 'blur(1.5px)' }}
      onClick={onCancel}
    >
      <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="drop-shadow-[0_25px_70px_rgba(0,0,0,0.85)] rounded-md ring-2 ring-emerald-300/40">
          <Card
            instance={attacker}
            size="xl"
            disableHoverPreview
            attackSelectMode
            affordableAttackIds={affordableAttackIds}
            onSelectAttack={onChooseAttack}
            attackPreviews={attackPreviews}
            tutorialHighlightAttackId={tutorialHighlightAttackId}
          />
        </div>
        <div className="text-[11px] uppercase tracking-widest text-white/60">Hover an attack, click to select</div>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded border border-white/20 text-white/60 text-xs hover:bg-white/10">
          Cancel
        </button>
      </div>
    </div>
  );
}
