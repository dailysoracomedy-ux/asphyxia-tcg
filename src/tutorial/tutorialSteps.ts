import type { GameState, ApexDef, PlayerId } from '@/types/game';
import { getCardDef } from '@/data/cards';
import {
  useGameStore,
  tutorialEnsureFinishingBlow,
  tutorialEnsureReactReady,
  tutorialRunScriptedOpponentTurn,
  tutorialRunFullyScriptedTurn,
} from '@/store/gameStore';
import { useTutorialStore } from '@/store/tutorialStore';
import { createInstance } from '@/data/decks';

/**
 * Commit 29.17 - the tutorial's second major pivot, and a deliberate
 * simplification requested directly: "Just purely scripted with Continue on
 * each step. The logic will move the tutorial along. The ONLY player
 * interaction will be moving to the next step after reading."
 *
 * Every prior version of this tutorial (29.1 through 29.16) kept some amount
 * of real player interaction - clicking the highlighted card, choosing an
 * attack, playing a React in a real response window - gated by a system that
 * checked whether the game's actual state matched what the current step
 * expected. Each fix in that lineage was real and verified, but the
 * fundamental shape of the problem never went away: any moment where the
 * player's own clicks and the tutorial's own step tracking could drift apart
 * (a step transitioning while still mid-turn, a response window opening
 * earlier than expected, a recovered Apex not being the one a step assumed)
 * was a new way for the same class of bug to resurface.
 *
 * This version has no such surface at all. Every single action - the
 * player's own card plays and attacks included, not just the opponent's -
 * is a hardcoded sequence of real store-action calls
 * (tutorialRunFullyScriptedTurn / tutorialRunScriptedOpponentTurn in
 * gameStore.ts), fired from each step's onEnter. The player's only input,
 * anywhere in the whole tutorial, is clicking Continue once they're done
 * reading. There is no gating logic left to drift out of sync with, because
 * there's no player-driven game action left to gate.
 */

/** How much to slow ceremony/AI-decision timing during a tutorial match -
 *  reuses AI vs AI Showcase's speed-scaling mechanism entirely (see
 *  GameBoard.tsx's tutorial-pacing effect). Independent of the scripted
 *  sequences' own step delays (SCRIPTED_OPPONENT_STEP_DELAY_MS in
 *  gameStore.ts) - this specifically controls how long combat VFX/ceremony
 *  banners stay visible, so a new player watching a scripted sequence has
 *  time to actually see what happened. */
export const TUTORIAL_PACING_MULTIPLIER = 2.6;

export interface TutorialStep {
  id: string;
  title: string;
  text: string | ((state: GameState) => string);
  /** Fires once, the instant this step becomes active. Performs the entire
   *  scripted action for this step - both players' moves are handled this
   *  way now, not just the opponent's. Absent for pure explanation-only
   *  steps with nothing to actually do (the welcome screen, brief recaps
   *  between beats). */
  onEnter?: () => void;
}

