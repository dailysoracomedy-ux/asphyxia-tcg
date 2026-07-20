import type { GameState } from '@/types/game';
import {
  useGameStore,
  tutorialEnsureFinishingBlow,
  tutorialEnsureReactReady,
  tutorialSetupCivilWarBehind,
  tutorialRunScriptedOpponentTurn,
} from '@/store/gameStore';

/**
 * Commit 31 - the tutorial's third major pivot, reversing Commit 29.17's
 * "purely scripted, zero interaction" design per direct request: this should
 * feel like the real game with training wheels on, not a slideshow of the
 * game playing itself. Every player-side action here is a real,
 * player-driven game action (real drag-and-drop, a real response window, a
 * real Rift choice, the real attack selector) - see GuidedAction below and
 * GameBoard.tsx's tutorialGate, which is the single place every gated
 * interaction checks through.
 *
 * What's still scripted, deliberately: the OPPONENT's turns (the player
 * doesn't control the opponent, so there's nothing to "guide" there - see
 * tutorialRunScriptedOpponentTurn, unchanged from the prior tutorial
 * architecture and still real, validated game actions under the hood, just
 * with the opponent's choices hardcoded), and a handful of direct board-state
 * setups (tutorialEnsureFinishingBlow, tutorialSetupCivilWarBehind) that
 * guarantee a specific teaching moment actually happens rather than leaving
 * it to chance - the same established pattern this file has always used,
 * not a new kind of scripting.
 */

export const TUTORIAL_PACING_MULTIPLIER = 2.6;

/** Describes the one real player action a guided step is waiting on. See
 *  GameBoard.tsx's tutorialGate for how each kind gets enforced, and
 *  tutorialHighlight.ts for how each kind decides what to highlight. */
export type GuidedAction =
  | { kind: 'playApex'; defId: string }
  | { kind: 'playEngine'; defId: string }
  | { kind: 'playEquip'; defId: string }
  | { kind: 'playSpecial'; defId: string }
  | { kind: 'playReact'; defId: string }
  | { kind: 'riftChoice'; pick: 'momentum' | 'damage' }
  | { kind: 'declareAttack' }
  | { kind: 'selectAttack'; syncCost: number }
  | { kind: 'selectTarget' }
  | { kind: 'selectSpecialTarget' };

