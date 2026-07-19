import { create } from 'zustand';
import { produce } from 'immer';
import type {
  ApexDef,
  AbilitySupportDef,
  AttackTriggerData,
  CardInstance,
  DestroyTriggerData,
  Faction,
  GameState,
  O2DamageTriggerData,
  Phase,
  PlayedCardEventData,
  PlayerId,
  PlayerState,
  ReactionDef,
  ResponseEvent,
  SpecialDef,
  TriggerData,
} from '@/types/game';
import { freshTurnFlags } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { buildStarterDeck, shuffle, createInstance } from '@/data/decks';
import { determineRiftSpace } from '@/game/rifts';
import { useAnimationStore, CEREMONY_MS, type VisualEvent } from './animationStore';
import { useTutorialStore } from './tutorialStore';
import {
  DIRECT_O2_CAP_PER_TURN,
  MAX_ABILITY_SUPPORTS,
  STARTING_HAND_SIZE,
  STARTING_O2,
  createHelpers,
  destroyApexFn,
  directDamageToO2Loss,
  overflowToO2Loss,
  drawCardsFn,
  findApexAnywhere,
  getChainedSupportFor,
  getEffectiveDef,
  getEligibleResponses,
  getOverdriveEligibility,
  getPreviewAttackDamage,
  gainMomentumFn,
  logMsg,
  loseMomentumFn,
  otherPlayer,
  pruneExpiredModifiers,
  applyTempDefBuffFn,
  computeAvailableSync,
  MAX_SYNC,
  addCounterFn,
} from '@/game/rules';

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

// --------------------------------------------------------------------------
// Response choice types (what the UI sends back into resolveResponse)
// --------------------------------------------------------------------------

export type ResponseChoice =
  | { type: 'pass' }
  | { type: 'reaction'; cardInstanceId: string }
  | { type: 'negate'; cardInstanceId: string }
  | { type: 'humanError'; pick: 'momentum' | 'damage' }
  | { type: 'civilWar'; pick: 'momentum' | 'damage' };

function freshPlayer(id: PlayerId, faction: Faction, o2Override?: number): PlayerState {
  return {
    id,
    faction,
    deck: [],
    hand: [],
    voidZone: [],
    apexSlots: [null, null],
    supportSlots: [null, null, null],
    o2: o2Override ?? STARTING_O2,
    momentum: 0,
    availableSync: 0,
    turnFlags: freshTurnFlags(),
    pendingAttackBonus: 0,
    pendingTargetedAttackBonus: null,
    reserveGridShield: 0,
    lockedSupportInstanceId: null,
  };
}

function initialState(): GameState {
  return {
    status: 'menu',
    players: {
      player1: freshPlayer('player1', 'Neon Underground'),
      player2: freshPlayer('player2', 'Dark White'),
    },
    activePlayerId: 'player1',
    firstPlayerId: null,
    turnNumber: 0,
    phase: 'Start',
    riftSpace: null,
    log: [],
    winnerId: null,
    pendingResponseQueue: [],
    isFirstTurnOverall: false,
    selectedFactions: { player1: null, player2: null },
    openingApexSelectionPlayerId: null,
    reconfigureAwaitingPlay: false,
    startPhasePending: false,
    debugMode: false,
    gameOverReason: null,
    vsAI: false,
  };
}

// ==========================================================================
// Helper predicates
// ==========================================================================

// ==========================================================================
// Response-window eligibility (Engine Tag System)
//
// All eligibility checks funnel through getEligibleResponses (rules.ts), which
// looks only at each card's engine tags (INSTANT + the matching ON_* trigger
// tag) plus Momentum/target legality - never card names or ad-hoc type checks.
// ==========================================================================

/** Checks eligibility for a response event. Only logs the "none found" debug trail when
 *  debugMode is on - in normal play this check happens on nearly every attack/play and
 *  would otherwise spam the log with lines that mean nothing to a player. */
function checkEligibleResponses(draft: GameState, respondingPlayerId: PlayerId, event: ResponseEvent): CardInstance[] {
  const eligible = getEligibleResponses(draft, respondingPlayerId, event);
  if (eligible.length === 0 && draft.debugMode) {
    logMsg(draft, 'Checked for eligible responses: none found.', 'response');
  }
  return eligible;
}

/** Opens a Response Window (pushing to the queue) only if eligible responses exist.
 *  Returns true if a window was opened (caller should stop and wait), false otherwise. */
function maybeOpenResponseWindow(
  draft: GameState,
  respondingPlayerId: PlayerId,
  event: ResponseEvent,
  pushItem: (eligibleCount: number) => void
): boolean {
  const eligible = checkEligibleResponses(draft, respondingPlayerId, event);
  if (eligible.length === 0) return false;
  pushItem(eligible.length);
  logMsg(draft, `Response window opened for ${respondingPlayerId}.`, 'response');
  return true;
}

function playedCardEvent(
  kind: 'SPECIAL_PLAYED' | 'EQUIP_PLAYED' | 'REACTION_PLAYED',
  data: PlayedCardEventData
): ResponseEvent {
  return { kind, data } as ResponseEvent;
}

// ==========================================================================
// Turn structure
// ==========================================================================

function runStartPhase(draft: GameState) {
  const playerId = draft.activePlayerId;
  const player = draft.players[playerId];
  const oppId = otherPlayer(playerId);
  const opp = draft.players[oppId];

  logMsg(draft, `--- Turn ${draft.turnNumber}: ${playerId} (${player.faction}) - Draw Phase ---`, 'phase');

  drawCardsFn(draft, playerId, 1);
  emitVfx({ type: 'CARD_DRAWN', playerId });

  if (draft.riftSpace) {
    switch (draft.riftSpace.id) {
      case 'CivilWar':
        if (player.o2 < opp.o2) {
          logMsg(draft, `Civil War: ${playerId} is behind on O2.`, 'rift');
          draft.pendingResponseQueue.push({ id: newId('cw'), stage: 'civilWarChoice', playerId });
        }
        break;
      case 'ControlConflict':
        if (player.lockedSupportInstanceId) {
          const support = player.supportSlots.find((s) => s?.instanceId === player.lockedSupportInstanceId);
          if (support) support.lockedByControlConflict = false;
          player.lockedSupportInstanceId = null;
          logMsg(draft, 'Control Conflict unlocks the previously locked Support.', 'rift');
        }
        break;
      default:
        break;
    }
  }

  pruneExpiredModifiers(draft);
  if (player.pendingAttackBonus > 0) {
    logMsg(draft, `${playerId}'s primed attack bonus expires unused.`, 'rift');
  }
  player.pendingAttackBonus = 0;
  player.pendingTargetedAttackBonus = null;

  for (const apex of player.apexSlots) {
    if (!apex) continue;
    apex.hasAttacked = false;
    if (apex.attackLockedForTurn !== null && apex.attackLockedForTurn !== undefined && apex.attackLockedForTurn < draft.turnNumber) {
      apex.attackLockedForTurn = null;
    }
  }

  player.turnFlags = freshTurnFlags();
  player.availableSync = 0;

  draft.startPhasePending = false;
}

function maybeTriggerHumanErrorChoice(draft: GameState, playerId: PlayerId) {
  // Human Error rift: only offered when a Special actually resolves - i.e. after any
  // negate window has already been checked/resolved and the Special was NOT negated.
  // Called from both the "no negate window opened" path and the "negate window
  // resolved with a pass" path, so a negated Special never reaches this at all.
  if (draft.riftSpace?.id !== 'HumanError') return;
  const player = draft.players[playerId];
  if (player.turnFlags.specialsPlayedThisTurn !== 1) return;
  draft.pendingResponseQueue.push({ id: newId('he'), stage: 'humanErrorChoice', playerId });
}

function maybeTriggerRecursiveFailureSecondCard(draft: GameState, playerId: PlayerId) {
  if (draft.riftSpace?.id !== 'RecursiveFailure') return;
  const player = draft.players[playerId];
  if (player.turnFlags.cardsPlayedThisTurn !== 2) return;
  if (player.turnFlags.recursiveGlitchPlacedThisTurn) return;
  player.turnFlags.recursiveGlitchPlacedThisTurn = true;
  emitVfx({ type: 'RIFT_TRIGGER', playerId }, 800);
  gainMomentumFn(draft, playerId, 1);
  emitVfx({ type: 'MOMENTUM_GAINED', playerId, label: '+1' });
  const targetApex = player.apexSlots.find(Boolean);
  if (targetApex) {
    addCounterFn(draft, targetApex.instanceId, 'glitch', 1, playerId);
    logMsg(draft, `Recursive Failure places 1 Glitch Counter on ${getCardDef(targetApex.defId).name}.`, 'rift');
  } else {
    logMsg(draft, `Recursive Failure would place a Glitch Counter, but ${playerId} controls no Apex.`, 'rift');
  }
}

function runEndPhase(draft: GameState) {
  const playerId = draft.activePlayerId;
  const player = draft.players[playerId];
  logMsg(draft, `--- ${playerId} - End Phase ---`, 'phase');

  for (const apex of player.apexSlots) {
    if (!apex) continue;
    // Commit 52: clear the "has attacked / used this turn" flag at END of turn
    // so the grayed-out "Used" visual on an attacked Apex clears here rather
    // than lingering until the start of its next turn.
    apex.hasAttacked = false;
    if (apex.pendingEndPhaseDefBuff) {
      applyTempDefBuffFn(draft, apex.instanceId, apex.pendingEndPhaseDefBuff, draft.turnNumber + 1);
      logMsg(draft, `${getCardDef(apex.defId).name} gains +${apex.pendingEndPhaseDefBuff} DEF until the end of the opponent's next turn.`, 'support');
      apex.pendingEndPhaseDefBuff = 0;
    }
    if (apex.pendingEndPhaseProtection) {
      if (!apex.protections) apex.protections = [];
      apex.protections.push({
        id: newId('prot'),
        reduction: apex.pendingEndPhaseProtection,
        expiresAfterTurn: draft.turnNumber + 1,
        label: `-${apex.pendingEndPhaseProtection} incoming dmg`,
      });
      logMsg(draft, `${getCardDef(apex.defId).name} gains protection until the end of the opponent's next turn.`, 'support');
      apex.pendingEndPhaseProtection = 0;
    }
  }

  if (draft.riftSpace?.id === 'RecursiveFailure' && player.turnFlags.cardsPlayedThisTurn <= 2) {
    const candidate = [...player.apexSlots]
      .filter((a): a is CardInstance => !!a)
      .sort((a, b) => (b.counters?.glitch ?? 0) - (a.counters?.glitch ?? 0))[0];
    if (candidate && candidate.counters && candidate.counters.glitch > 0) {
      candidate.counters.glitch -= 1;
      logMsg(draft, `Recursive Failure lets ${getCardDef(candidate.defId).name} shed a Glitch Counter.`, 'rift');
    }
  }

  if (draft.riftSpace?.id === 'WhiteRoomCollapse') {
    for (const pid of ['player1', 'player2'] as const) {
      for (const apex of draft.players[pid].apexSlots) {
        if (apex && (apex.counters?.choke ?? 0) >= 3) {
          apex.counters!.choke -= 1;
          logMsg(draft, `White Room Collapse removes 1 Choke Counter from ${getCardDef(apex.defId).name}.`, 'rift');
        }
      }
    }
  }
}

function advanceToNextTurn(draft: GameState) {
  draft.turnNumber += 1;
  draft.activePlayerId = otherPlayer(draft.activePlayerId);
  draft.phase = 'Start';
  draft.startPhasePending = true;
  draft.isFirstTurnOverall = false;
  draft.reconfigureAwaitingPlay = false;
}

export function searchPileForApex(pile: CardInstance[]): { apex: CardInstance | null; remainder: CardInstance[] } {
  const remainder: CardInstance[] = [];
  let apex: CardInstance | null = null;
  for (const card of pile) {
    if (!apex && card.type === 'Apex') {
      apex = card;
    } else {
      remainder.push(card);
    }
  }
  return { apex, remainder: shuffle(remainder) };
}

/** No-Apex Recovery Rule: if the active player controls zero Apexes at the start of their
 *  Main Phase, force-recover one from hand, then deck, then voidZone (reshuffled in), or
 *  else they lose - this is a safety valve against a permanent no-board death spiral. */
