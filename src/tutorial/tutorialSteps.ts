import type { GameState } from '@/types/game';

/**
 * Commit 29.1 - a genuinely locked, gated Learn To Play script, replacing 29's
 * "real match with a floating tips panel" (reported, correctly, as giving free
 * reign without guidance). Every step with a `requiredAction` blocks every other
 * player action until that exact action happens - GameBoard.tsx's click handlers
 * check `isActionAllowedInTutorial` before doing anything else whenever
 * state.tutorialMode is true.
 *
 * Card names below are real, verified against the actual card data (not
 * fabricated for the tutorial) - Street-Beast (300 DEF, Neon Pounce 500 dmg for
 * 1 Sync), Dead Battery, Plasma Edge, Overclock, Glitch Step, Feedback Loop,
 * Static Jack, Riot Runner all exist exactly as named.
 */

export type RequiredAction =
  | { type: 'ack' } // no game action needed - just Next/Begin
  | { type: 'playApex'; defId: string }
  | { type: 'playEngine'; defId: string }
  | { type: 'advancePhase'; phase: 'Combat' }
  | { type: 'selectAttacker' } // click your own Apex during Combat
  | { type: 'chooseAttack'; attackId: string }
  | { type: 'selectEnemyTarget' } // click the enemy Apex to complete a targeted attack
  | { type: 'selectDirectO2' } // complete a direct-O2 attack (no enemy Apex to target)
  | { type: 'playEquip'; defId: string }
  | { type: 'playSpecial'; defId: string }
  | { type: 'playReact'; defId: string }
  | { type: 'waitForOpponent' } // no player action - watch the opponent's scripted turn
  | { type: 'win' };