function oneSyncAttackFor(playerId: PlayerId): { attackerDefId: string; attackId: string } | null {
  const state = useGameStore.getState();
  const apex = state.players[playerId].apexSlots.find(Boolean);
  if (!apex) return null;
  const def = getCardDef(apex.defId) as ApexDef;
  const attack = def.attacks.find((a) => a.syncCost === 1);
  if (!attack) return null;
  return { attackerDefId: apex.defId, attackId: attack.id };
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to ASPHYXIA',
    text: 'O2 is your life total. If your O2 hits 0, you lose. Your goal: break through enemy Apexes and reduce your opponent\u2019s O2 to 0. This walkthrough plays every move out for you so you can focus on what each card does - in a real match, you drag cards to where they belong and drop them to play. Click Continue after reading each step to move on.',
  },
  {
    id: 'play-apex',
    title: 'Playing an Apex',
    text: 'This walkthrough drags Street-Beast into the Apex slot for you (normally you\u2019d drag it there yourself). Apexes are your main fighters - they attack, defend, and protect your O2.',
    onEnter: () => tutorialRunFullyScriptedTurn('player1', [{ kind: 'advanceToMain' }, { kind: 'playApex', defId: 'nu-street-beast' }]),
  },
  {
    id: 'play-engine',
    title: 'Playing an Engine',
    text: 'Next, dragging Dead Battery into an Engine slot for you (normally your own drag too). Engines provide Sync during Combat - more Sync unlocks bigger attacks.',
    onEnter: () => tutorialRunFullyScriptedTurn('player1', [{ kind: 'playSupport', defId: 'nu-dead-battery' }]),
  },
  {
    id: 'enter-combat',
    title: 'Entering Combat',
    text: 'Moving to Combat Phase (your click, normally). Dead Battery gives 1 Sync during Combat, unlocking Street-Beast\u2019s stronger attack.',
    onEnter: () => tutorialRunFullyScriptedTurn('player1', [{ kind: 'advanceToCombat' }]),
  },
  {
    id: 'first-attack',
    title: 'Attacking',
    text: (s) => {
      const apexBroken = !s.players.player2.apexSlots.some(Boolean);
      return apexBroken
        ? 'Neon Pounce (1 Sync, 500 damage) exactly matches the enemy Apex\u2019s 500 DEF - a clean break. Since no O2 damage was dealt, you gained 1 Momentum from the Apex Break Reward. Momentum fuels Specials and Reacts.'
        : 'Street-Beast attacks with Neon Pounce (normally you\u2019d click the Apex, click the attack, then drag it onto the target). Damage compared to DEF decides the result.';
    },
    onEnter: () => tutorialRunFullyScriptedTurn('player1', [{ kind: 'attack', attackerDefId: 'nu-street-beast', attackId: 'neon-pounce' }]),
  },
  {
    id: 'opponent-turn-1',
    title: 'Watch: the opponent strikes back',
    text: (s) => {
      const destroyed = !s.players.player1.apexSlots.some(Boolean);
      return destroyed
        ? 'The opponent played a new Apex, powered it up, and attacked Street-Beast. The attack (500 damage) exceeded Street-Beast\u2019s 300 DEF by 200 - that excess became overflow O2 damage straight to you. Overflow is how you pressure an opponent even through their own Apex.'
        : 'Watching the opponent recover, power up, and strike back at Street-Beast...';
    },
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
        ? `${name} was automatically recovered from your deck. ASPHYXIA never leaves you with nothing to fight with - if you control no Apex at the start of your turn, one gets played for you, from hand first, then your deck. (If a Rift choice popped up along the way, the game picked +1 Momentum automatically - that\u2019s always a safe, solid choice.)`
        : 'Your Apex was destroyed. At the start of your turn, if you control no Apex, ASPHYXIA recovers one for you automatically.';
    },
    onEnter: () => tutorialRunFullyScriptedTurn('player1', [{ kind: 'advanceToMain' }]),
  },
  {
    id: 'play-equip',
    title: 'Playing an Equip',
    text: 'Dragging Plasma Edge onto your Apex for you now. Equips attach underneath an Apex and upgrade that fighter permanently, staying visible as a flap so both players can track it.',
    onEnter: () => tutorialRunFullyScriptedTurn('player1', [{ kind: 'playEquip', defId: 'nu-plasma-edge' }]),
  },
  {
    id: 'play-special',
    title: 'Playing a Special',
    text: 'Dragging Overclock into the Action Zone for you now - that\u2019s where non-targeted Specials get dropped to play. Specials create powerful one-time effects - only one can be played per turn. Overclock arms your next attack with bonus damage, but costs O2 when it resolves.',
    onEnter: () => tutorialRunFullyScriptedTurn('player1', [{ kind: 'playSpecial', defId: 'nu-overclock' }]),
  },
  {
    id: 'enter-combat-2',
    title: 'Back to Combat',
    text: 'Entering Combat again to deliver a buffed attack - Plasma Edge and Overclock both apply.',
    onEnter: () => tutorialRunFullyScriptedTurn('player1', [{ kind: 'advanceToCombat' }]),
  },
  {
    id: 'buffed-attack',
    title: 'A buffed attack',
    text: 'Your Apex attacks with Plasma Edge\u2019s permanent bonus and Overclock\u2019s one-time bonus both stacked on top - hitting much harder than before and pushing real overflow into the opponent\u2019s O2.',
    onEnter: () => {
      const atk = oneSyncAttackFor('player1');
      if (atk) tutorialRunFullyScriptedTurn('player1', [{ kind: 'attack', attackerDefId: atk.attackerDefId, attackId: atk.attackId }]);
    },
  },
  {
    id: 'react-prep',
    title: 'Reacts respond to key moments',
    text: 'Reacts are played during your opponent\u2019s turn, right as something important happens - usually an attack. In a real match you choose whether to play one; here, this walkthrough plays one for you (Glitch Step) so you can see what it does. Watch what happens next.',
  },
  {
    id: 'opponent-turn-2',
    title: 'Watch: React in action',
    text: (s) => {
      const survived = s.players.player1.apexSlots.some(Boolean);
      return survived
        ? 'The opponent attacked again - 500 damage this time. Glitch Step automatically reduced it by 200, down to 300, which is less than your Apex\u2019s 400 DEF. Your Apex survived an attack that would otherwise have destroyed it. That\u2019s what Reacts are for: surviving, interrupting, or punishing your opponent at exactly the right moment.'
        : 'Watching the opponent attack again - this walkthrough is about to play a React on your behalf...';
    },
    onEnter: () => {
      tutorialEnsureReactReady();
      useTutorialStore.getState().setBusy(true);
      tutorialRunFullyScriptedTurn(
        'player2',
        [
          { kind: 'playApex', defId: 'dw-pale-executioner' },
          { kind: 'advanceToCombat' },
          { kind: 'attack', attackerDefId: 'dw-pale-executioner', attackId: 'surgical-strike' },
        ],
        {
          manageBusy: false,
          onComplete: () => {
            tutorialRunFullyScriptedTurn('player1', [{ kind: 'resolveReact', defId: 'nu-glitch-step' }], {
              manageBusy: false,
              onComplete: () => {
                tutorialRunFullyScriptedTurn('player2', [{ kind: 'endTurn' }], {
                  manageBusy: false,
                  onComplete: () => useTutorialStore.getState().setBusy(false),
                });
              },
            });
          },
        }
      );
    },
  },
  {
    id: 'engine-chain-demo',
    title: 'Chaining an Engine',
    text: 'Dragging a second Engine, Juice-Box, straight onto your Apex for you now - dropping an Ability Engine directly on an Apex (instead of an empty Engine slot) chains it to that Apex immediately. A chained Engine\u2019s effect only benefits the Apex it\u2019s chained to.',
    onEnter: () => {
      const st = useGameStore.getState();
      const apex = st.players.player1.apexSlots.find(Boolean);
      if (!apex) return;
      const card = createInstance('nu-juice-box', 'AbilitySupport');
      useGameStore.setState((s) => ({
        players: { ...s.players, player1: { ...s.players.player1, hand: [...s.players.player1.hand, card] } },
      }));
      useTutorialStore.getState().setBusy(true);
      setTimeout(() => {
        // Direct call, not tutorialRunFullyScriptedTurn's 'playSupport'
        // action - that action never accepts a chain target at all (it's
        // built for the ordinary unchained-play case), so it can't express
        // "play this chained" no matter what. This is a real, deliberate
        // in-play state change (chaining), so the same direct-call pattern
        // the unchain/swap demo steps already use is exactly right here too.
        useGameStore.getState().playSupportCard(card.instanceId, undefined, apex.instanceId);
        useTutorialStore.getState().setBusy(false);
      }, 700);
    },
  },
  {
    id: 'engine-unchain-demo',
    title: 'Unchaining an Engine',
    text: 'Clicking that same Engine for you now - clicking a chained Ability Engine unchains it directly (no dragging needed for this one). Click an unchained Engine again to re-chain it to a different Apex.',
    onEnter: () => {
      useTutorialStore.getState().setBusy(true);
      setTimeout(() => {
        const st = useGameStore.getState();
        const chained = st.players.player1.supportSlots.find((s) => s?.defId === 'nu-juice-box' && s.chainedApexId);
        if (chained) useGameStore.getState().unchainSupport(chained.instanceId);
        useTutorialStore.getState().setBusy(false);
      }, 700);
    },
  },
  {
    id: 'equip-swap-demo',
    title: 'Swapping an Equip',
    text: 'Dragging a second Equip, Smog Jacket, onto your already-equipped Apex for you now - dropping a new Equip directly onto an Apex that already has one swaps it: the old Equip returns to hand, the new one attaches.',
    onEnter: () => {
      const st = useGameStore.getState();
      const apex = st.players.player1.apexSlots.find((a) => a?.equip);
      if (!apex) return;
      const card = createInstance('nu-smog-jacket', 'Equip');
      useGameStore.setState((s) => ({
        players: { ...s.players, player1: { ...s.players.player1, hand: [...s.players.player1.hand, card] } },
      }));
      useTutorialStore.getState().setBusy(true);
      setTimeout(() => {
        useGameStore.getState().equipSwap(apex.instanceId, card.instanceId);
        useTutorialStore.getState().setBusy(false);
      }, 700);
    },
  },
  {
    id: 'finishing-blow',
    title: 'The finishing blow',
    text: 'One more attack - Plasma Edge\u2019s bonus alone is enough to push the opponent\u2019s O2 to 0 and win the match.',
    onEnter: () => {
      tutorialEnsureFinishingBlow();
      const atk = oneSyncAttackFor('player1');
      const actions: Parameters<typeof tutorialRunFullyScriptedTurn>[1] = [{ kind: 'advanceToCombat' }];
      if (atk) actions.push({ kind: 'attack', attackerDefId: atk.attackerDefId, attackId: atk.attackId });
      tutorialRunFullyScriptedTurn('player1', actions);
    },
  },
  {
    id: 'win',
    title: 'You win',
    text: 'You protected your O2, built Sync with an Engine, attached an Equip, played a Special, watched a React save your Apex, broke through Apexes, and pushed overflow into enemy O2 for the win. Core loop: play Apexes, power them with Engines, use Sync for bigger attacks, attach Equips, play Specials, respond with Reacts, break Apexes, push overflow into O2, take their last breath.',
  },
];