export function maybeRunEmergencyApexDraw(draft: GameState, playerId: PlayerId) {
  const player = draft.players[playerId];
  if (player.apexSlots.some(Boolean)) return; // still controls at least one Apex - nothing to do
  if (draft.tutorialMode && draft.tutorialAwaitingFirstApex && playerId === 'player1') return;
  // Commit 29.15 - the actual root cause of a real, reported bug ("the
  // opponent isn't attacking to play a React card"). Emergency Apex recovery
  // is a normal, automatic rule that fires for *any* player entering Main
  // Phase with zero Apexes - including the fully scripted opponent, who
  // legitimately reaches zero Apexes once their first one is destroyed. It was
  // auto-playing an Apex for player2 before the scripted sequence's own
  // playApex action ever got a chance to run, silently short-circuiting the
  // rest of that turn's script (Reserve Grid never played, the attack action
  // left with nothing further driving it forward). The scripted opponent's
  // Apex placement is always handled directly by
  // tutorialRunScriptedOpponentTurn's own playApex action - normal recovery
  // has nothing legitimate to do for player2 in tutorial mode at all.
  if (draft.tutorialMode && playerId === 'player2') return;

  // Step 1: an Apex in hand must be force-played.
  const handApexIdx = player.hand.findIndex((c) => c.type === 'Apex');
  if (handApexIdx !== -1) {
    const [found] = player.hand.splice(handApexIdx, 1);
    player.apexSlots[0] = found;
    const def = getCardDef(found.defId) as ApexDef;
    if (def.onEnterPlay) def.onEnterPlay({ helpers: createHelpers(draft), ownerId: playerId, apexInstanceId: found.instanceId });
    logMsg(draft, `${playerId} controls no Apex - forced to play ${def.name} from hand into Apex Slot 1.`, 'info');
    return;
  }

  // Step 2: reveal from the Deck until an Apex turns up; everything else is shuffled back in.
  logMsg(draft, `${playerId} controls no Apex and has none in hand - revealing from the Deck.`, 'info');
  let result = searchPileForApex(player.deck);
  player.deck = result.remainder;

  // Step 3: Deck exhausted with no Apex found - Void Recycle, then continue the search.
  if (!result.apex) {
    const voidHasApex = player.voidZone.some((c) => c.type === 'Apex');
    if (voidHasApex) {
      logMsg(draft, `${playerId} has no Apex in hand or Deck.`, 'info');
      logMsg(draft, `Void Recycle: ${playerId} shuffles their Void into their Deck.`, 'rift');
      const combined = shuffle([...player.deck, ...player.voidZone]);
      player.voidZone = [];
      result = searchPileForApex(combined);
      player.deck = result.remainder;
    }
  }

  if (result.apex) {
    player.apexSlots[0] = result.apex;
    const def = getCardDef(result.apex.defId) as ApexDef;
    if (def.onEnterPlay) def.onEnterPlay({ helpers: createHelpers(draft), ownerId: playerId, apexInstanceId: result.apex.instanceId });
    logMsg(draft, `${playerId} finds ${def.name} and plays it into Apex Slot 1.`, 'play');
    return;
  }

  // Step 4: no Apex in hand, Deck, or Void - safety-valve loss.
  draft.status = 'gameover';
  draft.winnerId = otherPlayer(playerId);
  draft.gameOverReason = `${playerId} has no Apex remaining anywhere and loses.`;
  logMsg(draft, `${playerId} has no Apex in hand, Deck, or Void and loses.`, 'win');
}

/** Commit 29.9 - the actual fix for the reported Glitch Step / React timing bug.
 *  Root cause, confirmed by direct testing before writing this fix: the React
 *  step's scripted enemy attack only opens a response window at all if the
 *  player has at least one *eligible* Reaction - Glitch Step needs 1 Momentum
 *  (checkEligibleResponses/maybeOpenResponseWindow correctly require this, and
 *  that check is completely unchanged here). Momentum by that point in the
 *  tutorial isn't fully scripted - it depends on which free choice the player
 *  made at the Civil War/Human Error Rift prompt a few steps earlier (+1
 *  Momentum vs +100 damage), which this tutorial deliberately doesn't force one
 *  way or the other. Picking the damage option leaves Momentum at 0, Glitch
 *  Step becomes ineligible, no response window opens at all, and the attack
 *  just resolves - exactly what was reported ("the AI attacked and hit my Apex
 *  anyway... I could no longer play it"). Called from TutorialPanel's onEnter
 *  the instant the React step becomes active, before the opponent's next turn
 *  ever starts - guarantees the precondition without touching Momentum's actual
 *  rules, the Rift choice's own effect, or anything about normal (non-tutorial)
 *  play. */
export function tutorialEnsureReactReady() {
  useGameStore.setState((st) => {
    if (!st.tutorialMode) return st;
    const player = st.players.player1;
    const hasGlitchStep = player.hand.some((c) => c.defId === 'nu-glitch-step');
    const needsMomentum = player.momentum < 1;
    if (!needsMomentum && hasGlitchStep) return st;
    return {
      players: {
        ...st.players,
        player1: {
          ...player,
          momentum: needsMomentum ? Math.max(player.momentum, 1) : player.momentum,
          hand: hasGlitchStep ? player.hand : [...player.hand, createInstance('nu-glitch-step', 'Reaction')],
        },
      },
    };
  });
}

/** Commit 29.10 / 29.12 - the actual fix for "I can't attack to finish the
 *  game," made robust to whichever Apex actually survives to this point. The
 *  tutorial never actually had a finishing sequence at all - after the React
 *  step, it just waited for `status === 'gameover'` with nothing guiding the
 *  player there and no guarantee the numbers ever lined up. Fixed the same way
 *  every other guarantee in this file works: real combat math, not a
 *  fabricated result - but the exact math has to hold regardless of which real
 *  Apex the player ends up with (29.12: if the originally-scripted Apex was
 *  destroyed and replaced via emergency recovery, whatever Equip was attached
 *  to the destroyed instance is gone too, so the finishing attack can no
 *  longer assume Plasma Edge's +100 is available). Every faction's weakest
 *  real 1-Sync attack is at least 400 base damage (verified directly against
 *  the actual card data) - against Pale Executioner's real 300 DEF, that's a
 *  guaranteed minimum 100 overflow even with zero Equip bonus, which is
 *  exactly enough to finish an opponent already at 1 O2. Setting the opponent
 *  to 1 O2 (not 2) is deliberately the more conservative, worst-case-safe
 *  number - the finishing step itself (see tutorialSteps.ts,
 *  'finishing-blow-choose') requires any attack costing at least 1 Sync,
 *  rather than one specific named attack, for the same reason. */

/** Commit 29.14 - the core mechanism of the tutorial rebuild: a fully scripted
 *  opponent, zero AI decision-making anywhere. Each action here calls the exact
 *  same store actions a human player's own clicks would call
 *  (playApexCard/playSupportCard/declareAttack/endTurn) - the opponent's turn
 *  is real, legal gameplay resolved through the real engine, just with every
 *  choice hardcoded in advance instead of decided by `aiPlayOneMainPhaseAction`
 *  etc. This is why the whole category of guardrail code from 29.9-29.12
 *  (protecting an Apex from an unpredictable attack, guaranteeing a lethal hit
 *  against an unpredictable board state) no longer exists: every attack here
 *  uses a damage value the caller already chose and verified, so there's
 *  nothing left to protect against.
 *
 *  Runs as a self-contained setTimeout chain (not a React effect) so the pacing
 *  is fully under this function's own control, matching the spacing the real
 *  AI driver used to have. Bails out immediately if the game state stops
 *  matching what's expected at any step (turn ended some other way, tutorial
 *  mode turned off, game already over) rather than forcing through a stale
 *  script against a changed board. */
export type ScriptedOpponentAction =
  | { kind: 'playApex'; defId: string }
  | { kind: 'playSupport'; defId: string }
  | { kind: 'advanceToCombat' }
  | { kind: 'attack'; attackerDefId: string; attackId: string }
  | { kind: 'endTurn' };

const SCRIPTED_OPPONENT_STEP_DELAY_MS = 700;

/** Commit 29.18 - incremented every time a fresh tutorial match starts (see
 *  startNewGame below). Each scripted sequence captures this value when it
 *  begins and checks it on every tick - if a Restart happened mid-sequence,
 *  the old sequence's generation no longer matches, and it stops immediately
 *  rather than potentially continuing to act on the fresh game underneath a
 *  tutorial run that has, in fact, already moved on. A real, reported bug
 *  without this: Restart could leave Continue permanently stuck disabled
 *  ("Playing this out...") if a stale sequence's own setBusy calls raced
 *  against the fresh one's reset. */
let tutorialGeneration = 0;

export function tutorialRunScriptedOpponentTurn(actions: ScriptedOpponentAction[], options: { expectsPlayerResponse?: boolean } = {}) {
  let i = 0;
  const generation = tutorialGeneration;
  useTutorialStore.getState().setBusy(true);

  function runNext() {
    const st = useGameStore.getState();
    if (generation !== tutorialGeneration) return;
    // tutorialMode being off is a genuine hard stop - the player has already
    // left this tutorial match entirely (Restart, Exit), so there's nothing
    // left to clean up on its behalf.
    if (!st.tutorialMode) return;
    // The game reaching gameover (the finishing blow landing) or otherwise
    // leaving 'playing' is NOT a reason to silently abandon this sequence
    // without finishing it. A real, reported bug: this used to return here
    // with no further action, which left `busy` stuck true forever once the
    // match ended mid-sequence - Continue never re-enabled, and the tutorial
    // panel never visibly caught up to a game that had, in fact, already been
    // won.
    if (st.status !== 'playing') {
      useTutorialStore.getState().setBusy(false);
      return;
    }
    // NOT a terminal condition - keep retrying. onEnter fires the instant its
    // step becomes active, which can genuinely happen while it's still the
    // player's own turn (their attack resolving sets hasAttacked immediately,
    // well before their turn actually ends via auto-end-turn). A real,
    // confirmed bug: the very first runNext() call used to bail out
    // permanently here with no retry, silently doing nothing for the entire
    // rest of the opponent's turn - the sequence needs to wait for control to
    // actually reach the opponent, not give up because it hasn't yet.
    if (st.activePlayerId !== 'player2') {
      setTimeout(runNext, SCRIPTED_OPPONENT_STEP_DELAY_MS);
      return;
    }

    // Handle the Start Phase (draw) automatically before running any scripted
    // action - every opponent turn needs this regardless of what the script
    // itself calls for, so callers only ever specify what's actually distinct
    // about this particular turn.
    if (st.phase === 'Start' && st.startPhasePending) {
      st.advancePhase('Start');
      setTimeout(runNext, SCRIPTED_OPPONENT_STEP_DELAY_MS);
      return;
    }
    if (st.phase === 'Start' && !st.startPhasePending) {
      st.advancePhase('Main');
      setTimeout(runNext, SCRIPTED_OPPONENT_STEP_DELAY_MS);
      return;
    }

    if (i >= actions.length) {
      // A scripted attack may have opened a response window (the React step)
      // that the player hasn't resolved yet - endTurn() safely no-ops while
      // that's pending, but nothing else would ever retry it, so wait here
      // instead of ending the turn out from under an open response window.
      if (st.pendingResponseQueue.length > 0) {
        if (!options.expectsPlayerResponse) {
          // This scripted turn's attack wasn't meant to open a real response
          // window at all - a real, confirmed risk: the player can
          // legitimately have an eligible Reaction and enough Momentum well
          // before the step that's actually meant to teach it (from Momentum
          // earned several steps earlier). Auto-pass it here rather than
          // showing the player an empty modal with nothing but a Pass button.
          useGameStore.getState().resolveResponse({ type: 'pass' } as never);
        }
        setTimeout(runNext, SCRIPTED_OPPONENT_STEP_DELAY_MS);
        return;
      }
      useTutorialStore.getState().setBusy(false);
      st.endTurn();
      return;
    }
    const action = actions[i];
    i++;

    if (action.kind === 'playApex') {
      const card = st.players.player2.hand.find((c) => c.defId === action.defId);
      if (card) st.playApexCard(card.instanceId);
    } else if (action.kind === 'playSupport') {
      const card = st.players.player2.hand.find((c) => c.defId === action.defId);
      if (card) st.playSupportCard(card.instanceId);
    } else if (action.kind === 'advanceToCombat') {
      st.advancePhase('Combat');
    } else if (action.kind === 'attack') {
      const attacker = st.players.player2.apexSlots.find((a) => a?.defId === action.attackerDefId);
      const target = st.players.player1.apexSlots.find(Boolean);
      if (attacker && target) st.declareAttack(attacker.instanceId, action.attackId, target.instanceId);
    } else if (action.kind === 'endTurn') {
      useTutorialStore.getState().setBusy(false);
      st.endTurn();
      return;
    }
    setTimeout(runNext, SCRIPTED_OPPONENT_STEP_DELAY_MS);
  }

  setTimeout(runNext, SCRIPTED_OPPONENT_STEP_DELAY_MS);
}

/** Commit 29.17 - the tutorial rebuild's second, larger pivot: purely scripted,
 *  zero player interaction beyond clicking Continue to advance. Every single
 *  action for BOTH players - not just the opponent's - is now a hardcoded
 *  sequence of real store-action calls, exactly like
 *  `tutorialRunScriptedOpponentTurn` above but generalized to run for either
 *  player and to cover the full range of actions a tutorial step might need
 *  (Equips, Specials, Rift choices, Reacts), not just combat. Deliberately
 *  built as a new, separate function rather than modifying the proven
 *  opponent-turn runner above - that one already has a real production track
 *  record, and this rewrite doesn't need to risk it to add the new
 *  capabilities player1's now-scripted turns require. */
export type FullyScriptedAction =
  | { kind: 'advanceToMain' }
  | { kind: 'playApex'; defId: string }
  | { kind: 'playSupport'; defId: string }
  | { kind: 'playEquip'; defId: string }
  | { kind: 'playSpecial'; defId: string }
  | { kind: 'advanceToCombat' }
  | { kind: 'attack'; attackerDefId: string; attackId: string }
  | { kind: 'resolveRiftChoice'; pick: 'momentum' | 'damage' }
  | { kind: 'resolveReact'; defId: string }
  | { kind: 'endTurn' };

