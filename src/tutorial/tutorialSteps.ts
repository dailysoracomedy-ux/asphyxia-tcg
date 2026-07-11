import type { GameState } from '@/types/game';
import { tutorialEnsureReactReady, tutorialEnsureFinishingBlow, tutorialRunScriptedOpponentTurn } from '@/store/gameStore';
import { getCardDef } from '@/data/cards';

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
  | { type: 'chooseAttack'; attackId: string; minSyncCost?: never; syncCost?: number } | { type: 'chooseAttack'; minSyncCost: number; attackId?: never; syncCost?: number }
  | { type: 'selectEnemyTarget' } // click the enemy Apex to complete a targeted attack
  | { type: 'selectDirectO2' } // complete a direct-O2 attack (no enemy Apex to target)
  | { type: 'playEquip'; defId: string }
  | { type: 'playSpecial'; defId: string }
  | { type: 'playReact'; defId: string }
  | { type: 'waitForOpponent' } // no player action - watch the opponent's scripted turn
  | { type: 'win' };

/** How much to slow ceremony/AI-decision timing during a tutorial match (Commit
 *  29.3) - reuses AI vs AI Showcase's speed-scaling mechanism entirely (see
 *  GameBoard.tsx's tutorial-pacing effect), just with a value picked for "a new
 *  player watching a one-time scripted walkthrough" rather than "someone
 *  choosing their own comfortable pace for repeated viewing" - noticeably
 *  slower than Showcase's own 2x default, since there's no user-adjustable
 *  slider here to fall back on if it's still too fast. */
export const TUTORIAL_PACING_MULTIPLIER = 2.6;

