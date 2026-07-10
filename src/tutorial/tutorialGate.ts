import type { RequiredAction } from './tutorialSteps';

/** Structural match between an attempted action and the tutorial's current
 *  required action - used by GameBoard.tsx's click handlers to decide whether to
 *  proceed or block. `chooseAttack` with attackId 'any' matches any attack id
 *  (used for the buffed-attack step, where any Sync attack is fine since the
 *  bonuses apply regardless of which one is picked). */
export function tutorialActionMatches(attempted: RequiredAction, required: RequiredAction): boolean {
  if (attempted.type !== required.type) return false;
  if (attempted.type === 'playApex' && required.type === 'playApex') return attempted.defId === required.defId;
  if (attempted.type === 'playEngine' && required.type === 'playEngine') return attempted.defId === required.defId;
  if (attempted.type === 'playEquip' && required.type === 'playEquip') return attempted.defId === required.defId;
  if (attempted.type === 'playSpecial' && required.type === 'playSpecial') return attempted.defId === required.defId;
  if (attempted.type === 'playReact' && required.type === 'playReact') return attempted.defId === required.defId;
  if (attempted.type === 'chooseAttack' && required.type === 'chooseAttack') return required.attackId === 'any' || attempted.attackId === required.attackId;
  if (attempted.type === 'advancePhase' && required.type === 'advancePhase') return attempted.phase === required.phase;
  return true; // types matched and there's nothing further to compare (selectAttacker, selectEnemyTarget, etc.)
}

/** Action types whose completion only ever changes local UI `mode` state in
 *  GameBoard.tsx (attackerChosen / attackAwaitingTarget), never anything in the
 *  actual GameState store - so a GameState-watching autoAdvanceWhen check
 *  (TutorialPanel.tsx) has nothing to observe for these, and the tutorial step
 *  needs to be advanced explicitly, right where the gate confirms the action was
 *  allowed. This was a real, reported bug: clicking Street-Beast during the
 *  "choose your attacker" step correctly opened the attack menu (the action
 *  worked), but the tutorial never moved forward, because nothing was watching
 *  for it. Every other action type changes real, persisted state that
 *  autoAdvanceWhen already detects on its own - this list should only ever
 *  contain the exceptions, not become the default path. */
export function tutorialActionNeedsExplicitAdvance(actionType: RequiredAction['type']): boolean {
  return actionType === 'selectAttacker' || actionType === 'chooseAttack';
}