export function tutorialRunFullyScriptedTurn(
  playerId: PlayerId,
  actions: FullyScriptedAction[],
  options: { onComplete?: () => void; manageBusy?: boolean } = {}
) {
  let i = 0;
  const generation = tutorialGeneration;
  const opponentId: PlayerId = playerId === 'player1' ? 'player2' : 'player1';
  const manageBusy = options.manageBusy ?? true;
  if (manageBusy) useTutorialStore.getState().setBusy(true);
  const finish = () => {
    if (manageBusy) useTutorialStore.getState().setBusy(false);
    options.onComplete?.();
  };

  function runNext() {
    const st = useGameStore.getState();
    if (generation !== tutorialGeneration) return;
    // tutorialMode being off is a genuine hard stop - see
    // tutorialRunScriptedOpponentTurn's identical comment for the full
    // reasoning. The game reaching gameover mid-sequence (the finishing blow
    // landing, most commonly) must still call finish() - a real, reported bug
    // was leaving `busy` stuck true forever in exactly this case, since
    // simply returning here never got the chance to.
    if (!st.tutorialMode) return;
    if (st.status !== 'playing') {
      finish();
      return;
    }

    // Once this run's own actions are exhausted, it must always finish
    // immediately - regardless of whose turn it is or what else might be
    // pending. A real, confirmed bug: this check used to come after the
    // turn-ownership guard below, which also checks for a pending response as
    // part of its own condition. Once i >= actions.length forces "no pending
    // response is this run's business" (see the comment further down), that
    // same signal was wrongly reused by the turn-ownership guard to mean "not
    // my turn yet, keep waiting" - so an exhausted run could get stuck
    // retrying forever instead of ever reaching this branch and calling
    // finish(), even though it had genuinely nothing left to do.
    if (i >= actions.length) {
      finish();
      return;
    }

    // A pending Rift choice or React window belonging to THIS player blocks
    // everything else in the engine until resolved - if the current scripted
    // action isn't specifically here to resolve it, nothing else can proceed,
    // so check for it before anything else on every pass.
    const pending = st.pendingResponseQueue[0];
    const nextAction = actions[i];
    if (pending) {
      const belongsToThisRun =
        (pending.stage === 'civilWarChoice' || pending.stage === 'humanErrorChoice') && pending.playerId === playerId && nextAction?.kind === 'resolveRiftChoice';
      const isReactBeingHandled = pending.stage === 'reactionChoice' && pending.respondingPlayerId === playerId && nextAction?.kind === 'resolveReact';
      if (!belongsToThisRun && !isReactBeingHandled) {
        // Not this run's business to resolve (either it belongs to the other
        // player, entirely automatic elsewhere, or this run's next action
        // isn't actually the resolution step yet) - auto-pass/auto-pick a safe
        // default so a stray eligible response never silently stalls a fully
        // scripted, no-interaction tutorial.
        if (pending.stage === 'civilWarChoice') st.resolveResponse({ type: 'civilWar', pick: 'momentum' });
        else if (pending.stage === 'humanErrorChoice') st.resolveResponse({ type: 'humanError', pick: 'momentum' });
        else if (pending.stage === 'reactionChoice' || pending.stage === 'negateWindow') st.resolveResponse({ type: 'pass' });
        setTimeout(runNext, SCRIPTED_OPPONENT_STEP_DELAY_MS);
        return;
      }
    }

    if (st.activePlayerId !== playerId && !pending) {
      // Not this player's turn yet - keep waiting rather than giving up. See
      // tutorialRunScriptedOpponentTurn's own comment on why this must retry,
      // not bail out permanently, for the exact bug this pattern fixes.
      setTimeout(runNext, SCRIPTED_OPPONENT_STEP_DELAY_MS);
      return;
    }

    if (!pending && st.phase === 'Start' && st.startPhasePending) {
      st.advancePhase('Start');
      setTimeout(runNext, SCRIPTED_OPPONENT_STEP_DELAY_MS);
      return;
    }

    const action = actions[i];
    i++;

    const player = st.players[playerId];
    if (action.kind === 'advanceToMain') {
      st.advancePhase('Main');
    } else if (action.kind === 'playApex') {
      const card = player.hand.find((c) => c.defId === action.defId);
      if (card) st.playApexCard(card.instanceId);
    } else if (action.kind === 'playSupport') {
      const card = player.hand.find((c) => c.defId === action.defId);
      if (card) st.playSupportCard(card.instanceId);
    } else if (action.kind === 'playEquip') {
      const card = player.hand.find((c) => c.defId === action.defId);
      const apex = player.apexSlots.find(Boolean);
      if (card && apex) st.playEquipCard(card.instanceId, apex.instanceId);
    } else if (action.kind === 'playSpecial') {
      const card = player.hand.find((c) => c.defId === action.defId);
      if (card) st.playSpecialCard(card.instanceId);
    } else if (action.kind === 'advanceToCombat') {
      st.advancePhase('Combat');
    } else if (action.kind === 'attack') {
      const attacker = player.apexSlots.find((a) => a?.defId === action.attackerDefId);
      const target = st.players[opponentId].apexSlots.find(Boolean);
      if (attacker && target) st.declareAttack(attacker.instanceId, action.attackId, target.instanceId);
    } else if (action.kind === 'resolveRiftChoice') {
      const item = st.pendingResponseQueue[0];
      if (item?.stage === 'civilWarChoice') st.resolveResponse({ type: 'civilWar', pick: action.pick });
      else if (item?.stage === 'humanErrorChoice') st.resolveResponse({ type: 'humanError', pick: action.pick });
    } else if (action.kind === 'resolveReact') {
      const item = st.pendingResponseQueue[0];
      const reactCard = st.players[playerId].hand.find((c) => c.defId === action.defId);
      if (item?.stage === 'reactionChoice' && reactCard) st.resolveResponse({ type: 'reaction', cardInstanceId: reactCard.instanceId });
    } else if (action.kind === 'endTurn') {
      st.endTurn();
      finish();
      return;
    }
    setTimeout(runNext, SCRIPTED_OPPONENT_STEP_DELAY_MS);
  }

  setTimeout(runNext, SCRIPTED_OPPONENT_STEP_DELAY_MS);
}

/** Commit 31 - directly engineers "player1 is behind on O2" so the Civil War
 *  Rift choice (this tutorial's fixed Neon Underground vs Dark White matchup
 *  always uses Civil War - see determineRiftSpace in game/rifts.ts) triggers
 *  naturally at the start of player1's next turn, rather than leaving it to
 *  chance whether the scripted opponent's attack happened to land enough
 *  real damage. Same established pattern as tutorialEnsureFinishingBlow/
 *  tutorialEnsureReactReady below - a direct, guaranteed setup for a specific
 *  teaching moment, not a change to how the Rift itself works. */
export function tutorialSetupCivilWarBehind() {
  useGameStore.setState((st) => {
    if (!st.tutorialMode) return st;
    return {
      players: {
        ...st.players,
        player1: { ...st.players.player1, o2: 8 },
        player2: { ...st.players.player2, o2: 12 },
      },
    };
  });
}

export function tutorialEnsureFinishingBlow() {
  useGameStore.setState((st) => {
    if (!st.tutorialMode) return st;
    const opponent = st.players.player2;
    return {
      players: {
        ...st.players,
        player2: {
          ...opponent,
          o2: 1,
          apexSlots: [createInstance('dw-pale-executioner', 'Apex'), null],
        },
      },
    };
  });
}

// ==========================================================================
// Attack resolution pipeline
// ==========================================================================

/** Fire a transient visual-only event (Commit 23 game-feel pass). Deliberately a
 *  bare side effect against the separate animation store, not part of the Immer
 *  draft - it never touches game state, so it can't affect save/load, the AI, or
 *  simulations, and a thrown error here would be a bug in this function alone,
 *  never in the actual combat math above it. */
function emitVfx(event: Omit<VisualEvent, 'id' | 'createdAt'>, durationMs?: number) {
  try {
    useAnimationStore.getState().enqueue(event, durationMs);
    const ceremonyMs = CEREMONY_MS[event.type];
    if (ceremonyMs) useAnimationStore.getState().markCeremonyBusy(ceremonyMs);
  } catch {
    // Visual-only - never let an animation-store hiccup affect gameplay.
  }
}

function proceedWithDestruction(draft: GameState, trigger: AttackTriggerData, overflow: number) {
  const helpers = createHelpers(draft);
  const attackerHit = findApexAnywhere(draft, trigger.attackerInstanceId);
  const apexDef = attackerHit ? (getCardDef(attackerHit.apex.defId) as ApexDef) : null;
  const targetHit = findApexAnywhere(draft, trigger.targetInstanceId!)!;
  const destroyedDef = getCardDef(targetHit.apex.defId) as ApexDef;
  const destroyedSlotIndex = draft.players[targetHit.ownerId].apexSlots.findIndex((a) => a?.instanceId === trigger.targetInstanceId);
  // Capture the chained Engine (if any) BEFORE destroyApexFn removes both it and
  // the Apex in one pass (Commit 18.2's Chained Support Destruction rule) - by the
  // time that call returns, this card is already gone from supportSlots, so its
  // own destroy-vfx needs to be emitted from what's known right now.
  const chainedEngine = getChainedSupportFor(draft, targetHit.ownerId, trigger.targetInstanceId!);
  const chainedEngineDef = chainedEngine ? getCardDef(chainedEngine.defId) : null;

  emitVfx(
    {
      type: 'CARD_DESTROYED',
      apexInstanceId: trigger.targetInstanceId,
      faction: destroyedDef.faction,
      destroyedGhost:
        destroyedSlotIndex !== -1
          ? { instance: JSON.parse(JSON.stringify(targetHit.apex)), ownerId: targetHit.ownerId, slotIndex: destroyedSlotIndex, slotKind: 'apex' }
          : undefined,
    },
    800
  );
  if (chainedEngine && chainedEngineDef) {
    const chainedEngineSlotIndex = draft.players[targetHit.ownerId].supportSlots.findIndex((s) => s?.instanceId === chainedEngine.instanceId);
    emitVfx(
      {
        type: 'CARD_DESTROYED',
        apexInstanceId: chainedEngine.instanceId,
        faction: chainedEngineDef.faction,
        destroyedGhost:
          chainedEngineSlotIndex !== -1
            ? { instance: JSON.parse(JSON.stringify(chainedEngine)), ownerId: targetHit.ownerId, slotIndex: chainedEngineSlotIndex, slotKind: 'support' }
            : undefined,
      },
      800
    );
  }
  destroyApexFn(draft, trigger.targetInstanceId!);
  if (apexDef?.onDestroyEnemyApex) {
    apexDef.onDestroyEnemyApex({
      helpers,
      ownerId: trigger.attackerId,
      attackerInstanceId: trigger.attackerInstanceId,
      targetInstanceId: trigger.targetInstanceId,
      syncCost: trigger.syncCost,
      baseDamage: trigger.totalDamage,
      destroyedApexInstanceId: trigger.targetInstanceId!,
    });
  }

  // Chrome Halo (Synth Ascendancy Equip): "Once per turn, if equipped Apex destroys
  // an enemy Apex, gain 1 Momentum." No generic on-kill hook exists for Equips (only
  // Apexes have onDestroyEnemyApex), so this is special-cased here, same pattern as
  // Glitch Step and Emergency Authority elsewhere in this file.
  if (attackerHit?.apex.equip?.defId === 'sa-chrome-halo') {
    const attackerOwner = draft.players[trigger.attackerId];
    if (!attackerOwner.turnFlags.chromeHaloMomentumGainedThisTurn) {
      attackerOwner.turnFlags.chromeHaloMomentumGainedThisTurn = true;
      gainMomentumFn(draft, trigger.attackerId, 1);
      logMsg(draft, 'Chrome Halo grants 1 Momentum for the kill.', 'momentum');
    }
  }

  const o2Loss = overflowToO2Loss(overflow);
  if (o2Loss > 0) {
    emitVfx({ type: 'OVERFLOW_DAMAGE', playerId: otherPlayer(trigger.attackerId), label: `-${o2Loss} O2 (Overflow)` });
    resolveO2LossWindow(draft, {
      kind: 'opponentAttackDealsO2Damage',
      attackerId: trigger.attackerId,
      defenderId: otherPlayer(trigger.attackerId),
      amount: o2Loss,
      isOverflow: true,
      attackerInstanceId: trigger.attackerInstanceId,
      attackDefId: trigger.attackDefId,
      targetInstanceId: trigger.targetInstanceId,
      destroyedTarget: true,
      targetHadChoke: trigger.targetHadChoke,
    });
  } else {
    finalizeAttackEffects(draft, trigger, true, false);
  }
}