export interface TutorialStep {
  id: string;
  title: string;
  /** Either a fixed string, or a function of live state - used specifically by
   *  the two "attack the enemy Apex" steps, whose text would otherwise be wrong
   *  whenever the opponent doesn't currently have an Apex in play (a real,
   *  reported scenario - the opponent isn't fully scripted, so this can and does
   *  happen; the attack becomes a direct O2 hit instead of a targeted one). */
  text: string | ((state: GameState) => string);
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
  /** Commit 29.9 - fires once, the instant the tutorial step index becomes this
   *  step (before the player or opponent does anything at this step). Used for
   *  state-safety guarantees the doc explicitly calls for: if a prerequisite
   *  this step needs (a card in hand, enough Momentum) isn't already true -
   *  because of an earlier free choice the player made, like which Rift bonus
   *  to take - fix it here rather than let the step become unplayable. */
  onEnter?: () => void;
  /** Commit 29.13 - for waitForOpponent (watch) steps specifically: once the
   *  watched event is detected, show a Continue button and wait for an
   *  explicit click instead of auto-advancing after the short fixed delay.
   *  Reported directly: overflow damage and Apex recovery are important
   *  teaching moments, not quick mechanical actions, and were displaying and
   *  moving on before there was real time to read them. Action steps (play a
   *  card, choose an attack) still auto-advance without this - the distinction
   *  is "something to read" vs "something to click," not watch-vs-action. */
  requiresContinueAfterWatch?: boolean;
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
    // Commit 29.11 - every "enter Combat" step's autoAdvanceWhen must also check
    // whose turn it actually is, not just the raw phase. The opponent enters
    // their own Combat Phase every turn too - without this check, a step could
    // wrongly auto-advance during the *opponent's* combat, leaving the tutorial
    // stuck on the next (combat-only) step once the opponent's turn ends and
    // the game genuinely falls back to Main Phase for the player's real turn.
    // Confirmed as the real cause of a reported softlock at the finishing-blow
    // step, not assumed.
    autoAdvanceWhen: (s) => s.phase === 'Combat' && s.activePlayerId === 'player1',
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
    text: (s) =>
      s.players.player2.apexSlots.some(Boolean)
        ? 'Choose the enemy Apex as your target. Damage is compared to their DEF - if it meets or exceeds it, the Apex is destroyed.'
        : 'The opponent has no Apex in play right now, so this attack will hit their O2 directly instead - go ahead and declare it.',
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
    autoAdvanceWhen: (s) => !s.players.player1.apexSlots.some(Boolean),
    requiresContinueAfterWatch: true,
    // Commit 29.14 - fully scripted, zero AI. Pale Executioner's Surgical
    // Strike (1 Sync, 500 base damage) against Street-Beast's real 300 DEF is
    // a guaranteed, verified 200 overflow = 2 O2 damage - a real teaching
    // moment with a known outcome, not whatever the AI happened to pick.
    onEnter: () =>
      tutorialRunScriptedOpponentTurn([
        { kind: 'playApex', defId: 'dw-pale-executioner' },
        { kind: 'playSupport', defId: 'dw-reserve-grid' },
        { kind: 'advanceToCombat' },
        { kind: 'attack', attackerDefId: 'dw-pale-executioner', attackId: 'surgical-strike' },
      ]),
  },
  {
    id: 'apex-recovery',
    title: 'Apex recovery',
    text: (s) => {
      const recovered = s.players.player1.apexSlots.find(Boolean);
      const name = recovered ? (getCardDef(recovered.defId) as { name: string }).name : 'a new Apex';
      return recovered
        ? `${name} was automatically recovered from your deck! ASPHYXIA never leaves you with nothing to fight with - if you control no Apex at the start of your turn, one gets played for you, from hand first, then your deck.`
        : 'Your Apex was destroyed. ASPHYXIA never leaves you with nothing to fight with - at the start of your turn, if you control no Apex, one gets recovered automatically, from hand first, then your deck.';
    },
    // Recovery is just as automatic as an opponent's action - the player never
    // clicks anything to make it happen, so this reuses waitForOpponent's
    // auto-detection rather than being an ack step that never even noticed
    // recovery happened (the original reported bug: "during Apex Recovery it
    // still says Continue and should not," when Continue was the ONLY thing
    // shown, forever, since ack steps never auto-advance at all). Commit 29.13
    // adds requiresContinueAfterWatch on top of that fix specifically:
    // detection still happens automatically, but a real Continue click is
    // required afterward rather than auto-advancing after a fixed short delay
    // - reported directly as moving on before there was time to actually read
    // what Apex came back.
    requiredAction: { type: 'waitForOpponent' },
    autoAdvanceWhen: (s) => s.players.player1.apexSlots.some(Boolean),
    requiresContinueAfterWatch: true,
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
    id: 'enter-combat-again',
    title: 'Back to Combat',
    text: 'Overclock is armed. Enter Combat Phase again to deliver the buffed attack.',
    requiredAction: { type: 'advancePhase', phase: 'Combat' },
    highlight: { kind: 'combatPhaseButton' },
    autoAdvanceWhen: (s) => s.phase === 'Combat' && s.activePlayerId === 'player1',
  },
  {
    id: 'buffed-attack',
    title: 'Attack with your buffed Apex',
    text: 'Attack the enemy Apex. This attack includes your Plasma Edge and Overclock bonuses - it should hit much harder than before.',
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
    text: (s) =>
      s.players.player2.apexSlots.some(Boolean)
        ? 'Choose the enemy Apex. Watch the overflow O2 damage - that\u2019s how you pressure an opponent toward 0.'
        : 'The opponent has no Apex in play right now, so this attack will hit their O2 directly instead - go ahead and declare it.',
    requiredAction: { type: 'selectEnemyTarget' },
    highlight: { kind: 'enemyApex' },
    // The actual Step 13 fix: without this, a direct O2 hit (which happens
    // automatically and skips target-selection entirely whenever the opponent
    // has no Apex - see chooseAttack in GameBoard.tsx) had no way to ever
    // satisfy this step's requiredAction, since selectEnemyTarget gating only
    // ever fires from the target-selection path, which a direct hit never
    // enters. Reported directly: "I can't attack with buffed Apex... can't
    // proceed from there."
    autoAdvanceWhen: (s) => s.players.player1.apexSlots.some((a) => a?.hasAttacked),
  },
  {
    id: 'react-window',
    title: 'React to the opponent',
    text: 'Your opponent is attacking. This is a Response Window - you may play a React right now. Play Glitch Step to reduce the incoming damage by 200.',
    requiredAction: { type: 'playReact', defId: 'nu-glitch-step' },
    highlight: { kind: 'handCard', defId: 'nu-glitch-step' },
    autoAdvanceWhen: (s) => s.pendingResponseQueue.length === 0 && s.log.some((l) => l.message.includes('Glitch Step')),
    // Commit 29.14 - fully scripted, zero AI. The second Pale Executioner
    // (guaranteed available - see the deck-priority comment in gameStore.ts)
    // uses the same verified Surgical Strike (500 base) against Riot Runner's
    // real 400 DEF - Glitch Step's -200 makes this a genuine 300 damage,
    // survivable; without it, 500 exceeds 400 DEF and would destroy it. Reserve
    // Grid from the first scripted turn is still in play, so no need to play
    // another Engine here.
    onEnter: () => {
      tutorialEnsureReactReady();
      tutorialRunScriptedOpponentTurn(
        [
          { kind: 'playApex', defId: 'dw-pale-executioner' },
          { kind: 'advanceToCombat' },
          { kind: 'attack', attackerDefId: 'dw-pale-executioner', attackId: 'surgical-strike' },
        ],
        { expectsPlayerResponse: true }
      );
    },
  },
  {
    id: 'react-success',
    title: 'Nice save',
    text: 'Glitch Step reduced the attack before it landed. Reacts let you survive, interrupt, or punish your opponent during key moments.',
    requiredAction: { type: 'ack' },
  },
  {
    id: 'enter-combat-final',
    title: 'Finish them',
    text: 'Your opponent is nearly out of O2. Enter Combat one more time to finish the match.',
    requiredAction: { type: 'advancePhase', phase: 'Combat' },
    highlight: { kind: 'combatPhaseButton' },
    autoAdvanceWhen: (s) => s.phase === 'Combat' && s.activePlayerId === 'player1',
    onEnter: () => tutorialEnsureFinishingBlow(),
  },
  {
    id: 'finishing-blow',
    title: 'Deliver the finishing blow',
    text: (s) => {
      const attacker = s.players.player1.apexSlots.find(Boolean);
      const name = attacker ? (getCardDef(attacker.defId) as { name: string }).name : 'your Apex';
      return `Click ${name} to attack.`;
    },
    requiredAction: { type: 'selectAttacker' },
    highlight: { kind: 'ownApex' },
  },
  {
    id: 'finishing-blow-choose',
    title: 'Choose a strong attack',
    text: 'Choose an attack that costs at least 1 Sync - that\u2019s enough to finish the job here.',
    // Commit 29.12 - robust to whichever Apex actually made it this far, not
    // hard-coded to one specific card's specific attack. A real, reported
    // cascading failure: if the originally-scripted Apex (Riot Runner) was
    // destroyed and replaced by emergency recovery with a different one
    // (Static Jack), this step's old hard-coded attack id (Mob Charge, unique
    // to Riot Runner) became permanently unsatisfiable - the new Apex simply
    // doesn't have that attack. Every faction's weakest real 1-Sync attack is
    // verified to deal enough damage against the guaranteed-low-DEF, guaranteed-
    // low-O2 opponent set up by tutorialEnsureFinishingBlow, regardless of
    // which Apex or which specific 1-Sync attack the player picks.
    requiredAction: { type: 'chooseAttack', minSyncCost: 1 },
    highlight: { kind: 'ownApex' },
  },
  {
    id: 'finishing-blow-target',
    title: 'Finish the match',
    text: 'Target the enemy Apex. This attack pushes enough overflow into O2 to end the match.',
    requiredAction: { type: 'selectEnemyTarget' },
    highlight: { kind: 'enemyApex' },
  },
  {
    id: 'win',
    title: 'Finish the match',
    text: 'Resolving the finishing blow...',
    requiredAction: { type: 'win' },
    autoAdvanceWhen: (s) => s.status === 'gameover',
  },
];