export interface TutorialStep {
  id: string;
  title: string;
  text: string | ((state: GameState) => string);
  /** Fires once, the instant this step becomes active. Used for opponent
   *  turns and direct setup - never for the player's own guided action,
   *  which always waits for a real click/drag instead. */
  onEnter?: () => void;
  /** Present for steps requiring one specific real player action. Absent for
   *  pure explanation beats, which show a Continue button instead (per spec:
   *  Continue is never used for a real gameplay action). */
  guided?: GuidedAction;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'play-apex',
    title: 'Your Opening Hand',
    text: 'This is your opening hand. Let\u2019s start by playing an Apex onto your board.',
    guided: { kind: 'playApex', defId: 'nu-street-beast' },
  },
  {
    id: 'play-engine-1',
    title: 'Play an Engine',
    text: 'Great! Now play an Engine to power your Apex. Engines provide Sync, which unlocks bigger attacks.',
    guided: { kind: 'playEngine', defId: 'nu-dead-battery' },
  },
  {
    id: 'play-equip',
    title: 'Play an Equip',
    text: 'Now play an Equip. Play Smog Jacket onto your Apex to strengthen your defense and help protect your O2 from overflow damage.',
    guided: { kind: 'playEquip', defId: 'nu-smog-jacket' },
  },
  {
    id: 'play-special',
    title: 'Play a Special',
    text: 'Now play a Special into the Action Zone to activate its effect.',
    guided: { kind: 'playSpecial', defId: 'nu-overclock' },
  },
  {
    id: 'special-target',
    title: 'Choose a Target',
    text: 'Now click your Apex to apply Overclock to it.',
    guided: { kind: 'selectSpecialTarget' },
  },
  {
    id: 'enemy-attack-setup',
    title: 'Incoming Attack',
    text: 'Your opponent is about to attack. Reacts can be played in response to enemy attacks or enemy plays.',
    // No `guided` here - this is a genuine explanation beat, so it shows a
    // Continue button. The opponent's attack itself is triggered by the
    // NEXT step's onEnter (below), not this one - see that step's own note.
  },
  {
    id: 'play-react',
    title: 'Play Your React',
    text: 'Play your React card now to Negate the attack. Reacts cost Momentum to play \u2014 Glitch Step spends 1 \u2014 so Momentum is what buys you these clutch defensive moments.',
    guided: { kind: 'playReact', defId: 'nu-glitch-step' },
    // Fires the instant this step becomes active (i.e. the moment Continue
    // was clicked on the previous step) - guarantees the player has Glitch
    // Step and enough Momentum, sets up the Civil War Rift condition for the
    // step after this one, then declares the opponent's real attack.
    // expectsPlayerResponse: true is critical here - it's the actual
    // softlock-safety mechanism: the scripted sequence will NOT auto-pass
    // the response window it just opened, and will not call endTurn() until
    // the real response queue is genuinely empty - i.e. until the player's
    // own click on the highlighted React resolves it for real. baton-crush
    // (200 damage) paired with Glitch Step's -200 reduction is a genuine
    // full negation (200 - 200 = 0), not a partial one, matching "Negate"
    // exactly rather than just softening the hit.
    onEnter: () => {
      tutorialEnsureReactReady();
      tutorialSetupCivilWarBehind();
      useGameStore.getState().endTurn();
      tutorialRunScriptedOpponentTurn([{ kind: 'attack', attackerDefId: 'dw-enforcer-v4', attackId: 'baton-crush' }], { expectsPlayerResponse: true });
    },
  },
  {
    id: 'rift-choice',
    title: 'Rift Space: Civil War',
    text: 'You\u2019re behind on O2, which triggers this Rift Space perk. Take the Momentum \u2014 it refills what Glitch Step spent, and it\u2019s the fuel for Reacts and Overdrive attacks. Momentum caps at 3, so bank it when the battle offers it.',
    guided: { kind: 'riftChoice', pick: 'momentum' },
  },
  {
    id: 'void-intro',
    title: 'The Void',
    // Placed AFTER the Rift choice deliberately: the Civil War prompt fires
    // the instant player1's turn starts, and CivilWarPrompt only gates its
    // buttons while the ACTIVE step is riftChoice - an explanation beat
    // sitting between play-react and rift-choice would leave that prompt
    // ungated (free clicks, no step advance = softlock). Here the response
    // queue is guaranteed clear, so a pure Continue beat is safe.
    text: 'Notice your VOID counter \u2014 Glitch Step went there after it resolved. The Void is where destroyed and spent cards go, but nothing is lost forever: when your Deck runs out, your whole Void shuffles back in. That\u2019s a Void Recycle. In ASPHYXIA you never lose by running out of cards \u2014 only by running out of air.',
  },
  {
    id: 'play-engine-2',
    title: 'A Second Engine',
    // Commit 31 real fix: a player can only play one Support per turn (a
    // real, existing rule this tutorial never changes). This is now a fresh
    // turn (right after the Rift choice, which fires at the start of a new
    // turn), so a second Engine here is genuinely legal - unlike the
    // earlier version of this step, which tried to play a second Engine on
    // the SAME turn as the first and was silently rejected by the real game
    // rule every time.
    text: 'Great! Now play a second Engine to boost your Sync and unlock a bigger attack.',
    guided: { kind: 'playEngine', defId: 'nu-juice-box' },
  },
  {
    id: 'declare-attack',
    title: 'Declare Your Attack',
    text: 'Now click your Apex to declare an attack.',
    guided: { kind: 'declareAttack' },
    // Guarantees the finishing blow works regardless of exactly how combat
    // has gone so far - same established pattern the prior tutorial always
    // used for this exact moment, not new scripting.
    onEnter: () => tutorialEnsureFinishingBlow(),
  },
  {
    id: 'choose-attack',
    title: 'Choose Your Attack',
    text: 'With two Engines on your board you have 2 Sync \u2014 enough for Backstreet Maul. Pick it and see what that second Engine just bought you.',
    // 2 Sync (Backstreet Maul) - per direct request, the second Engine's
    // payoff should be SHOWN, not just described. The old comment here
    // claimed same-turn Engines don't grant Sync until next turn; that was
    // stale - computeAvailableSync counts filled Support slots when Combat
    // begins (and playSupportCard even bumps availableSync immediately), so
    // both Engines genuinely yield 2 Sync on this very turn. The gate and
    // the AttackSelectorModal highlight both derive from this syncCost, so
    // this one value flips both to Backstreet Maul.
    guided: { kind: 'selectAttack', syncCost: 2 },
  },
  {
    id: 'select-target',
    title: 'Finish the Game',
    text: 'Attack to deplete your opponent\u2019s O2. You win when your opponent\u2019s O2 reaches 0.',
    guided: { kind: 'selectTarget' },
  },
  {
    id: 'win',
    title: 'You Win!',
    text: 'You reduced your opponent\u2019s O2 to 0. That\u2019s the core of ASPHYXIA: play Apexes, power them with Engines, strengthen them with Equips, use Specials and Reacts at the right time, and fight for the last breath of Earth.',
  },
];