function resolveAttackAgainstTarget(draft: GameState, trigger: AttackTriggerData, damage: number) {
  const attackerHit = findApexAnywhere(draft, trigger.attackerInstanceId);
  if (!attackerHit) return;
  const apexDef = getCardDef(attackerHit.apex.defId) as ApexDef;
  const defenderId = otherPlayer(trigger.attackerId);

  if (trigger.targetInstanceId) {
    const targetHit = findApexAnywhere(draft, trigger.targetInstanceId);
    if (!targetHit) {
      finalizeAttackEffects(draft, trigger, false, false);
      return;
    }
    const targetDef = getCardDef(targetHit.apex.defId) as ApexDef;
    let dmg = damage;
    if (targetDef.incomingDamageReduction) dmg = targetDef.incomingDamageReduction(trigger.syncCost, dmg);
    emitVfx({ type: 'CARD_HIT', apexInstanceId: trigger.targetInstanceId, label: `-${dmg}`, faction: targetDef.faction });

    const effectiveDef = getEffectiveDef(draft, trigger.targetInstanceId);
    if (dmg < effectiveDef) {
      logMsg(draft, `${targetDef.name} defends with ${effectiveDef} DEF and survives ${dmg} damage.`, 'damage');
      finalizeAttackEffects(draft, trigger, false, false);
      return;
    }

    let overflow = dmg - effectiveDef;
    if (targetHit.apex.equip) {
      const eqDef = getCardDef(targetHit.apex.equip.defId);
      if (eqDef.type === 'Equip' && eqDef.onOverflowDamage) {
        const reduced = eqDef.onOverflowDamage(overflow);
        if (reduced !== overflow) {
          logMsg(draft, `${eqDef.name} reduces the overflow from ${overflow} to ${reduced}.`, 'damage');
        }
        overflow = reduced;
      }
    }

    const destroyTrigger: DestroyTriggerData = {
      kind: 'ownApexWouldBeDestroyed',
      apexInstanceId: trigger.targetInstanceId,
      ownerId: defenderId,
      fromAttack: {
        attackerId: trigger.attackerId,
        attackerInstanceId: trigger.attackerInstanceId,
        attackDefId: trigger.attackDefId,
        syncCost: trigger.syncCost,
        totalDamage: damage,
        overflow,
      },
    };
    logMsg(
      draft,
      `${targetDef.name} defends with ${effectiveDef} DEF but is destroyed by ${dmg} damage${
        overflow > 0 ? ` (${overflow} overflow)` : ''
      }.`,
      'damage'
    );
    const opened = maybeOpenResponseWindow(
      draft,
      defenderId,
      { kind: 'APEX_WOULD_BE_DESTROYED', data: destroyTrigger },
      () => {
        draft.pendingResponseQueue.push({
          id: newId('rx'),
          stage: 'reactionChoice',
          respondingPlayerId: defenderId,
          trigger: destroyTrigger,
        });
      }
    );
    if (opened) return;

    proceedWithDestruction(draft, trigger, overflow);
    return;
  }

  const rawLoss = directDamageToO2Loss(damage);
  const attackerPlayer = draft.players[trigger.attackerId];
  const remainingCap = Math.max(0, DIRECT_O2_CAP_PER_TURN - attackerPlayer.turnFlags.directO2LossThisTurn);
  const cappedLoss = Math.min(rawLoss, remainingCap);

  if (cappedLoss <= 0) {
    logMsg(
      draft,
      `${apexDef.name} attacks ${defenderId}'s O2 directly for ${damage} damage (would cost ${rawLoss} O2), but the 2-per-turn direct O2 cap is already spent - 0 O2 lost.`,
      'damage'
    );
    finalizeAttackEffects(draft, trigger, false, false);
    return;
  }

  emitVfx({ type: 'O2_DAMAGE', playerId: defenderId, label: `-${cappedLoss} O2` });
  resolveO2LossWindow(draft, {
    kind: 'opponentAttackDealsO2Damage',
    attackerId: trigger.attackerId,
    defenderId,
    amount: cappedLoss,
    isOverflow: false,
    attackerInstanceId: trigger.attackerInstanceId,
    attackDefId: trigger.attackDefId,
    targetInstanceId: undefined,
    destroyedTarget: false,
  });
}
function resolveO2LossWindow(draft: GameState, o2trigger: O2DamageTriggerData) {
  logMsg(
    draft,
    `${o2trigger.isOverflow ? 'Overflow damage' : 'Direct attack'} would deal ${o2trigger.amount} O2 loss to ${o2trigger.defenderId}.`,
    'o2'
  );
  const opened = maybeOpenResponseWindow(
    draft,
    o2trigger.defenderId,
    { kind: 'O2_DAMAGE_PENDING', data: o2trigger },
    () => {
      draft.pendingResponseQueue.push({
        id: newId('rx'),
        stage: 'reactionChoice',
        respondingPlayerId: o2trigger.defenderId,
        trigger: o2trigger,
      });
    }
  );
  if (opened) return;
  applyO2LossFinal(draft, o2trigger, 0);
}

function applyO2LossFinal(draft: GameState, o2trigger: O2DamageTriggerData, reduction: number) {
  const finalAmount = Math.max(0, o2trigger.amount - reduction);
  const helpers = createHelpers(draft);
  if (reduction > 0) {
    logMsg(draft, `O2 loss reduced by ${reduction} (from ${o2trigger.amount} to ${finalAmount}).`, 'o2');
  }
  helpers.loseO2(o2trigger.defenderId, finalAmount);
  if (!o2trigger.isOverflow && finalAmount > 0) {
    draft.players[o2trigger.attackerId].turnFlags.directO2LossThisTurn += finalAmount;
  }
  const trigger: AttackTriggerData = {
    kind: 'enemyApexAttacks',
    attackerId: o2trigger.attackerId,
    attackerInstanceId: o2trigger.attackerInstanceId,
    attackDefId: o2trigger.attackDefId,
    targetInstanceId: o2trigger.targetInstanceId,
    syncCost: 0,
    totalDamage: 0,
    targetHadChoke: o2trigger.targetHadChoke,
  };
  finalizeAttackEffects(draft, trigger, o2trigger.destroyedTarget, finalAmount > 0, o2trigger.isOverflow);
}

function finishDestroyDecision(draft: GameState, trigger: DestroyTriggerData, prevented: boolean, survivorDef = 100) {
  const apexHit = findApexAnywhere(draft, trigger.apexInstanceId);
  const helpers = createHelpers(draft);

  if (prevented && apexHit) {
    apexHit.apex.survivorDefOverride = survivorDef;
    logMsg(draft, `${getCardDef(apexHit.apex.defId).name} survives at ${survivorDef} DEF (Backup Consciousness)!`, 'response');
    const owner = draft.players[trigger.ownerId];
    if (owner.o2 <= 4) {
      addCounterFn(draft, trigger.apexInstanceId, 'glitch', 1);
    }
    if (trigger.fromAttack) {
      const atk: AttackTriggerData = {
        kind: 'enemyApexAttacks',
        attackerId: trigger.fromAttack.attackerId,
        attackerInstanceId: trigger.fromAttack.attackerInstanceId,
        attackDefId: trigger.fromAttack.attackDefId,
        targetInstanceId: trigger.apexInstanceId,
        syncCost: trigger.fromAttack.syncCost,
        totalDamage: trigger.fromAttack.totalDamage,
      };
      finalizeAttackEffects(draft, atk, false, false);
    }
    return;
  }

  if (trigger.fromAttack) {
    const atk: AttackTriggerData = {
      kind: 'enemyApexAttacks',
      attackerId: trigger.fromAttack.attackerId,
      attackerInstanceId: trigger.fromAttack.attackerInstanceId,
      attackDefId: trigger.fromAttack.attackDefId,
      targetInstanceId: trigger.apexInstanceId,
      syncCost: trigger.fromAttack.syncCost,
      totalDamage: trigger.fromAttack.totalDamage,
    };
    proceedWithDestruction(draft, atk, trigger.fromAttack.overflow);
  } else if (apexHit) {
    helpers.destroyApex(trigger.apexInstanceId);
  }
}

function finalizeAttackEffects(
  draft: GameState,
  trigger: AttackTriggerData,
  destroyedTarget: boolean,
  dealtO2Damage: boolean,
  hadOverflowDamage: boolean = dealtO2Damage
) {
  // If this attack's O2 loss (applied just before this function runs) already ended the
  // game, stop here: no further onResolve/Overclock/Sync Ability/Apex Break Reward
  // triggers should fire once a winner has been declared (e.g. Oxygen Siphon should not
  // heal O2 back for the winner after the loser has already hit 0).
  const gameAlreadyOver = draft.status === 'gameover';

  if (!gameAlreadyOver) {
    const attackerHit = findApexAnywhere(draft, trigger.attackerInstanceId);
    const helpers = createHelpers(draft);

    if (attackerHit) {
      const apexDef = getCardDef(attackerHit.apex.defId) as ApexDef;
      const attackDef = apexDef.attacks.find((a) => a.id === trigger.attackDefId);
      const ctx = {
        helpers,
        ownerId: trigger.attackerId,
        attackerInstanceId: trigger.attackerInstanceId,
        targetInstanceId: trigger.targetInstanceId,
        syncCost: trigger.syncCost,
        baseDamage: attackDef?.baseDamage ?? 0,
        destroyedTarget,
        dealtO2Damage,
        targetHadChoke: trigger.targetHadChoke ?? false,
      };

      if (attackDef?.onResolve) attackDef.onResolve(ctx);

      if (attackerHit.apex.armedBonusIsOverclock) {
        attackerHit.apex.armedBonusIsOverclock = false;
        helpers.loseO2(trigger.attackerId, dealtO2Damage ? 1 : 2, { fromOwnEffect: true });
        logMsg(draft, 'Overclock burns O2 as its damage resolves.', 'o2');
      }

      const player = draft.players[trigger.attackerId];
      for (const support of player.supportSlots) {
        if (!support || support.type !== 'AbilitySupport') continue;
        if (support.chainedApexId !== trigger.attackerInstanceId) continue;
        if (support.lockedByControlConflict) continue;
        if (support.enteredViaReconfigureTurn === draft.turnNumber) continue;
        const supportDef = getCardDef(support.defId) as AbilitySupportDef;
        if (supportDef.chainedAttackBonus) continue; // already applied live during damage calculation
        supportDef.syncAbility({ ...ctx, chainedApexId: trigger.attackerInstanceId });
        logMsg(draft, `${supportDef.name}'s Sync Ability triggers.`, 'support');
      }
    }

    // Apex Break Reward: destroying an enemy Apex with an attack that had exactly 0
    // overflow damage (a "clean break") rewards the attacker with 1 Momentum. This
    // function is only ever called as the terminal step of the attack-resolution
    // pipeline, so this naturally excludes direct attacks (destroyedTarget is always
    // false for those), non-attack destruction effects (they never route through here),
    // and destructions that were prevented (Backup Consciousness passes destroyedTarget=false).
    //
    // Uses hadOverflowDamage (the mechanical fact that overflow occurred), not
    // dealtO2Damage (the final post-reduction amount) - if a Reaction like Emergency
    // Authority absorbs the overflow's O2 loss all the way down to 0, that still isn't a
    // clean break: overflow damage genuinely happened, a Reaction just prevented its cost.
    if (destroyedTarget && trigger.targetInstanceId) {
      if (!dealtO2Damage) {
        logMsg(draft, 'No O2 damage was dealt.', 'o2');
      }
      if (!hadOverflowDamage) {
        const opponentId = otherPlayer(trigger.attackerId);
        const echoRiotBoost =
          draft.riftSpace?.id === 'EchoRiot' && draft.players[trigger.attackerId].o2 <= 6 && draft.players[opponentId].o2 <= 6;
        const rewardAmount = echoRiotBoost ? 2 : 1;
        helpers.gainMomentum(trigger.attackerId, rewardAmount);
        if (echoRiotBoost) {
          logMsg(draft, `Echo Riot increases Apex Break Reward to +2 Momentum for ${trigger.attackerId}.`, 'rift');
        } else {
          logMsg(draft, `${trigger.attackerId} gains 1 Momentum from Apex Break Reward.`, 'momentum');
        }
      } else if (!dealtO2Damage) {
        logMsg(draft, 'Apex Break Reward does not trigger - overflow damage was prevented by a Reaction.', 'momentum');
      }
    }
  }

  logMsg(draft, 'Attack fully resolved.', 'attack');
}

function applyChosenReactionAndContinue(
  draft: GameState,
  trigger: TriggerData,
  reactionDef: ReactionDef,
  reactionOwnerId: PlayerId
) {
  const helpers = createHelpers(draft);
  const result = (reactionDef.resolve({ helpers, ownerId: reactionOwnerId }) ?? {}) as Record<string, unknown>;

  if (trigger.kind === 'enemyApexAttacks') {
    const reduction = (result.damageReduction as number) ?? 0;
    const newDamage = Math.max(0, trigger.totalDamage - reduction);
    if (reduction > 0) {
      logMsg(draft, `${reactionDef.name} reduces the attack by ${reduction} (now ${newDamage} damage).`, 'response');
    }
    if (reactionDef.id === 'nu-glitch-step') {
      const owner = draft.players[reactionOwnerId];
      const hasSmallNeon = owner.apexSlots.some(
        (a) => a && getCardDef(a.defId).faction === 'Neon Underground' && getEffectiveDef(draft, a.instanceId) <= 300
      );
      if (hasSmallNeon) {
        gainMomentumFn(draft, reactionOwnerId, 1);
        emitVfx({ type: 'MOMENTUM_GAINED', playerId: reactionOwnerId, label: '+1' });
      }
    }
    resolveAttackAgainstTarget(draft, trigger, newDamage);
    return;
  }

  if (trigger.kind === 'ownApexWouldBeDestroyed') {
    const prevented = !!result.preventDestruction;
    finishDestroyDecision(draft, trigger, prevented, (result.survivorDef as number) ?? 100);
    return;
  }

  if (trigger.kind === 'opponentAttackDealsO2Damage') {
    if (reactionDef.id === 'dw-emergency-authority') {
      const defender = draft.players[reactionOwnerId];
      if (defender.o2 <= 4) {
        addCounterFn(draft, trigger.attackerInstanceId, 'choke', 1, reactionOwnerId);
      }
    }
    const reduction = (result.o2Reduction as number) ?? 0;
    applyO2LossFinal(draft, trigger, reduction);
  }
}

function continueTriggerUnmodified(draft: GameState, trigger: TriggerData) {
  if (trigger.kind === 'enemyApexAttacks') {
    resolveAttackAgainstTarget(draft, trigger, trigger.totalDamage);
  } else if (trigger.kind === 'ownApexWouldBeDestroyed') {
    finishDestroyDecision(draft, trigger, false);
  } else if (trigger.kind === 'opponentAttackDealsO2Damage') {
    applyO2LossFinal(draft, trigger, 0);
  }
}