export interface TutorialStep {
  id: string;
  title: string;
  text: string;
  requiredAction: RequiredAction;
  /** What to visually highlight while this step is active - read by
   *  useTutorialHighlight() in the relevant components. */
  highlight?:
    | { kind: 'handCard'; defId: string }
    | { kind: 'ownApex' }
    | { kind: 'enemyApex' }
    | { kind: 'combatPhaseButton' }
    | { kind: 'attackChoice'; attackId: string }
    | { kind: 'o2Display' }
    | { kind: 'momentumDisplay' }
    | { kind: 'riftArea' };
  /** Auto-advance check for waitForOpponent steps and the final win step - these
   *  aren't "blocked until the right click" so much as "wait for this to become
   *  true," since nothing the player clicks is the actual completion signal. */
  autoAdvanceWhen?: (state: GameState) => boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to ASPHYXIA',
    text: 'O2 is your life total. If your O2 hits 0, you lose. Your goal: break through enemy Apexes and reduce your opponent\u2019s O2 to 0.',
    requiredAction: { type: 'ack' },
    highlight: { kind: 'o2Display' },
  },
  {
    id: 'play-apex',
    title: 'Play an Apex',
    text: 'Play Street-Beast from your hand. Apexes are your main fighters - they attack, defend, and protect your O2.',
    requiredAction: { type: 'playApex', defId: 'nu-street-beast' },
    highlight: { kind: 'handCard', defId: 'nu-street-beast' },
    autoAdvanceWhen: (s) => s.players.player1.apexSlots.some((a) => a?.defId === 'nu-street-beast'),
  },
  {
    id: 'play-engine',
    title: 'Play an Engine',
    text: 'Good - Street-Beast is now protecting your O2. Now play Dead Battery. Engines provide Sync during Combat, and more Sync unlocks stronger attacks.',
    requiredAction: { type: 'playEngine', defId: 'nu-dead-battery' },
    highlight: { kind: 'handCard', defId: 'nu-dead-battery' },
    autoAdvanceWhen: (s) => s.players.player1.supportSlots.some((sup) => sup?.defId === 'nu-dead-battery'),
  },
  {
    id: 'enter-combat',
    title: 'Enter Combat',
    text: 'Dead Battery gives you +1 Sync during Combat. You\u2019re ready to attack - enter Combat Phase.',
    requiredAction: { type: 'advancePhase', phase: 'Combat' },
    highlight: { kind: 'combatPhaseButton' },
    autoAdvanceWhen: (s) => s.phase === 'Combat',
  },
  {
    id: 'select-attacker',
    title: 'Choose your attacker',
    text: 'Click Street-Beast to see its attacks. Stronger attacks need more Sync - you have 1 Sync available.',
    requiredAction: { type: 'selectAttacker' },
    highlight: { kind: 'ownApex' },
  },
  {
    id: 'choose-attack',
    title: 'Choose Neon Pounce',
    text: 'Choose Neon Pounce - it costs 1 Sync and hits much harder than your free attack.',
    requiredAction: { type: 'chooseAttack', attackId: 'neon-pounce' },
    highlight: { kind: 'attackChoice', attackId: 'neon-pounce' },
  },
  {
    id: 'attack-target',
    title: 'Attack the enemy Apex',
    text: 'Choose the enemy Apex as your target. Damage is compared to their DEF - if it meets or exceeds it, the Apex is destroyed.',
    requiredAction: { type: 'selectEnemyTarget' },
    highlight: { kind: 'enemyApex' },
    autoAdvanceWhen: (s) => s.players.player1.apexSlots.some((a) => a?.hasAttacked),
  },
  {
    id: 'momentum-reward',
    title: 'Apex Break Reward',
    text: 'You destroyed the enemy Apex. Since no O2 damage was dealt this attack, you gained 1 Momentum from the Apex Break Reward - Momentum fuels powerful cards and effects.',
    requiredAction: { type: 'ack' },
    highlight: { kind: 'momentumDisplay' },
  },
  {
    id: 'opponent-overflow',
    title: 'Watch: overflow damage',
    text: 'Your opponent is taking their turn and will attack Street-Beast. If your Apex is destroyed, any damage beyond its DEF becomes overflow O2 damage straight to you.',
    requiredAction: { type: 'waitForOpponent' },
    highlight: { kind: 'o2Display' },
    autoAdvanceWhen: (s) => !s.players.player1.apexSlots.some(Boolean) && s.activePlayerId === 'player1',
  },
  {
    id: 'apex-recovery',
    title: 'Apex recovery',
    text: 'Your Apex was destroyed - but you\u2019re never stuck with nothing to fight with. At the start of your turn with no Apex in play, ASPHYXIA recovers one for you automatically, first from hand, then from your deck.',
    requiredAction: { type: 'ack' },
    autoAdvanceWhen: (s) => s.players.player1.apexSlots.some(Boolean),
  },
  {
    id: 'play-equip',
    title: 'Play an Equip',
    text: 'Play Plasma Edge onto your Apex. Equips attach underneath and upgrade that fighter, staying visible as a flap so both players can track it.',
    requiredAction: { type: 'playEquip', defId: 'nu-plasma-edge' },
    highlight: { kind: 'handCard', defId: 'nu-plasma-edge' },
    autoAdvanceWhen: (s) => s.players.player1.apexSlots.some((a) => a?.equip?.defId === 'nu-plasma-edge'),
  },
  {
    id: 'play-special',
    title: 'Play a Special',
    text: 'Play Overclock. Specials create powerful one-time effects - you can only play one per turn. Overclock arms your next attack with bonus damage, but costs O2 when it resolves.',
    requiredAction: { type: 'playSpecial', defId: 'nu-overclock' },
    highlight: { kind: 'handCard', defId: 'nu-overclock' },
    autoAdvanceWhen: (s) => s.players.player1.turnFlags.specialsPlayedThisTurn > 0,
  },
  {
    id: 'buffed-attack',
    title: 'Attack with your buffed Apex',
    text: 'Enter Combat and attack the enemy Apex. This attack includes your Plasma Edge and Overclock bonuses - it should hit much harder than before.',
    requiredAction: { type: 'selectAttacker' },
    highlight: { kind: 'ownApex' },
  },
  {
    id: 'buffed-attack-choose',
    title: 'Choose your strongest attack',
    text: 'Pick the attack that costs Sync - your bonuses apply to any attack you make.',
    requiredAction: { type: 'chooseAttack', attackId: 'any' },
    highlight: { kind: 'ownApex' },
  },
  {
    id: 'buffed-attack-target',
    title: 'Finish the target',
    text: 'Choose the enemy Apex. Watch the overflow O2 damage - that\u2019s how you pressure an opponent toward 0.',
    requiredAction: { type: 'selectEnemyTarget' },
    highlight: { kind: 'enemyApex' },
  },
  {
    id: 'react-window',
    title: 'React to the opponent',
    text: 'Your opponent is attacking. This is a Response Window - you may play a React right now. Play Glitch Step to reduce the incoming damage by 200.',
    requiredAction: { type: 'playReact', defId: 'nu-glitch-step' },
    highlight: { kind: 'handCard', defId: 'nu-glitch-step' },
    autoAdvanceWhen: (s) => s.pendingResponseQueue.length === 0 && s.log.some((l) => l.message.includes('Glitch Step')),
  },
  {
    id: 'win',
    title: 'Finish the match',
    text: 'Your opponent is low on O2. Keep attacking to finish the job and win the match.',
    requiredAction: { type: 'win' },
    autoAdvanceWhen: (s) => s.status === 'gameover',
  },
];