/** Logs "Action resolved." only once a response-window-driven trigger chain has truly
 *  terminated (i.e. it didn't just open another nested window, such as a Negate-the-Reaction
 *  layer or Alley Wraith's follow-up prompt). */
function maybeLogActionResolved(draft: GameState) {
  if (draft.pendingResponseQueue.length === 0) {
    logMsg(draft, 'Action resolved.', 'response');
  }
}

// ==========================================================================
// Store
// ==========================================================================

interface GameStore extends GameState {
  startNewGame: (p1: Faction, p2: Faction, vsAI?: boolean, aiVsAiMode?: boolean, tutorialMode?: boolean, forcedFirstPlayerId?: PlayerId | null, o2Amount?: number) => void;
  selectOpeningApex: (playerId: PlayerId, cardInstanceId: string) => void;
  advancePhase: (phase: Phase) => void;
  endTurn: () => void;
  playApexCard: (cardInstanceId: string, slotIndex?: number) => void;
  playSupportCard: (cardInstanceId: string, slotIndex?: number, chainedApexId?: string) => void;
  playEquipCard: (cardInstanceId: string, apexInstanceId: string) => void;
  /** Once per turn, separate budget from Engine Reconfig: swap out an Apex's
   *  currently-attached Equip for a new one from hand. The old Equip returns to
   *  hand (never Void) - this is deliberately not a "destroy," so no
   *  destroy-triggered Equip perks fire. Cannot target an Equip that was itself
   *  attached this same turn. */
  equipSwap: (apexInstanceId: string, newCardInstanceId: string) => void;
  /** Commit 52 - drag-back reconfigure: pull an Equip (by its own instance id)
   *  off its Apex back into hand. FREE and consumes no per-turn budget (the
   *  "swap" is only spent when a replacement is attached). */
  returnEquipToHand: (equipInstanceId: string) => void;
  /** Commit 52 - drag-back reconfigure: pull an Engine (Ability Support) off
   *  the board back into hand. FREE; the engine-swap budget is spent when a
   *  replacement Engine is played, not here. */
  returnEngineToHand: (supportInstanceId: string) => void;
  playSpecialCard: (cardInstanceId: string, targetApexInstanceId?: string) => void;
  reconfigure: (returnInstanceId: string, playInstanceId?: string, chainedApexId?: string) => void;
  chainSupport: (supportInstanceId: string, apexInstanceId: string) => void;
  unchainSupport: (supportInstanceId: string) => void;
  declareAttack: (attackerInstanceId: string, attackId: string, targetInstanceId?: string, overdriveSpend?: boolean) => void;
  resolveResponse: (choice: ResponseChoice) => void;
  lockSupportControlConflict: (supportInstanceId: string) => void;
  resetToMenu: () => void;
  toggleDebugMode: () => void;
}

function mutate(set: (fn: (state: GameStore) => Partial<GameStore> | GameStore) => void, mutator: (draft: GameState) => void) {
  set((state) => produce(state, (draft) => mutator(draft as unknown as GameState)) as GameStore);
}

export const useGameStore = create<GameStore>((set) => ({
  ...initialState(),

  startNewGame: (p1FactionArg, p2FactionArg, vsAI, aiVsAiMode, tutorialMode, forcedFirstPlayerId, o2Amount) =>
    mutate(set, (draft) => {
      Object.assign(draft, initialState());
      if (tutorialMode) tutorialGeneration++;
      // Learn To Play always uses the recommended Neon Underground vs Dark White
      // matchup (per the design doc's own reasoning: Neon teaches attack/burst/
      // Momentum, Dark White teaches control/DEF/Choke/survival) and is always
      // played against the AI, regardless of whatever was passed in.
      const p1Faction = tutorialMode ? 'Neon Underground' : p1FactionArg;
      const p2Faction = tutorialMode ? 'Dark White' : p2FactionArg;
      const startingO2 = tutorialMode ? STARTING_O2 : o2Amount ?? STARTING_O2;
      draft.selectedFactions = { player1: p1Faction, player2: p2Faction };
      draft.vsAI = tutorialMode ? true : !!vsAI;
      draft.aiVsAiMode = !!aiVsAiMode;
      draft.tutorialMode = !!tutorialMode;
      draft.tutorialAwaitingFirstApex = !!tutorialMode;

      for (const [pid, faction] of [
        ['player1', p1Faction],
        ['player2', p2Faction],
      ] as [PlayerId, Faction][]) {
        const player = freshPlayer(pid, faction, startingO2);
        let deck = shuffle(buildStarterDeck(faction));

        // Tutorial scripting (Commit 29 / 29.1 / 29.7): reorder each player's
        // deck (never composition/copy counts, only draw *order*) so the
        // specific cards the scripted tutorial references are guaranteed to show
        // up when needed, rather than leaving a first-time player's actual
        // teaching moment to chance. Player1 gets the cards the script names by
        // name (Street-Beast, Dead Battery, Plasma Edge, Overclock in the
        // opening hand; Glitch Step, Riot Runner, and Static Jack guaranteed
        // among the first draws after, in that order specifically). Riot Runner
        // has to come before Static Jack - a real bug found by tracing a report
        // through to its root cause: without it in this list at all, Static Jack
        // (already prioritized for Step 15) could get auto-played by emergency
        // Apex recovery at Step 9 instead of the scripted Riot Runner, leaving
        // Step 9's own text wrong and Step 15 with no Static Jack left to play.
        // Player2 (the scripted/AI opponent) gets Enforcer-V4 (or the first
        // Apex found) placed directly, not "played" via any action - see the
        // direct placement below, right after this loop. 500 DEF specifically
        // (Commit 29.13), matching Neon Pounce's 500 damage exactly for a real
        // clean break - see the fuller explanation right at that placement.
        if (tutorialMode && pid === 'player1') {
          const byDefId = (defId: string) => deck.find((c) => c.defId === defId);
          const allByDefId = (defId: string) => deck.filter((c) => c.defId === defId);
          // Commit 31 - rebuilt for the new guided match flow (real
          // drag-and-drop, not scripted plays). Two Dead Battery copies (one
          // before combat, one is the "reach 3 Sync" third Engine moment),
          // Smog Jacket named explicitly by the design doc, Overclock for the
          // Special step, Glitch Step for the real React step, Juice-Box as
          // a second Engine source so there's always a legal third Engine to
          // play even if a Dead Battery copy got drawn earlier by chance.
          const priority = [
            byDefId('nu-street-beast'),
            ...allByDefId('nu-dead-battery'),
            byDefId('nu-smog-jacket'),
            byDefId('nu-overclock'),
            byDefId('nu-glitch-step'),
            ...allByDefId('nu-juice-box'),
          ].filter((c): c is CardInstance => !!c);
          const rest = deck.filter((c) => !priority.includes(c));
          deck = [...priority, ...rest];
        }
        if (tutorialMode && pid === 'player2') {
          // Commit 29.13 - Enforcer-V4 (500 DEF), not Pale Executioner (300
          // DEF). A real, reported bug: the tutorial's "Apex Break Reward" step
          // claims the player's first attack (Street-Beast's Neon Pounce, 500
          // damage) destroys the enemy Apex with zero O2 damage and a Momentum
          // reward - but 500 damage against a 300-DEF target is 200 overflow,
          // a real hit to the opponent's O2, never a clean break. Verified
          // directly before picking a fix: Enforcer-V4's DEF (500) exactly
          // matches Neon Pounce's damage, so this specific attack is a genuine
          // 0-overflow clean break, and the Momentum-reward text is now
          // actually true rather than describing an outcome that could never
          // happen with this scripted matchup.
          // Commit 29.14 - built as a single priority list, not three separate
          // sequential "move to front" operations. That was the actual bug:
          // each prepend pushed the previous one further back, so by the time
          // all three ran, Pale Executioner ended up earlier in the opening
          // hand than Enforcer-V4 - and the placement logic below matches "any
          // Apex" as a fallback, so it grabbed Pale Executioner instead of the
          // intended opener. Confirmed directly: the Battle Log showed "Pale
          // Executioner is destroyed" on the very first scripted attack,
          // instead of Enforcer-V4. Building the whole order in one pass
          // avoids this whole class of bug rather than just fixing this one
          // instance of it.
          const enforcerV4 = deck.find((c) => c.defId === 'dw-enforcer-v4');
          const paleExecutioners = deck.filter((c) => c.defId === 'dw-pale-executioner');
          const reserveGrid = deck.find((c) => c.defId === 'dw-reserve-grid');
          const priority = [enforcerV4, ...paleExecutioners, reserveGrid].filter((c): c is CardInstance => !!c);
          deck = [...priority, ...deck.filter((c) => !priority.includes(c))];
        }

        let hand: CardInstance[] = [];
        let safety = 0;
        while (safety < 25) {
          safety += 1;
          hand = deck.slice(0, STARTING_HAND_SIZE);
          const rest = deck.slice(STARTING_HAND_SIZE);
          if (hand.some((c) => c.type === 'Apex')) {
            deck = rest;
            break;
          }
          logMsg(draft, `${pid} reveals a hand with no Apex - shuffling back and redrawing.`, 'info');
          deck = shuffle([...hand, ...rest]);
        }
        player.deck = deck;
        player.hand = hand;
        draft.players[pid] = player;
      }

      draft.riftSpace = determineRiftSpace(p1Faction, p2Faction);
      if (tutorialMode) {
        // Directly place the opponent's scripted opening Apex onto the board
        // (Commit 29.7) - a real, reported regression from 29.4. Skipping the
        // normal opening-Apex-selection screen correctly fixed the player's own
        // side (Step 1 is now a real, gated Main-Phase play), but that screen
        // used to ALSO be how the opponent's opening Apex got placed - and since
        // the entire Steps 1-8 sequence happens on the player's very first turn,
        // before the opponent ever gets a turn of their own to play anything,
        // nothing was left to put an Apex on their side at all. Confirmed
        // directly (not assumed): player2's apexSlots were both empty at match
        // start before this fix. Placed straight from hand, not "played" through
        // any action - there's no legal moment for the opponent to have done
        // this themselves yet.
        const opponent = draft.players.player2;
        const strictIdx = opponent.hand.findIndex((c) => c.defId === 'dw-enforcer-v4');
        const openerIdx = strictIdx !== -1 ? strictIdx : opponent.hand.findIndex((c) => c.type === 'Apex');
        if (openerIdx !== -1) {
          const [opener] = opponent.hand.splice(openerIdx, 1);
          opponent.apexSlots[0] = opener;
        }
        // Skip normal opening-Apex selection entirely (Commit 29.4) - the
        // previous approach left the normal selection screen fully clickable
        // underneath/alongside the tutorial's own intro step, a real reported
        // bug (the player could pick any Apex before ever pressing Continue).
        // Player1 always goes first in the tutorial, matching the scripted
        // script; both players start with zero Apexes in play, and the
        // tutorial's own Step 1 gating (blockedByTutorial) guides the player
        // through what is otherwise a completely ordinary Main-Phase Apex
        // play - no special-cased "first Apex" logic needed at all.
        draft.activePlayerId = 'player1';
        draft.firstPlayerId = 'player1';
        draft.turnNumber = 1;
        // Deliberately NOT setting isFirstTurnOverall here - that rule exists to
        // stop a coinflip winner from getting a free alpha strike before the
        // opponent can set up, which doesn't meaningfully apply to a fully
        // scripted, single-player teaching sequence. Confirmed by direct testing
        // (not assumed) that leaving it true silently blocks Step 6's entire
        // attack with "The first player cannot attack on their very first turn" -
        // the tutorial's own autoAdvanceWhen check would then never see
        // hasAttacked become true, and the step would never advance.
        draft.status = 'playing';
        draft.phase = 'Start';
        draft.startPhasePending = true;
      } else {
        draft.status = 'selectingOpeningApex';
        draft.openingApexSelectionPlayerId = 'player1';
      }
      if (forcedFirstPlayerId) draft.coinFlipFirstPlayerId = forcedFirstPlayerId;
      logMsg(draft, `New game: ${p1Faction} vs ${p2Faction}. Rift Space: ${draft.riftSpace.name}.`, 'info');
      logMsg(draft, draft.riftSpace.description, 'rift');
    }),

  selectOpeningApex: (playerId, cardInstanceId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'selectingOpeningApex' || draft.openingApexSelectionPlayerId !== playerId) return;
      const player = draft.players[playerId];
      const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId && c.type === 'Apex');
      if (idx === -1) return;
      const [apex] = player.hand.splice(idx, 1);
      player.apexSlots[0] = apex;
      const def = getCardDef(apex.defId) as ApexDef;
      if (def.onEnterPlay) {
        def.onEnterPlay({ helpers: createHelpers(draft), ownerId: playerId, apexInstanceId: apex.instanceId });
      }
      logMsg(draft, `${playerId} opens with ${def.name}.`, 'play');

      if (playerId === 'player1') {
        draft.openingApexSelectionPlayerId = 'player2';
        return;
      }

      const p1Apex = draft.players.player1.apexSlots[0]!;
      const p2Apex = draft.players.player2.apexSlots[0]!;
      const p1Def = getCardDef(p1Apex.defId) as ApexDef;
      const p2Def = getCardDef(p2Apex.defId) as ApexDef;
      const p1Zero = p1Def.attacks.find((a) => a.syncCost === 0)?.baseDamage ?? 0;
      const p2Zero = p2Def.attacks.find((a) => a.syncCost === 0)?.baseDamage ?? 0;

      let first: PlayerId;
      if (draft.coinFlipFirstPlayerId) {
        first = draft.coinFlipFirstPlayerId;
      } else if (p1Zero < p2Zero) first = 'player1';
      else if (p2Zero < p1Zero) first = 'player2';
      else first = Math.random() < 0.5 ? 'player1' : 'player2';

      draft.firstPlayerId = first;
      draft.activePlayerId = first;
      draft.turnNumber = 1;
      draft.isFirstTurnOverall = true;
      draft.status = 'playing';
      draft.phase = 'Start';
      draft.startPhasePending = true;
      logMsg(
        draft,
        `${first} goes first (0-Sync attack ${first === 'player1' ? p1Zero : p2Zero} vs ${first === 'player1' ? p2Zero : p1Zero}). They cannot attack this first turn.`,
        'info'
      );
    }),

  advancePhase: (phase) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || draft.pendingResponseQueue.length > 0) return;
      const player = draft.players[draft.activePlayerId];

      if (phase === 'Start') {
        if (draft.phase !== 'Start' || !draft.startPhasePending) return;
        runStartPhase(draft);
        return;
      }
      if (phase === 'Main') {
        if (draft.phase !== 'Start' || draft.startPhasePending) return;
        draft.phase = 'Main';
        maybeRunEmergencyApexDraw(draft, draft.activePlayerId);
        const statusAfterRecovery = draft.status as GameState['status'];
        if (statusAfterRecovery === 'gameover') return;
        logMsg(draft, `${draft.activePlayerId} enters Main Phase.`, 'phase');
        // Commit 30.4 - immediately continue into Combat Phase too, computing
        // Sync right away. Per the explicit request: no separate "Enter
        // Combat" step should ever exist - Main and Combat are one
        // continuous "your turn" from the player's perspective, where card
        // plays and attacks are both legal in any order, the whole time.
        // Internally these are still two GameState.phase values (touching as
        // little of the existing Sync/effect logic as possible), but nothing
        // in the UI ever asks the player to trigger this second half - it
        // just happens.
        const activePlayerAfterMain = draft.players[draft.activePlayerId];
        activePlayerAfterMain.availableSync = computeAvailableSync(draft, draft.activePlayerId);
        draft.phase = 'Combat';
        logMsg(draft, `${draft.activePlayerId} has ${activePlayerAfterMain.availableSync} Sync available.`, 'phase');
        return;
      }
      if (phase === 'Combat') {
        if ((draft.phase !== 'Main' && draft.phase !== 'Combat')) return;
        player.availableSync = computeAvailableSync(draft, draft.activePlayerId);
        draft.phase = 'Combat';
        logMsg(draft, `${draft.activePlayerId} enters Combat Phase with ${player.availableSync} Sync available.`, 'phase');
        return;
      }
    }),

  endTurn: () =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || draft.pendingResponseQueue.length > 0) return;
      if (draft.phase !== 'Combat') return;
      draft.phase = 'End';
      runEndPhase(draft);
      advanceToNextTurn(draft);
    }),

  playApexCard: (cardInstanceId, slotIndex) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || (draft.phase !== 'Main' && draft.phase !== 'Combat') || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId);
      if (idx === -1 || player.hand[idx].type !== 'Apex') return;
      const targetSlot = slotIndex ?? player.apexSlots.findIndex((s) => s === null);
      if (targetSlot === -1 || player.apexSlots[targetSlot] !== null) {
        logMsg(draft, 'No empty Apex slot available.', 'info');
        return;
      }
      const [card] = player.hand.splice(idx, 1);
      player.apexSlots[targetSlot] = card;
      player.turnFlags.cardsPlayedThisTurn += 1;
      if (draft.tutorialMode && playerId === 'player1') draft.tutorialAwaitingFirstApex = false;
      const def = getCardDef(card.defId) as ApexDef;
      emitVfx({ type: 'CARD_PLACED', apexInstanceId: card.instanceId, faction: def.faction, cardDefId: card.defId }, 1000);
      if (def.onEnterPlay) {
        def.onEnterPlay({ helpers: createHelpers(draft), ownerId: playerId, apexInstanceId: card.instanceId });
      }
      logMsg(draft, `${playerId} plays ${def.name} into Apex Slot ${targetSlot + 1}.`, 'play');
      maybeTriggerRecursiveFailureSecondCard(draft, playerId);
    }),

  playSupportCard: (cardInstanceId, slotIndex, chainedApexId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || (draft.phase !== 'Main' && draft.phase !== 'Combat') || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId);
      if (idx === -1) return;
      const card = player.hand[idx];
      if (card.type !== 'AbilitySupport' && card.type !== 'BatterySupport') return;

      if (player.turnFlags.supportsPlayedThisTurn >= 1) {
        logMsg(draft, `${playerId} has already played a Support this turn.`, 'info');
        return;
      }

      if (card.type === 'AbilitySupport') {
        const currentAbilityCount = player.supportSlots.filter((s) => s?.type === 'AbilitySupport').length;
        if (currentAbilityCount >= MAX_ABILITY_SUPPORTS) {
          logMsg(draft, 'Cannot control more than 2 Ability Supports.', 'info');
          return;
        }
        // Chaining is now optional: an Ability Support can be played unchained/vanilla as a
        // pure +1 Sync source (e.g. no legal chain target, or the player simply doesn't want
        // to commit it yet). Only validate the target if one was actually provided.
        if (chainedApexId) {
          if (!player.apexSlots.some((a) => a?.instanceId === chainedApexId)) {
            logMsg(draft, 'Ability Support must be chained to an Apex you control.', 'info');
            return;
          }
          if (player.supportSlots.some((s) => s?.type === 'AbilitySupport' && s.chainedApexId === chainedApexId)) {
            logMsg(draft, 'That Apex already has an Ability Support chained to it.', 'info');
            return;
          }
        }
      }

      const targetSlot = slotIndex ?? player.supportSlots.findIndex((s) => s === null);
      if (targetSlot === -1 || player.supportSlots[targetSlot] !== null) {
        logMsg(draft, 'No empty Support slot available.', 'info');
        return;
      }

      player.hand.splice(idx, 1);
      card.chainedApexId = card.type === 'AbilitySupport' ? chainedApexId ?? null : null;
      player.supportSlots[targetSlot] = card;
      player.turnFlags.cardsPlayedThisTurn += 1;
      player.turnFlags.supportsPlayedThisTurn += 1;
      player.availableSync = Math.min(MAX_SYNC, player.availableSync + 1);
      const def = getCardDef(card.defId);
      emitVfx({ type: 'CARD_PLACED', apexInstanceId: card.instanceId, faction: def.faction, cardDefId: card.defId }, 1000);
      const chainSuffix = card.type === 'AbilitySupport' ? (card.chainedApexId ? ' (chained)' : ' (unchained)') : '';
      logMsg(draft, `${playerId} plays ${def.name} into Support Slot ${targetSlot + 1}${chainSuffix}.`, 'play');
      maybeTriggerRecursiveFailureSecondCard(draft, playerId);
    }),

  playEquipCard: (cardInstanceId, apexInstanceId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || (draft.phase !== 'Main' && draft.phase !== 'Combat') || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId);
      if (idx === -1 || player.hand[idx].type !== 'Equip') return;
      const apex = player.apexSlots.find((a) => a?.instanceId === apexInstanceId);
      if (!apex) {
        logMsg(draft, 'Equip target must be an Apex you control.', 'info');
        return;
      }
      if (apex.equip) {
        logMsg(draft, `${getCardDef(apex.defId).name} already has an Equip attached.`, 'info');
        return;
      }
      const [card] = player.hand.splice(idx, 1);
      player.turnFlags.cardsPlayedThisTurn += 1;
      const def = getCardDef(card.defId);
      const faction = def.faction;
      const negatingPlayerId = otherPlayer(playerId);

      logMsg(draft, `${playerId} plays ${def.name}.`, 'play');
      maybeTriggerRecursiveFailureSecondCard(draft, playerId);
      const opened = maybeOpenResponseWindow(
        draft,
        negatingPlayerId,
        playedCardEvent('EQUIP_PLAYED', { cardType: 'Equip', cardFaction: faction, cardOwnerId: playerId, cardInstanceId: card.instanceId }),
        () => {
          draft.pendingResponseQueue.push({
            id: newId('negate'),
            stage: 'negateWindow',
            negatingPlayerId,
            cardOwnerId: playerId,
            cardInstanceId: card.instanceId,
            cardDefId: card.defId,
            cardType: 'Equip',
            cardFaction: faction,
            continuation: { kind: 'resolveEquip', ownerId: playerId, apexInstanceId },
            pendingCardInstance: card,
          });
        }
      );
      if (opened) return;

      apex.equip = card;
      apex.equip.equippedTurn = draft.turnNumber;
      emitVfx({ type: 'CARD_PLACED', apexInstanceId: apex.instanceId, faction: def.faction, cardDefId: card.defId }, 1000);
      logMsg(draft, `${playerId} equips ${def.name} onto ${getCardDef(apex.defId).name}.`, 'play');
    }),

  equipSwap: (apexInstanceId, newCardInstanceId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || (draft.phase !== 'Main' && draft.phase !== 'Combat') || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      if (player.turnFlags.equipSwapUsedThisTurn) {
        logMsg(draft, 'Equip Swap already used this turn.', 'info');
        return;
      }
      const idx = player.hand.findIndex((c) => c.instanceId === newCardInstanceId);
      if (idx === -1 || player.hand[idx].type !== 'Equip') return;
      const apex = player.apexSlots.find((a) => a?.instanceId === apexInstanceId);
      if (!apex) {
        logMsg(draft, 'Equip Swap target must be an Apex you control.', 'info');
        return;
      }
      if (!apex.equip) {
        logMsg(draft, `${getCardDef(apex.defId).name} has no Equip to swap out - use Equip instead.`, 'info');
        return;
      }
      if (apex.equip.equippedTurn === draft.turnNumber) {
        logMsg(draft, `${getCardDef(apex.equip.defId).name} was attached this turn and cannot be Equip Swapped yet.`, 'info');
        return;
      }

      const oldEquipInstanceId = apex.equip.instanceId;
      const [card] = player.hand.splice(idx, 1);
      player.turnFlags.equipSwapUsedThisTurn = true;
      player.turnFlags.cardsPlayedThisTurn += 1;
      const def = getCardDef(card.defId);
      const faction = def.faction;
      const negatingPlayerId = otherPlayer(playerId);

      logMsg(draft, `${playerId} plays ${def.name} (Equip Swap).`, 'play');
      emitVfx({ type: 'EQUIP_SWAPPED', apexInstanceId, faction, cardDefId: card.defId }, 1000);
      maybeTriggerRecursiveFailureSecondCard(draft, playerId);
      const opened = maybeOpenResponseWindow(
        draft,
        negatingPlayerId,
        playedCardEvent('EQUIP_PLAYED', { cardType: 'Equip', cardFaction: faction, cardOwnerId: playerId, cardInstanceId: card.instanceId }),
        () => {
          draft.pendingResponseQueue.push({
            id: newId('negate'),
            stage: 'negateWindow',
            negatingPlayerId,
            cardOwnerId: playerId,
            cardInstanceId: card.instanceId,
            cardDefId: card.defId,
            cardType: 'Equip',
            cardFaction: faction,
            continuation: { kind: 'resolveEquipSwap', ownerId: playerId, apexInstanceId, oldEquipInstanceId },
            pendingCardInstance: card,
          });
        }
      );
      if (opened) return;

      // No destroy-hook fires here on purpose - this is a swap, not a destruction.
      // Clean copy back to hand, same reasoning as every other "return to hand" path.
      const oldEquip = apex.equip;
      player.hand.push({ instanceId: oldEquip.instanceId, defId: oldEquip.defId, type: oldEquip.type });
      logMsg(draft, `${getCardDef(oldEquip.defId).name} returns to hand (Equip Swap).`, 'play');
      apex.equip = card;
      apex.equip.equippedTurn = draft.turnNumber;
      emitVfx({ type: 'CARD_PLACED', apexInstanceId: apex.instanceId, faction: def.faction, cardDefId: card.defId }, 1000);
      logMsg(draft, `${playerId} equips ${def.name} onto ${getCardDef(apex.defId).name} (Equip Swap).`, 'play');
    }),

  // Commit 52 - drag an Equip off an Apex, back into hand. FREE: no budget is
  // spent here. The "one equip swap per Apex per turn" limit is enforced when a
  // REPLACEMENT is attached (see playEquipCard), not on removal - so a player
  // who pulls an Equip off can always put one back without feeling cheated.
  returnEquipToHand: (equipInstanceId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || (draft.phase !== 'Main' && draft.phase !== 'Combat') || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      const apex = player.apexSlots.find((a) => a?.equip?.instanceId === equipInstanceId);
      if (!apex || !apex.equip) return;
      const equip = apex.equip;
      const def = getCardDef(equip.defId);
      equip.equippedTurn = null;
      apex.equip = undefined;
      player.hand.push(equip);
      logMsg(draft, `${playerId} pulls ${def.name} back into hand.`, 'play');
      emitVfx({ type: 'CARD_PLACED', apexInstanceId: apex.instanceId, faction: def.faction, cardDefId: equip.defId }, 600);
    }),

  // Commit 52 - drag an Engine (Ability Support) off the board, back into hand.
  // FREE; the once-per-turn engine-swap budget is spent when a replacement
  // Engine is PLAYED (playSupportCard sets supportsPlayedThisTurn), not here.
  // Reuses the same cleanup Engine Reconfig used (onReconfigureReturn + the
  // chained-apex unlink that returning a Support performs).
  returnEngineToHand: (supportInstanceId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || (draft.phase !== 'Main' && draft.phase !== 'Combat') || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      const slotIdx = player.supportSlots.findIndex((s) => s?.instanceId === supportInstanceId);
      if (slotIdx === -1) return;
      const returned = player.supportSlots[slotIdx]!;
      if (returned.lockedByControlConflict) {
        logMsg(draft, `${getCardDef(returned.defId).name} is locked by Control Conflict and cannot be moved.`, 'info');
        return;
      }
      player.supportSlots[slotIdx] = null;
      returned.chainedApexId = null;
      player.hand.push(returned);
      const def = getCardDef(returned.defId);
      logMsg(draft, `${playerId} pulls ${def.name} back into hand.`, 'support');
      if (def.type === 'BatterySupport' && def.onReconfigureReturn) {
        def.onReconfigureReturn({ helpers: createHelpers(draft), ownerId: playerId, cardInstanceId: returned.instanceId });
      }
    }),

  playSpecialCard: (cardInstanceId, targetApexInstanceId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || (draft.phase !== 'Main' && draft.phase !== 'Combat') || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId);
      if (idx === -1 || player.hand[idx].type !== 'Special') return;
      const card = player.hand[idx];
      const def = getCardDef(card.defId) as SpecialDef;

      if (player.turnFlags.specialsPlayedThisTurn >= 1) {
        logMsg(draft, `${playerId} has already played a Special this turn.`, 'info');
        return;
      }

      if (def.canPlay && !def.canPlay(playerId, draft)) {
        logMsg(draft, `${def.name} cannot be played right now.`, 'info');
        return;
      }
      if (def.requiresTarget && !targetApexInstanceId) {
        logMsg(draft, `${def.name} requires a target.`, 'info');
        return;
      }
      if (targetApexInstanceId && def.requiresTarget) {
        const hit = findApexAnywhere(draft, targetApexInstanceId);
        if (!hit) return;
        if (def.requiresTarget === 'enemyApex' || def.requiresTarget === 'enemyApexWithChoke') {
          if (hit.ownerId === playerId) return;
          if (def.requiresTarget === 'enemyApexWithChoke' && (hit.apex.counters?.choke ?? 0) === 0) return;
        }
        if (def.requiresTarget === 'ownApex') {
          if (hit.ownerId !== playerId) return;
        }
      }

      player.hand.splice(idx, 1);
      player.voidZone.push(card);
      player.turnFlags.cardsPlayedThisTurn += 1;
      player.turnFlags.specialsPlayedThisTurn += 1;
      logMsg(draft, `${playerId} plays ${def.name}.`, 'play');
      maybeTriggerRecursiveFailureSecondCard(draft, playerId);

      const negatingPlayerId = otherPlayer(playerId);
      const opened = maybeOpenResponseWindow(
        draft,
        negatingPlayerId,
        playedCardEvent('SPECIAL_PLAYED', {
          cardType: 'Special',
          cardFaction: def.faction,
          cardOwnerId: playerId,
          cardInstanceId: card.instanceId,
        }),
        () => {
          draft.pendingResponseQueue.push({
            id: newId('negate'),
            stage: 'negateWindow',
            negatingPlayerId,
            cardOwnerId: playerId,
            cardInstanceId: card.instanceId,
            cardDefId: card.defId,
            cardType: 'Special',
            cardFaction: def.faction,
            continuation: { kind: 'resolveSpecial', ownerId: playerId, targetApexInstanceId },
          });
        }
      );
      if (opened) return;

      def.resolve({ helpers: createHelpers(draft), ownerId: playerId, targetApexInstanceId });
      maybeTriggerHumanErrorChoice(draft, playerId);
    }),

  reconfigure: (returnInstanceId, playInstanceId, chainedApexId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || (draft.phase !== 'Main' && draft.phase !== 'Combat') || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      if (player.turnFlags.reconfigureUsedThisTurn) {
        logMsg(draft, 'Reconfigure already used this turn.', 'info');
        return;
      }
      const slotIdx = player.supportSlots.findIndex((s) => s?.instanceId === returnInstanceId);
      if (slotIdx === -1) return;
      const returned = player.supportSlots[slotIdx]!;
      if (returned.lockedByControlConflict) {
        logMsg(draft, `${getCardDef(returned.defId).name} is locked by Control Conflict and cannot be Reconfigured.`, 'info');
        return;
      }
      player.supportSlots[slotIdx] = null;
      player.hand.push(returned);
      player.turnFlags.reconfigureUsedThisTurn = true;

      const def = getCardDef(returned.defId);
      logMsg(draft, `${playerId} returns ${def.name} to hand (Engine Reconfig).`, 'support');

      if (def.type === 'BatterySupport' && def.onReconfigureReturn) {
        def.onReconfigureReturn({ helpers: createHelpers(draft), ownerId: playerId, cardInstanceId: returned.instanceId });
      }

      if (!playInstanceId) return;

      if (player.turnFlags.supportsPlayedThisTurn >= 1) {
        logMsg(draft, `${playerId} has already played a Support this turn - Reconfigure play skipped.`, 'info');
        return;
      }

      const handIdx = player.hand.findIndex((c) => c.instanceId === playInstanceId);
      if (handIdx === -1) return;
      const toPlay = player.hand[handIdx];
      if (toPlay.type !== 'AbilitySupport' && toPlay.type !== 'BatterySupport') return;

      if (toPlay.type === 'AbilitySupport') {
        const abilityCount = player.supportSlots.filter((s) => s?.type === 'AbilitySupport').length;
        if (abilityCount >= MAX_ABILITY_SUPPORTS) {
          logMsg(draft, 'Cannot control more than 2 Ability Supports - Reconfigure play skipped.', 'info');
          return;
        }
        if (chainedApexId) {
          if (!player.apexSlots.some((a) => a?.instanceId === chainedApexId)) {
            logMsg(draft, 'Ability Support must be chained to an Apex you control.', 'info');
            return;
          }
          if (player.supportSlots.some((s) => s?.type === 'AbilitySupport' && s.chainedApexId === chainedApexId)) {
            logMsg(draft, 'That Apex already has an Ability Support chained to it.', 'info');
            return;
          }
        }
      }

      player.hand.splice(handIdx, 1);
      toPlay.chainedApexId = toPlay.type === 'AbilitySupport' ? chainedApexId ?? null : null;
      toPlay.enteredViaReconfigureTurn = draft.turnNumber;
      player.supportSlots[slotIdx] = toPlay;
      player.turnFlags.supportsPlayedThisTurn += 1;
      const chainSuffix = toPlay.type === 'AbilitySupport' ? (toPlay.chainedApexId ? ' (chained)' : ' (unchained)') : '';
      logMsg(draft, `${playerId} plays ${getCardDef(toPlay.defId).name} via Reconfigure${chainSuffix} (Sync Ability locked this turn).`, 'support');
    }),

  chainSupport: (supportInstanceId, apexInstanceId) =>
    mutate(set, (draft) => {
      // Free, optional (re)assignment of an already-unchained Ability Support to an eligible
      // Apex during Main Phase. Does not count as playing a new Support and does not touch
      // Reconfigure - it's purely fixing up an existing card already on the board.
      if (draft.status !== 'playing' || (draft.phase !== 'Main' && draft.phase !== 'Combat') || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      const support = player.supportSlots.find((s) => s?.instanceId === supportInstanceId);
      if (!support || support.type !== 'AbilitySupport') return;
      if (support.chainedApexId) {
        logMsg(draft, `${getCardDef(support.defId).name} is already chained.`, 'info');
        return;
      }
      if (!player.apexSlots.some((a) => a?.instanceId === apexInstanceId)) {
        logMsg(draft, 'You can only chain to an Apex you control.', 'info');
        return;
      }
      if (player.supportSlots.some((s) => s?.type === 'AbilitySupport' && s.chainedApexId === apexInstanceId)) {
        logMsg(draft, 'That Apex already has an Ability Support chained to it.', 'info');
        return;
      }
      support.chainedApexId = apexInstanceId;
      const apexName = getCardDef(player.apexSlots.find((a) => a?.instanceId === apexInstanceId)!.defId).name;
      logMsg(draft, `${playerId} chains ${getCardDef(support.defId).name} to ${apexName}.`, 'support');
    }),

  unchainSupport: (supportInstanceId) =>
    mutate(set, (draft) => {
      // Commit 30.3 - the reverse of chainSupport, same guard shape. Free,
      // optional unassignment of an already-chained Ability Support - purely
      // fixing up an existing card already on the board, same as chaining
      // itself never counts as a new play and never touches Reconfigure.
      if (draft.status !== 'playing' || (draft.phase !== 'Main' && draft.phase !== 'Combat') || draft.pendingResponseQueue.length > 0) return;
      const playerId = draft.activePlayerId;
      const player = draft.players[playerId];
      const support = player.supportSlots.find((s) => s?.instanceId === supportInstanceId);
      if (!support || support.type !== 'AbilitySupport') return;
      if (!support.chainedApexId) {
        logMsg(draft, `${getCardDef(support.defId).name} isn't chained to anything.`, 'info');
        return;
      }
      const name = getCardDef(support.defId).name;
      support.chainedApexId = undefined;
      logMsg(draft, `${playerId} unchains ${name}.`, 'support');
    }),

  lockSupportControlConflict: (supportInstanceId) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || draft.riftSpace?.id !== 'ControlConflict') return;
      if (draft.phase !== 'Start' || draft.startPhasePending) return;
      const player = draft.players[draft.activePlayerId];
      if (player.lockedSupportInstanceId) return;
      const support = player.supportSlots.find((s) => s?.instanceId === supportInstanceId);
      if (!support) return;
      support.lockedByControlConflict = true;
      player.lockedSupportInstanceId = support.instanceId;
      logMsg(draft, `Control Conflict: ${draft.activePlayerId} locks ${getCardDef(support.defId).name} and gains 1 Momentum.`, 'rift');
      emitVfx({ type: 'RIFT_TRIGGER', playerId: draft.activePlayerId }, 800);
      gainMomentumFn(draft, draft.activePlayerId, 1);
      emitVfx({ type: 'MOMENTUM_GAINED', playerId: draft.activePlayerId, label: '+1' });
    }),

  declareAttack: (attackerInstanceId, attackId, targetInstanceId, overdriveSpend) =>
    mutate(set, (draft) => {
      if (draft.status !== 'playing' || draft.phase !== 'Combat' || draft.pendingResponseQueue.length > 0) return;
      if (draft.isFirstTurnOverall) {
        logMsg(draft, 'The first player cannot attack on their very first turn.', 'info');
        return;
      }
      const hit = findApexAnywhere(draft, attackerInstanceId);
      if (!hit || hit.ownerId !== draft.activePlayerId) return;
      const apex = hit.apex;
      if (apex.hasAttacked) {
        logMsg(draft, 'That Apex has already attacked this turn.', 'info');
        return;
      }
      if (apex.attackLockedForTurn === draft.turnNumber) {
        logMsg(draft, 'That Apex is attack-locked this turn.', 'info');
        return;
      }
      const apexDef = getCardDef(apex.defId) as ApexDef;
      const attackDef = apexDef.attacks.find((a) => a.id === attackId);
      if (!attackDef) return;

      const player = draft.players[draft.activePlayerId];
      if (player.availableSync < attackDef.syncCost) {
        logMsg(draft, 'Not enough Sync available for that attack.', 'info');
        return;
      }

      const opponentId = otherPlayer(draft.activePlayerId);
      const opponent = draft.players[opponentId];
      const opponentHasApex = opponent.apexSlots.some(Boolean);
      if (opponentHasApex && !targetInstanceId) {
        logMsg(draft, 'You must choose an enemy Apex to target.', 'info');
        return;
      }
      if (!opponentHasApex && targetInstanceId) {
        logMsg(draft, 'Opponent has no Apex in play - this must be a direct O2 attack.', 'info');
        return;
      }
      if (targetInstanceId) {
        const targetHit = findApexAnywhere(draft, targetInstanceId);
        if (!targetHit || targetHit.ownerId !== opponentId) return;
      }

      player.availableSync -= attackDef.syncCost;
      apex.hasAttacked = true;
      emitVfx({ type: 'ATTACK_DECLARED', apexInstanceId: attackerInstanceId, faction: apexDef.faction }, 600);
      logMsg(
        draft,
        `${apexDef.name} declares ${attackDef.name} (${attackDef.baseDamage} base damage, ${attackDef.syncCost} Sync).`,
        'attack'
      );

      const helpers = createHelpers(draft);
      const baseCtx = {
        helpers,
        ownerId: draft.activePlayerId,
        attackerInstanceId,
        targetInstanceId,
        syncCost: attackDef.syncCost,
        baseDamage: attackDef.baseDamage,
      };

      if (targetInstanceId) {
        const target = findApexAnywhere(draft, targetInstanceId)?.apex;
        if (target && (target.counters?.choke ?? 0) > 0 && apexDef.onAttackTargetWithChoke) {
          apexDef.onAttackTargetWithChoke(baseCtx);
        }
      }

      // Single source of truth for damage math - the same helper the Combat Phase attack
      // selector uses to preview this exact number before anything is committed.
      const preview = getPreviewAttackDamage(draft, attackerInstanceId, attackId, targetInstanceId)!;
      for (const mod of preview.modifiers) {
        logMsg(
          draft,
          `${apexDef.name} ${mod.amount >= 0 ? 'gains' : 'loses'} ${Math.abs(mod.amount)} attack (${mod.label}).`,
          'attack'
        );
      }
      let total = preview.modifiedDamage;

      // Overdrive: an optional Momentum spend for +100, decided before this action was
      // called (by the human prompt or the AI heuristic) - applies to whichever chained
      // Ability Support (Spark-Plug or Juice-Box) is actually eligible on this attack.
      // Only one can ever be chained to a given Apex at a time (1 Ability Support per Apex).
      if (overdriveSpend !== undefined) {
        const eligible = getOverdriveEligibility(draft, attackerInstanceId);
        if (eligible && overdriveSpend) {
          loseMomentumFn(draft, draft.activePlayerId, 1);
          emitVfx({ type: 'MOMENTUM_SPENT', playerId: draft.activePlayerId, label: '-1' });
          logMsg(draft, `${draft.activePlayerId} spends 1 Momentum for ${eligible.supportName} Overdrive.`, 'momentum');
          emitVfx(
            { type: 'ENGINE_TRIGGER', apexInstanceId: eligible.supportInstanceId, linkedInstanceId: attackerInstanceId, faction: apexDef.faction },
            700
          );
          if (eligible.supportDefId === 'nu-spark-plug') {
            total += 100;
            logMsg(draft, 'Spark-Plug Overdrive adds +100 damage to this attack.', 'attack');
          } else {
            apex.pendingJuiceBoxOverdrive = true;
          }
        } else if (eligible && !overdriveSpend) {
          logMsg(draft, `${draft.activePlayerId} skips ${eligible.supportName} Overdrive.`, 'info');
        }
      }

      // Consume the one-shot bonuses the preview just read (mirrors exactly which ones
      // getPreviewAttackDamage included, so nothing is double-spent or left stale).
      if (apex.armedBonus) apex.armedBonus = 0;
      if (player.pendingAttackBonus) player.pendingAttackBonus = 0;
      if (player.pendingTargetedAttackBonus && targetInstanceId && player.pendingTargetedAttackBonus.targetInstanceId === targetInstanceId) {
        player.pendingTargetedAttackBonus = null;
      }

      const targetLabel = targetInstanceId
        ? getCardDef(findApexAnywhere(draft, targetInstanceId)!.apex.defId).name
        : `${opponentId}'s O2 directly`;
      logMsg(draft, `${apexDef.name} attacks ${targetLabel} for ${total} damage.`, 'attack');

      const targetHadChoke = targetInstanceId ? (findApexAnywhere(draft, targetInstanceId)?.apex.counters?.choke ?? 0) > 0 : false;

      const trigger: AttackTriggerData = {
        kind: 'enemyApexAttacks',
        attackerId: draft.activePlayerId,
        attackerInstanceId,
        attackDefId: attackId,
        targetInstanceId,
        syncCost: attackDef.syncCost,
        totalDamage: total,
        cannotBeRedirected: attackDef.cannotBeRedirected,
        targetHadChoke,
      };

      let opened = false;
      if (!attackDef.cannotBeRedirected) {
        opened = maybeOpenResponseWindow(draft, opponentId, { kind: 'ATTACK_DECLARED', data: trigger }, () => {
          draft.pendingResponseQueue.push({
            id: newId('rx'),
            stage: 'reactionChoice',
            respondingPlayerId: opponentId,
            trigger,
          });
        });
      }
      if (opened) return;

      resolveAttackAgainstTarget(draft, trigger, total);
    }),

  resolveResponse: (choice) =>
    mutate(set, (draft) => {
      const item = draft.pendingResponseQueue[0];
      if (!item) return;
      draft.pendingResponseQueue.shift();
      const helpers = createHelpers(draft);

      if (item.stage === 'reactionChoice') {
        const trigger = item.trigger;

        if (choice.type === 'reaction') {
          const player = draft.players[item.respondingPlayerId];
          const idx = player.hand.findIndex((c) => c.instanceId === choice.cardInstanceId);
          if (idx === -1) {
            logMsg(draft, `${item.respondingPlayerId} passed.`, 'response');
            continueTriggerUnmodified(draft, trigger);
            maybeLogActionResolved(draft);
            return;
          }
          const cardInstance = player.hand[idx];
          const reactionDef = getCardDef(cardInstance.defId) as ReactionDef;
          if (
            reactionDef.type !== 'Reaction' ||
            reactionDef.trigger !== trigger.kind ||
            player.momentum < reactionDef.cost ||
            player.turnFlags.instantsPlayedThisTurn >= 1
          ) {
            logMsg(draft, `${item.respondingPlayerId} passed.`, 'response');
            continueTriggerUnmodified(draft, trigger);
            maybeLogActionResolved(draft);
            return;
          }
          player.hand.splice(idx, 1);
          player.voidZone.push(cardInstance);
          loseMomentumFn(draft, item.respondingPlayerId, reactionDef.cost);
          emitVfx({ type: 'MOMENTUM_SPENT', playerId: item.respondingPlayerId, label: `-${reactionDef.cost}` });
          player.turnFlags.instantsPlayedThisTurn += 1;
          emitVfx({ type: 'REACT_PLAYED', playerId: item.respondingPlayerId, faction: reactionDef.faction, label: reactionDef.name, cardDefId: cardInstance.defId });
          logMsg(draft, `${item.respondingPlayerId} played ${reactionDef.name}.`, 'response');

          // A Negate may itself respond to this Reaction being played (ON_REACTION_PLAYED).
          // Single extra layer only - no arbitrary stacking.
          const negatingPlayerId = otherPlayer(item.respondingPlayerId);
          const negateOpened = maybeOpenResponseWindow(
            draft,
            negatingPlayerId,
            playedCardEvent('REACTION_PLAYED', {
              cardType: 'Reaction',
              cardFaction: reactionDef.faction,
              cardOwnerId: item.respondingPlayerId,
              cardInstanceId: cardInstance.instanceId,
            }),
            () => {
              draft.pendingResponseQueue.push({
                id: newId('negate'),
                stage: 'negateWindow',
                negatingPlayerId,
                cardOwnerId: item.respondingPlayerId,
                cardInstanceId: cardInstance.instanceId,
                cardDefId: reactionDef.id,
                cardType: 'Reaction',
                cardFaction: reactionDef.faction,
                continuation: {
                  kind: 'resolveReactionThenFinishTrigger',
                  reactionOwnerId: item.respondingPlayerId,
                  trigger,
                },
              });
            }
          );
          if (negateOpened) return;

          applyChosenReactionAndContinue(draft, trigger, reactionDef, item.respondingPlayerId);
          maybeLogActionResolved(draft);
          return;
        }

        logMsg(draft, `${item.respondingPlayerId} passed.`, 'response');
        continueTriggerUnmodified(draft, trigger);
        maybeLogActionResolved(draft);
        return;
      }

      if (item.stage === 'negateWindow') {
        if (choice.type === 'negate') {
          const player = draft.players[item.negatingPlayerId];
          const idx = player.hand.findIndex((c) => c.instanceId === choice.cardInstanceId);
          const negateInstance = idx !== -1 ? player.hand[idx] : undefined;
          const negateDef = negateInstance ? (getCardDef(negateInstance.defId) as ReactionDef) : undefined;

          if (
            negateInstance &&
            negateDef &&
            negateDef.type === 'Reaction' &&
            typeof negateDef.canCancel === 'function' &&
            player.momentum >= negateDef.cost &&
            player.turnFlags.instantsPlayedThisTurn < 1 &&
            negateDef.canCancel(item.cardType, item.cardFaction)
          ) {
            player.hand.splice(idx, 1);
            player.voidZone.push(negateInstance);
            loseMomentumFn(draft, item.negatingPlayerId, negateDef.cost);
            emitVfx({ type: 'MOMENTUM_SPENT', playerId: item.negatingPlayerId, label: `-${negateDef.cost}` });
            player.turnFlags.instantsPlayedThisTurn += 1;
            emitVfx({ type: 'CARD_NEGATED', playerId: item.cardOwnerId, faction: item.cardFaction, label: getCardDef(item.cardDefId).name, cardDefId: item.cardDefId });
            logMsg(draft, `${item.negatingPlayerId} played ${negateDef.name}.`, 'response');
            logMsg(draft, `${negateDef.name} cancels ${getCardDef(item.cardDefId).name}.`, 'response');
            negateDef.resolve({
              helpers,
              ownerId: item.negatingPlayerId,
              cancelledCardInstanceId: item.cardInstanceId,
              cancelledFaction: item.cardFaction,
            });
            if (item.cardType === 'Equip' && item.pendingCardInstance) {
              draft.players[item.cardOwnerId].voidZone.push(item.pendingCardInstance);
            }
            if (item.continuation.kind === 'resolveReactionThenFinishTrigger') {
              // The Reaction itself never applies - the original event still needs to finish,
              // just as if the responding player had passed instead of playing it.
              continueTriggerUnmodified(draft, item.continuation.trigger);
            }
            maybeLogActionResolved(draft);
            return;
          }
        }

        logMsg(draft, `${item.negatingPlayerId} passed.`, 'response');
        if (item.continuation.kind === 'resolveSpecial') {
          const def = getCardDef(item.cardDefId) as SpecialDef;
          def.resolve({
            helpers,
            ownerId: item.continuation.ownerId,
            targetApexInstanceId: item.continuation.targetApexInstanceId,
          });
          maybeTriggerHumanErrorChoice(draft, item.continuation.ownerId);
        } else if (item.continuation.kind === 'resolveEquip' && item.pendingCardInstance) {
          const hit = findApexAnywhere(draft, item.continuation.apexInstanceId);
          if (hit) {
            hit.apex.equip = item.pendingCardInstance;
            hit.apex.equip.equippedTurn = draft.turnNumber;
            emitVfx({ type: 'CARD_PLACED', apexInstanceId: hit.apex.instanceId, faction: getCardDef(item.pendingCardInstance.defId).faction, cardDefId: item.pendingCardInstance.defId }, 1000);
            logMsg(draft, `${getCardDef(item.pendingCardInstance.defId).name} attaches to ${getCardDef(hit.apex.defId).name}.`, 'play');
          }
        } else if (item.continuation.kind === 'resolveEquipSwap' && item.pendingCardInstance) {
          const hit = findApexAnywhere(draft, item.continuation.apexInstanceId);
          if (hit) {
            const player = draft.players[item.continuation.ownerId];
            const oldEquip = hit.apex.equip;
            if (oldEquip) {
              // Clean copy back to hand - no lingering runtime state from being equipped.
              player.hand.push({ instanceId: oldEquip.instanceId, defId: oldEquip.defId, type: oldEquip.type });
              logMsg(draft, `${getCardDef(oldEquip.defId).name} returns to hand (Equip Swap).`, 'play');
            }
            hit.apex.equip = item.pendingCardInstance;
            hit.apex.equip.equippedTurn = draft.turnNumber;
            emitVfx({ type: 'CARD_PLACED', apexInstanceId: hit.apex.instanceId, faction: getCardDef(item.pendingCardInstance.defId).faction, cardDefId: item.pendingCardInstance.defId }, 1000);
            logMsg(draft, `${getCardDef(item.pendingCardInstance.defId).name} attaches to ${getCardDef(hit.apex.defId).name} (Equip Swap).`, 'play');
          }
        } else if (item.continuation.kind === 'resolveReactionThenFinishTrigger') {
          const reactionDef = getCardDef(item.cardDefId) as ReactionDef;
          applyChosenReactionAndContinue(draft, item.continuation.trigger, reactionDef, item.continuation.reactionOwnerId);
        }
        maybeLogActionResolved(draft);
        return;
      }

      if (item.stage === 'humanErrorChoice') {
        emitVfx({ type: 'RIFT_TRIGGER', playerId: item.playerId }, 800);
        if (choice.type === 'humanError' && choice.pick === 'momentum') {
          gainMomentumFn(draft, item.playerId, 1);
          emitVfx({ type: 'MOMENTUM_GAINED', playerId: item.playerId, label: '+1' });
          logMsg(draft, `Human Error: ${item.playerId} chooses +1 Momentum.`, 'rift');
        } else {
          draft.players[item.playerId].pendingAttackBonus += 100;
          logMsg(draft, `Human Error: ${item.playerId} primes their next Apex attack this turn for +100 damage.`, 'rift');
        }
        return;
      }

      if (item.stage === 'civilWarChoice') {
        emitVfx({ type: 'RIFT_TRIGGER', playerId: item.playerId }, 800);
        if (choice.type === 'civilWar' && choice.pick === 'momentum') {
          gainMomentumFn(draft, item.playerId, 1);
          emitVfx({ type: 'MOMENTUM_GAINED', playerId: item.playerId, label: '+1' });
          logMsg(draft, `Civil War: ${item.playerId} chooses +1 Momentum.`, 'rift');
        } else {
          draft.players[item.playerId].pendingAttackBonus += 100;
          logMsg(draft, `Civil War: ${item.playerId} chooses +100 damage for their first Apex attack this turn.`, 'rift');
        }
        return;
      }
    }),

  resetToMenu: () => mutate(set, (draft) => Object.assign(draft, initialState())),
  toggleDebugMode: () => mutate(set, (draft) => { draft.debugMode = !draft.debugMode; }),
}));

export type { GameStore };
