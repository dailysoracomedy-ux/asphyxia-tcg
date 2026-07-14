'use client';

import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '@/store/gameStore';
import { getCardDef } from '@/data/cards';
import type { ApexDef, SpecialDef, PlayerId, GameState, CardInstance } from '@/types/game';
import PlayerBoard from './PlayerBoard';
import Hand from './Hand';
import RiftPanel from './RiftPanel';
import GameLog from './GameLog';
import CombatControls from './CombatControls';
import AttackSelectorModal from './AttackSelectorModal';
import HotseatResponseGate from './HotseatResponseGate';
import Card from './Card';
import CardInspectModal, { type InspectZone } from './CardInspectModal';
import ActionBanner from './ActionBanner';
import TutorialPanel from './TutorialPanel';
import TutorialOverlay from './TutorialOverlay';
import TutorialSlideshow from '@/tutorial/TutorialSlideshow';
import Sidebar from './Sidebar';
import { TUTORIAL_PACING_MULTIPLIER, TUTORIAL_STEPS, type GuidedAction } from '@/tutorial/tutorialSteps';
import { useTutorialStore } from '@/store/tutorialStore';
import AudioController from '@/audio/AudioController';
import { playSfx } from '@/audio/sfx';
import { canPlayCardFromHand } from '@/lib/cardPlayability';
import { useCeremonyBusy } from '@/store/animationStore';
import { useShowcaseStore, currentShowcaseMultiplier, SHOWCASE_SPEED_MIN, SHOWCASE_SPEED_MAX } from '@/store/showcaseStore';
import VoidInspectModal from './VoidInspectModal';
import { factionTheme } from '@/lib/theme';
import { aiPlayOneMainPhaseAction, aiPlayOneCombatAction, aiDecideControlConflict, aiChooseBinaryRiftBonus, aiChooseResponse } from '@/game/ai';
import { useDragDrop } from '@/ui/dragDrop/DragDropLayer';
import DragDropLayer from '@/ui/dragDrop/DragDropLayer';
import { legalZonesFor, resolveDrop } from '@/ui/dragDrop/dragDropLogic';
import type { DragSource, DropZoneId } from '@/ui/dragDrop/dragDropTypes';
import { zoneKey } from '@/ui/dragDrop/dragDropTypes';
import {
  getOverdriveEligibility,
  findApexAnywhere,
  getPreviewAttackDamage,
  getEffectiveDef,
  overflowToO2Loss,
} from '@/game/rules';

const PHASE_LABEL: Record<string, string> = { Start: 'Draw', Main: 'Main', Combat: 'Combat', End: 'End' };

const ACTION_LOCK_MS = 500;
/** Module-level, not inside the component, specifically so the Date.now() call
 *  isn't flagged as an impure call during render - these are only ever invoked
 *  from event handlers (never during the render pass itself), but React's
 *  stricter lint rules can't distinguish that from the function's static
 *  location alone. Takes the ref as a parameter rather than closing over one. */
function isActionLockedUntil(ref: React.RefObject<number>): boolean {
  return Date.now() < ref.current;
}
function setActionLockUntil(ref: React.RefObject<number>) {
  ref.current = Date.now() + ACTION_LOCK_MS;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'apexReady'; cardId: string }
  | { kind: 'supportReady'; cardId: string }
  | { kind: 'supportChooseChain'; cardId: string }
  | { kind: 'equipReady'; cardId: string }
  | { kind: 'specialReady'; cardId: string; requiresTarget: SpecialDef['requiresTarget'] }
  | { kind: 'reconfigureReturn' }
  | { kind: 'reconfigurePlay'; returnId: string }
  | { kind: 'reconfigureChain'; returnId: string; playId: string }
  | { kind: 'equipSwapSelectApex' }
  | { kind: 'equipSwapSelectCard'; apexId: string }
  | { kind: 'attackerChosen'; attackerId: string }
  | { kind: 'attackAwaitingTarget'; attackerId: string; attackId: string }
  | { kind: 'rechainSelectApex'; supportId: string }
  | { kind: 'attackChoicePending'; attackerId: string; targetId?: string }
  | { kind: 'overdrivePrompt'; attackerId: string; attackId: string; targetId?: string; supportName: string };

export default function GameBoard() {
  const state = useGameStore();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const { drag, beginPotentialDrag } = useDragDrop(handleDragDrop);
  const [actionToast, setActionToast] = useState<string | null>(null);
  useEffect(() => {
    if (!actionToast) return;
    const t = setTimeout(() => setActionToast(null), 2000);
    return () => clearTimeout(t);
  }, [actionToast]);

  /** Commit 29.17 - simplified to match the tutorial's new fully-scripted
   *  design: every single game action, for both players, is now a hardcoded
   *  sequence run from a tutorial step's onEnter (see tutorialSteps.ts). There
   *  is no player-driven game action left to selectively allow or block by
   *  matching against a required action type - during tutorial mode, this
   *  unconditionally blocks every one of these handlers, full stop. The
   *  TutorialOverlay already prevents the click from visually reaching
   *  anything; this is the input-handler-level backstop underneath it.
   *  Outside tutorial mode this is always false and costs nothing. */
  /** Commit 31 - the current guided step's required action, or null outside
   *  tutorial mode / during a pure-explanation step. The single source of
   *  truth every gated interaction point below reads from. */
  function currentGuidedAction(): GuidedAction | null {
    if (!state.tutorialMode) return null;
    return TUTORIAL_STEPS[useTutorialStore.getState().step]?.guided ?? null;
  }

  /** Commit 31 - the single tutorial gate every real interaction point checks
   *  through. `matches` is the caller's own answer to "is this specific
   *  card/zone/choice the one the current guided step is waiting on" -
   *  outside tutorial mode this always passes through untouched (`matches`
   *  is never even evaluated as blocking), so every call site behaves
   *  identically in normal play. When blocked, sets a brief, friendly
   *  helper-message rather than silently doing nothing - never mutates
   *  state, never advances anything on its own. */
  function tutorialGate(matches: boolean, rejectMessage: string): boolean {
    if (!state.tutorialMode) return false;
    if (matches) return false;
    playSfx('ui.invalid');
    useTutorialStore.getState().setHelperMessage(rejectMessage);
    return true;
  }

  /** Commit 31 - advances the guided tutorial to its next step. Only ever
   *  called right after a real, successful player action was confirmed to
   *  match the current guided step - never speculatively. */
  function tutorialAdvance() {
    if (!state.tutorialMode) return;
    useTutorialStore.getState().setHelperMessage(null);
    useTutorialStore.getState().setStep(useTutorialStore.getState().step + 1);
  }

  function blockedByTutorial(): boolean {
    if (!state.tutorialMode) return false;
    setActionToast('Follow the tutorial prompt to continue.');
    return true;
  }
  const [logOpen, setLogOpen] = useState(false);
  const [inspected, setInspected] = useState<{ instance: CardInstance; ownerId: PlayerId | null; zone: InspectZone } | null>(null);
  const [voidInspecting, setVoidInspecting] = useState<PlayerId | null>(null);
  // Hand's container uses this as its min-width, so it never reads narrower than
  // the board itself, but can still grow past it for a large hand. Measured live
  // (not a guessed constant) so it can never silently drift out of sync if the
  // board's own width changes for some other reason later.
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!boardRef.current) return;
    const el = boardRef.current;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setBoardWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const recentMoves = state.log.slice(-4);

  // Draw Phase is automatic: resolve the draw itself, then move straight to Main Phase,
  // except when Control Conflict's optional lock decision is available - that pauses
  // here (a "Continue to Main Phase" button lets the player move on explicitly, and the
  // AI driver below makes its own lock/skip decision and advances the phase itself).
  useEffect(() => {
    if (state.status !== 'playing') return;
    if (state.pendingResponseQueue.length > 0) return;
    if (state.phase === 'Start' && state.startPhasePending) {
      const t = setTimeout(() => useGameStore.getState().advancePhase('Start'), 300);
      return () => clearTimeout(t);
    }
    if (state.phase === 'Start' && !state.startPhasePending) {
      const active = state.players[state.activePlayerId];
      const controlConflictPause =
        state.riftSpace?.id === 'ControlConflict' && active.supportSlots.some(Boolean) && !active.lockedSupportInstanceId;
      if (!controlConflictPause) {
        const t = setTimeout(() => useGameStore.getState().advancePhase('Main'), 300);
        return () => clearTimeout(t);
      }
    }
  }, [state]);

  // Auto-end-turn (Commit 24.1): once the active human player's last Apex that
  // could attack has attacked (or they have no Apex left at all), there's nothing
  // further for them to legally do in Combat - End Turn automatically instead of
  // making them click it. Scoped to the human specifically (never fires during the
  // AI's own turn - the AI's ai.ts heuristics decide its own turn-ending timing,
  // which can reasonably differ from "attacked with everything"). A short delay
  // lets the last attack's animations actually finish being seen first, matching
  // the same "instant logic, paced presentation" principle the pacing lock uses.
  useEffect(() => {
    if (state.status !== 'playing' || state.phase !== 'Combat') return;
    if (state.pendingResponseQueue.length > 0) return;
    if (state.tutorialMode) return; // turn-ending during tutorial is driven by the guided steps themselves, never automatic
    if ((state.vsAI && state.activePlayerId === 'player2') || state.aiVsAiMode) return; // never auto-ends an AI-controlled turn
    const active = state.players[state.activePlayerId];
    const anyApexCanStillAttack = active.apexSlots.some((a) => a && !a.hasAttacked);
    if (anyApexCanStillAttack) return;
    const t = setTimeout(() => useGameStore.getState().endTurn(), 900);
    return () => clearTimeout(t);
  }, [state]);

  // AI driver: active in Vs AI mode (always player2) and in AI vs AI Showcase mode
  // (Commit 29 - both players). Re-runs on every state change (since each AI
  // action mutates the store and produces a new state reference), which naturally
  // forms a "decide one thing, wait, re-evaluate" loop without needing a manual
  // queue. Every branch bails out immediately if it's not an AI-controlled
  // player's turn, the game has ended, a human response is pending, or (Showcase
  // mode) playback is paused.
  //
  // Commit 25: also bails out while the game is "in ceremony" (an action banner is
  // showing, or any other event with a ceremony duration is still playing out) -
  // this is the actual fix for AI actions outrunning the banner explaining them.
  // ceremonyBusy is a reactive subscription (not a ref), specifically so this
  // effect re-fires the moment ceremony clears, the same way it already re-fires
  // on every state change - the AI's own decision timing (the 600-700ms below,
  // scaled by Showcase speed) then still applies on top, exactly as before.
  const ceremonyBusy = useCeremonyBusy();
  const showcasePaused = useShowcaseStore((s) => s.active && s.paused);

  // Tutorial-mode pacing (Commit 29.3): reuses the exact same speed-scaling
  // mechanism built for AI vs AI Showcase (which already scales ceremony
  // durations, banner dwell time, and the AI driver's own decision timers)
  // rather than building separate tutorial-specific timing logic. Reported: the
  // opponent's scripted attack happened too fast to actually watch/understand.
  // No visible speed controls render here (ShowcaseControls stays showcase-only)
  // - this just quietly asks the same mechanism to slow down while a tutorial
  // match is active, and hands control back the moment it isn't.
  useEffect(() => {
    if (!state.tutorialMode) return;
    useShowcaseStore.getState().setSpeedMultiplier(TUTORIAL_PACING_MULTIPLIER);
    useShowcaseStore.getState().setActive(true);
    return () => useShowcaseStore.getState().setActive(false);
  }, [state.tutorialMode]);
  useEffect(() => {
    if (!state.vsAI && !state.aiVsAiMode) return;
    // Commit 29.14 - the real AI driver never runs during tutorial mode at all,
    // for anything: not opponent turns, not opponent response-window decisions.
    // Every opponent action in the tutorial is now a directly-scripted store
    // call (see tutorialSteps.ts's scriptedOpponentActions), not a decision the
    // AI makes - the whole point of this rebuild was removing AI unpredictability
    // from the tutorial's script entirely, not just biasing it toward good
    // outcomes. Normal Vs AI and AI vs AI Showcase are completely untouched.
    if (state.tutorialMode) return;
    if (state.status !== 'playing') return;
    if (ceremonyBusy || showcasePaused) return;
    const mult = currentShowcaseMultiplier();
    // In normal Vs AI, only player2 is ever AI-controlled. In Showcase mode, both
    // players are - "is this player AI-controlled" reduces to just "is it their
    // turn/response to make" in that case.
    const isAiControlled = (pid: PlayerId) => (state.aiVsAiMode ? true : pid === 'player2');

    // A response window may need EITHER player - only act if it's specifically an AI's turn to respond.
    if (state.pendingResponseQueue.length > 0) {
      const item = state.pendingResponseQueue[0];
      if (item.stage === 'reactionChoice' && isAiControlled(item.respondingPlayerId)) {
        const t = setTimeout(() => useGameStore.getState().resolveResponse(aiChooseResponse(item.respondingPlayerId, item)), 700 * mult);
        return () => clearTimeout(t);
      }
      if (item.stage === 'negateWindow' && isAiControlled(item.negatingPlayerId)) {
        const t = setTimeout(() => useGameStore.getState().resolveResponse(aiChooseResponse(item.negatingPlayerId, item)), 700 * mult);
        return () => clearTimeout(t);
      }
      if (item.stage === 'civilWarChoice' && isAiControlled(item.playerId)) {
        const t = setTimeout(
          () => useGameStore.getState().resolveResponse({ type: 'civilWar', pick: aiChooseBinaryRiftBonus(item.playerId) }),
          600 * mult
        );
        return () => clearTimeout(t);
      }
      if (item.stage === 'humanErrorChoice' && isAiControlled(item.playerId)) {
        const t = setTimeout(
          () => useGameStore.getState().resolveResponse({ type: 'humanError', pick: aiChooseBinaryRiftBonus(item.playerId) }),
          600 * mult
        );
        return () => clearTimeout(t);
      }
      return; // some other response is pending (likely awaiting the human) - AI waits
    }

    if (!isAiControlled(state.activePlayerId)) return; // not an AI-controlled player's turn
    const acting = state.activePlayerId;

    if (state.phase === 'Start' && !state.startPhasePending && state.riftSpace?.id === 'ControlConflict') {
      const active = state.players[acting];
      if (active.supportSlots.some(Boolean) && !active.lockedSupportInstanceId) {
        const t = setTimeout(() => aiDecideControlConflict(acting), 600 * mult);
        return () => clearTimeout(t);
      }
      return; // otherwise let the shared Draw Phase effect above auto-advance to Main
    }

    if (state.phase === 'Combat') {
      // Commit 30.4 - Main and Combat are merged now (advancePhase('Main')
      // auto-chains straight into 'Combat'), so there's no longer a distinct
      // 'Main' phase value for the AI to branch on separately. Tries a
      // main-phase-style action first (playing a card) every tick; once
      // there's nothing left to play, falls through to a combat action
      // (attacking); once there's nothing left to attack with either, ends
      // the turn. Same real actions as before, just no longer gated behind
      // a phase value that no longer persists long enough to branch on.
      const t = setTimeout(() => {
        const playedCard = aiPlayOneMainPhaseAction(acting);
        if (playedCard) return;
        const attacked = aiPlayOneCombatAction(acting);
        if (!attacked) useGameStore.getState().endTurn();
      }, 650 * mult);
      return () => clearTimeout(t);
    }
  }, [state, ceremonyBusy, showcasePaused]);
  const [lastSeenLogCount, setLastSeenLogCount] = useState(0);

  /**
   * Root-cause fix for the "click a phase button and the page jumps to the top" bug.
   * The phase/end-turn buttons intentionally become `disabled` the instant their own
   * click handler updates state (e.g. clicking "Main Phase" makes that same button
   * `enabled=false` on the very next render). When a focused element becomes disabled,
   * browsers forcibly move focus away from it - typically to <body> - and that focus
   * shift is what triggers the native scroll-to-top. Blurring the button ourselves
   * *before* the state update runs avoids that forced-focus-loss path entirely, since
   * blur() on a still-enabled element is a normal, harmless operation.
   * The scroll-position snapshot/restore is kept as a defensive backstop in case any
   * other button (or a future one) exhibits the same disabled-focus issue.
   */
  function scrollSafeClick(handler: () => void) {
    return (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.blur();
      const scrollY = window.scrollY;
      playSfx('ui.click');
      handler();
      requestAnimationFrame(() => {
        if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: 'auto' });
      });
    };
  }

  // "What can I do now?" prompt (Commit 29 Flow QoL) - short, derived guidance text
  // shown above the board. Every mode that already has its own ConfirmBar/target-
  // selection UI explains itself there; this specifically covers the "idle, no
  // card selected yet" moments where a new player would otherwise have no idea
  // what their options even are.
  // Brief pacing lock after a significant action (attack declared, card played) -
  // game logic itself stays fully instant (see gameStore.ts), this only gates how
  // soon the UI accepts the *next* significant action, so the animation that just
  // fired has a moment to actually be seen rather than getting instantly buried by
  // whatever comes next. Deliberately a plain ref, not React state - a lock that
  // itself triggered re-renders would fight with the very animations it's trying
  // to protect.
  const actionLockedUntilRef = useRef(0);
  function isActionLocked(): boolean {
    return isActionLockedUntil(actionLockedUntilRef);
  }
  function lockActions() {
    setActionLockUntil(actionLockedUntilRef);
  }

  const slideshowActive = useTutorialStore((s) => s.slideshowActive);
  if (state.tutorialMode && slideshowActive) {
    return <TutorialSlideshow onComplete={() => useTutorialStore.getState().setSlideshowActive(false)} />;
  }

  if (state.status === 'selectingOpeningApex') {
    return (
      <>
        <OpeningApexScreen />
        {state.tutorialMode && <TutorialPanel />}
      </>
    );
  }
  if (state.status === 'gameover' && !ceremonyBusy) {
    return (
      <>
        <GameOverScreen />
        {state.tutorialMode && <TutorialPanel />}
      </>
    );
  }
  if (state.status !== 'playing' && !(state.status === 'gameover' && ceremonyBusy)) return null;

  const activeId = state.activePlayerId;
  const aiIsActing = !state.debugMode && (!!state.aiVsAiMode || (state.vsAI && activeId === 'player2'));
  const oppId: PlayerId = activeId === 'player1' ? 'player2' : 'player1';
  const activePlayer = state.players[activeId];
  const oppPlayer = state.players[oppId];

  // Viewer-relative board identity: in Vs AI mode the human (player1) always sits at
  // the bottom and the AI (player2) always sits at the top, regardless of whose turn
  // it actually is - the viewport never swaps, so the human watches AI actions happen
  // on the top board while their own board/hand stays put. In Hotseat, the board still
  // swaps to whoever is active (the existing pass-and-play model).
  const viewerBottomId: PlayerId = state.vsAI || state.aiVsAiMode ? 'player1' : activeId;
  const viewerTopId: PlayerId = state.vsAI || state.aiVsAiMode ? 'player2' : oppId;
  const bottomIsActingPlayer = viewerBottomId === activeId;

  // "What can I do now?" prompt (Commit 29 Flow QoL) - short, derived guidance text
  // shown above the board. Every mode that already has its own ConfirmBar/target-
  // selection UI explains itself there; this specifically covers the "idle, no
  // card selected yet" moments where a new player would otherwise have no idea
  // what their options even are.
  function derivePhasePrompt(): string {
    if (aiIsActing) return 'Waiting for the AI...';
    if (!bottomIsActingPlayer) return "Waiting for the other player's turn...";
    if (mode.kind !== 'idle') return ''; // that mode's own ConfirmBar/prompt already explains itself
    if (state.phase === 'Start') return 'Drawing for the turn...';
    if (state.phase === 'Main' || state.phase === 'Combat') {
      const canPlayAnything = activePlayer.hand.some((c) => canPlayCardFromHand(state, activeId, c));
      const canStillAttack = activePlayer.apexSlots.some((a) => a && !a.hasAttacked);
      if (canPlayAnything && canStillAttack) return 'Drag a card to play it, or click an Apex to attack.';
      if (canPlayAnything) return 'Drag a card to play it.';
      if (canStillAttack) return 'Click an Apex to attack, or End Turn when ready.';
      return 'Nothing left to do - End Turn when ready.';
    }
    return '';
  }
  const phasePrompt = derivePhasePrompt();

  const selectedCard = mode.kind !== 'idle' && 'cardId' in mode ? activePlayer.hand.find((c) => c.instanceId === mode.cardId) : undefined;

  function resetMode() {
    setMode({ kind: 'idle' });
  }

  function selectHandCard(cardId: string) {
    const card = activePlayer.hand.find((c) => c.instanceId === cardId);
    if (!card || state.phase !== 'Main') return;
    if (isActionLocked()) return;
    if (blockedByTutorial()) return;
    if (mode.kind === 'equipSwapSelectCard') {
      if (card.type !== 'Equip') return;
      state.equipSwap(mode.apexId, cardId);
      lockActions();
      resetMode();
      return;
    }
    if (mode.kind !== 'idle' && 'cardId' in mode && mode.cardId === cardId) {
      resetMode();
      return;
    }
    if (card.type === 'Special' && activePlayer.turnFlags.specialsPlayedThisTurn >= 1) return;
    if (
      (card.type === 'AbilitySupport' || card.type === 'BatterySupport') &&
      activePlayer.turnFlags.supportsPlayedThisTurn >= 1
    ) {
      return;
    }
    switch (card.type) {
      case 'Apex': {
        const emptySlots = activePlayer.apexSlots.filter((s) => s === null).length;
        if (emptySlots === 1) {
          state.playApexCard(cardId);
          lockActions();
        } else {
          setMode({ kind: 'apexReady', cardId });
        }
        break;
      }
      case 'AbilitySupport':
        setMode({ kind: 'supportChooseChain', cardId });
        break;
      case 'BatterySupport': {
        const emptySlots = activePlayer.supportSlots.filter((s) => s === null).length;
        if (emptySlots === 1) {
          state.playSupportCard(cardId);
          lockActions();
        } else {
          setMode({ kind: 'supportReady', cardId });
        }
        break;
      }
      case 'Equip': {
        const eligibleApexes = activePlayer.apexSlots.filter((a): a is CardInstance => !!a && !a.equip);
        if (eligibleApexes.length === 1) {
          state.playEquipCard(cardId, eligibleApexes[0].instanceId);
          lockActions();
        } else {
          setMode({ kind: 'equipReady', cardId });
        }
        break;
      }
      case 'Special': {
        const def = getCardDef(card.defId) as SpecialDef;
        if (!def.requiresTarget) {
          state.playSpecialCard(cardId);
          lockActions();
        } else {
          setMode({ kind: 'specialReady', cardId, requiresTarget: def.requiresTarget });
        }
        break;
      }
      default:
        break;
    }
  }

  const handDisabledIds = new Set(
    mode.kind === 'equipSwapSelectCard'
      ? activePlayer.hand.filter((c) => c.type !== 'Equip').map((c) => c.instanceId)
      : activePlayer.hand
          .filter(
            (c) =>
              (c.type === 'Special' && activePlayer.turnFlags.specialsPlayedThisTurn >= 1) ||
              ((c.type === 'AbilitySupport' || c.type === 'BatterySupport') && activePlayer.turnFlags.supportsPlayedThisTurn >= 1)
          )
          .map((c) => c.instanceId)
  );

  function ownApexClick(apexId: string) {
    if (isActionLocked()) return;
    if (mode.kind === 'attackerChosen') return; // the attack popup is the only valid interaction right now
    if (mode.kind === 'equipSwapSelectApex') {
      const apex = activePlayer.apexSlots.find((a) => a?.instanceId === apexId);
      if (!apex?.equip || apex.equip.equippedTurn === state.turnNumber) return;
      setMode({ kind: 'equipSwapSelectCard', apexId });
      return;
    }
    if (mode.kind === 'supportChooseChain') {
      state.playSupportCard(mode.cardId, undefined, apexId);
      resetMode();
      return;
    }
    if (mode.kind === 'equipReady') {
      state.playEquipCard(mode.cardId, apexId);
      resetMode();
      return;
    }
    if (mode.kind === 'specialReady' && (mode.requiresTarget === 'ownApex' || mode.requiresTarget === 'ownApexWithUpgrade')) {
      const guidedSpecial = currentGuidedAction();
      if (state.tutorialMode) {
        if (tutorialGate(guidedSpecial?.kind === 'selectSpecialTarget', 'Follow the tutorial prompt to continue.')) return;
      }
      state.playSpecialCard(mode.cardId, apexId);
      resetMode();
      if (state.tutorialMode && guidedSpecial?.kind === 'selectSpecialTarget') tutorialAdvance();
      return;
    }
    if (mode.kind === 'reconfigureChain') {
      state.reconfigure(mode.returnId, mode.playId, apexId);
      resetMode();
      return;
    }
    if (mode.kind === 'rechainSelectApex') {
      state.chainSupport(mode.supportId, apexId);
      resetMode();
      return;
    }
    // Commit 30.4 - reverted per direct request: attacks are click-based
    // again, not drag. Clicking a ready Apex opens the new "blown up" attack
    // popup (see the attackerChosen-mode render block) instead of the old
    // inline CombatControls panel. No more explicit Combat Phase to be in
    // first either - Main and Combat are merged (see advancePhase's own
    // comment in gameStore.ts), so this fires any time during the player's
    // turn the moment they click a ready Apex.
    if (state.phase === 'Combat' || state.phase === 'Main') {
      const apex = activePlayer.apexSlots.find((a) => a?.instanceId === apexId);
      if (apex && !apex.hasAttacked) {
        if (isActionLocked()) return;
        if (state.isFirstTurnOverall) {
          playSfx('ui.invalid');
          setActionToast('You can\u2019t attack on your very first turn.');
          return;
        }
        const guided = currentGuidedAction();
        if (state.tutorialMode) {
          if (tutorialGate(guided?.kind === 'declareAttack', 'Follow the tutorial prompt to continue.')) return;
        }
        setMode({ kind: 'attackerChosen', attackerId: apexId });
        if (state.tutorialMode && guided?.kind === 'declareAttack') tutorialAdvance();
      }
    }
  }

  function ownSupportClick(supportId: string) {
    if (mode.kind === 'attackerChosen') return; // the attack popup is the only valid interaction right now
    if (mode.kind === 'reconfigureReturn') {
      setMode({ kind: 'reconfigurePlay', returnId: supportId });
      return;
    }
    if (mode.kind === 'idle' && (state.phase === 'Main' || state.phase === 'Combat')) {
      if (blockedByTutorial() || isActionLocked()) return;
      const support = activePlayer.supportSlots.find((s) => s?.instanceId === supportId);
      if (support?.type === 'AbilitySupport' && support.chainedApexId) {
        // Commit 30.3 - click a chained Ability Engine to unchain it directly
        // (no confirmation needed - this is a free, reversible board-state
        // toggle, not a new play). Click it again while unchained to re-enter
        // the existing select-an-Apex-to-chain flow below.
        state.unchainSupport(supportId);
        return;
      }
      if (support?.type === 'AbilitySupport' && !support.chainedApexId) {
        setMode({ kind: 'rechainSelectApex', supportId });
      }
    }
  }

  function oppApexClick(apexId: string) {
    if (mode.kind === 'attackerChosen') return; // the attack popup is the only valid interaction right now
    if (mode.kind === 'specialReady' && (mode.requiresTarget === 'enemyApex' || mode.requiresTarget === 'enemyApexWithChoke')) {
      const target = oppPlayer.apexSlots.find((a) => a?.instanceId === apexId);
      if (mode.requiresTarget === 'enemyApexWithChoke' && (target?.counters?.choke ?? 0) === 0) return;
      state.playSpecialCard(mode.cardId, apexId);
      resetMode();
      return;
    }
    if (mode.kind === 'attackAwaitingTarget') {
      const guided = currentGuidedAction();
      if (state.tutorialMode) {
        if (tutorialGate(guided?.kind === 'selectTarget', 'Follow the tutorial prompt to continue.')) return;
      }
      const eligible = getOverdriveEligibility(state, mode.attackerId);
      if (eligible) {
        setMode({ kind: 'overdrivePrompt', attackerId: mode.attackerId, attackId: mode.attackId, targetId: apexId, supportName: eligible.supportName });
      } else {
        state.declareAttack(mode.attackerId, mode.attackId, apexId);
        lockActions();
        resetMode();
        if (state.tutorialMode && guided?.kind === 'selectTarget') tutorialAdvance();
      }
    }
  }

  function chooseAttack(attackId: string) {
    if (mode.kind !== 'attackerChosen') return;
    if (isActionLocked()) return;
    const guided = currentGuidedAction();
    if (state.tutorialMode) {
      const attackerHit = findApexAnywhere(state, mode.attackerId);
      const attackDef = attackerHit ? (getCardDef(attackerHit.apex.defId) as ApexDef).attacks.find((a) => a.id === attackId) : null;
      const matches = guided?.kind === 'selectAttack' && attackDef?.syncCost === guided.syncCost;
      if (tutorialGate(matches, 'Not that attack yet. Try the highlighted row.')) return;
    }
    const hasEnemyApex = oppPlayer.apexSlots.some(Boolean);
    if (hasEnemyApex) {
      setMode({ kind: 'attackAwaitingTarget', attackerId: mode.attackerId, attackId });
      if (state.tutorialMode && guided?.kind === 'selectAttack') tutorialAdvance();
    } else {
      const eligible = getOverdriveEligibility(state, mode.attackerId);
      if (eligible) {
        setMode({ kind: 'overdrivePrompt', attackerId: mode.attackerId, attackId, supportName: eligible.supportName });
      } else {
        state.declareAttack(mode.attackerId, attackId);
        lockActions();
        resetMode();
        if (state.tutorialMode && guided?.kind === 'selectAttack') tutorialAdvance();
      }
    }
  }

  /** Commit 30.3 - resolves the attack-choice popup (mode.kind ===
   *  'attackChoicePending'): the drag already landed on a legal target, and
   *  the player is now picking which of several affordable attacks to use.
   *  Same Overdrive check as every other attack-resolution path. */
  function resolveChosenAttack(attackId: string) {
    if (mode.kind !== 'attackChoicePending') return;
    if (isActionLocked()) return;
    const eligible = getOverdriveEligibility(state, mode.attackerId);
    if (eligible) {
      setMode({ kind: 'overdrivePrompt', attackerId: mode.attackerId, attackId, targetId: mode.targetId, supportName: eligible.supportName });
    } else {
      state.declareAttack(mode.attackerId, attackId, mode.targetId);
      lockActions();
      resetMode();
    }
  }

  /** Commit 30 - the single resolution point for every successful drag/drop.
   *  Hand-card drops (Apex/Engine/Equip/Special) go through resolveDrop,
   *  which calls the exact same store actions as the click flow above -
   *  no second rules engine, no duplicated legality. Attack-target drops are
   *  handled directly here rather than through resolveDrop, since declaring
   *  an attack needs the same real Overdrive-eligibility check chooseAttack/
   *  oppApexClick already make before calling declareAttack - that's a real,
   *  unresolved choice per the spec, not a redundant confirm to skip. */
  function handleDragDrop(source: DragSource, target: DropZoneId) {
    if (isActionLocked()) return;

    if (source.kind === 'apex-attack') {
      const legal = legalZonesFor(state, source);
      if (!legal.has(zoneKey(target))) return;

      // Commit 30.3 - the new combat-targeting flow: drag the attacking Apex
      // straight onto a target, no prior click to choose the attack. If the
      // attacker only has one attack it can actually afford right now
      // (Sync-wise), that's not a real choice - resolve it immediately, same
      // as the old flow did once a target was chosen. If there's a genuine
      // choice (2+ affordable attacks), a compact popup asks which one -
      // that's a real decision, not a redundant confirm to skip.
      if (source.attackId) {
        const eligible = getOverdriveEligibility(state, source.instanceId);
        if (eligible) {
          setMode({ kind: 'overdrivePrompt', attackerId: source.instanceId, attackId: source.attackId, targetId: target.instanceId, supportName: eligible.supportName });
        } else {
          state.declareAttack(source.instanceId, source.attackId, target.instanceId);
          lockActions();
          resetMode();
        }
        return;
      }

      const attackerHit = findApexAnywhere(state, source.instanceId);
      const attackerDef = attackerHit ? (getCardDef(attackerHit.apex.defId) as ApexDef) : null;
      const affordable = attackerDef ? attackerDef.attacks.filter((a) => a.syncCost <= activePlayer.availableSync) : [];
      if (affordable.length === 0) {
        setActionToast('Not enough Sync for any attack right now.');
        return;
      }
      if (affordable.length === 1) {
        const attackId = affordable[0].id;
        const eligible = getOverdriveEligibility(state, source.instanceId);
        if (eligible) {
          setMode({ kind: 'overdrivePrompt', attackerId: source.instanceId, attackId, targetId: target.instanceId, supportName: eligible.supportName });
        } else {
          state.declareAttack(source.instanceId, attackId, target.instanceId);
          lockActions();
          resetMode();
        }
      } else {
        setMode({ kind: 'attackChoicePending', attackerId: source.instanceId, targetId: target.instanceId });
      }
      return;
    }

    // Commit 31.5 - a targeted Special landing on the Action Zone doesn't
    // resolve immediately - it enters specialReady mode instead, reusing
    // the existing (previously click-only) target-selection flow, so the
    // player picks the actual Apex next. A non-targeted Special still
    // resolves immediately, same as before.
    if (source.kind === 'hand-card' && source.cardType === 'Special' && target.kind === 'action-zone') {
      const card = activePlayer.hand.find((c) => c.instanceId === source.instanceId);
      const sdef = card ? (getCardDef(card.defId) as SpecialDef) : null;
      if (sdef?.requiresTarget) {
        setMode({ kind: 'specialReady', cardId: source.instanceId, requiresTarget: sdef.requiresTarget });
        if (state.tutorialMode) tutorialAdvance();
        return;
      }
    }

    const result = resolveDrop(state, source, target, {
      playApexCard: state.playApexCard,
      playSupportCard: state.playSupportCard,
      playEquipCard: state.playEquipCard,
      equipSwap: state.equipSwap,
      playSpecialCard: state.playSpecialCard,
    });
    if (result.ok) {
      lockActions();
      resetMode();
      if (state.tutorialMode) tutorialAdvance();
    } else if (result.reason) {
      playSfx('ui.invalid');
      setActionToast(state.tutorialMode ? 'That card doesn\u2019t go there. Try the glowing zone.' : result.reason);
    }
  }

  /** Commit 30 - starts a potential drag for a hand card. Only meaningful for
   *  the active player's own hand (Hand.tsx only wires this when the card is
   *  already confirmed playable) - legality of specific destinations is
   *  computed fresh here via legalZonesFor, the same function that drives
   *  which zones actually glow. */
  function onHandCardPointerDown(e: React.PointerEvent, card: CardInstance) {
    if (isActionLocked()) return;
    const guided = currentGuidedAction();
    const matchesCard =
      !!guided &&
      ((guided.kind === 'playApex' && card.defId === guided.defId) ||
        (guided.kind === 'playEngine' && card.defId === guided.defId) ||
        (guided.kind === 'playEquip' && card.defId === guided.defId) ||
        (guided.kind === 'playSpecial' && card.defId === guided.defId));
    if (state.tutorialMode) {
      if (tutorialGate(matchesCard, 'Not that one yet. Let\u2019s play the highlighted card first.')) return;
    }
    const source: DragSource = { kind: 'hand-card', playerId: viewerBottomId, instanceId: card.instanceId, cardType: card.type };
    beginPotentialDrag(e, source, legalZonesFor(state, source));
  }

  /** Commit 30 - starts a potential attack-target drag once an attacker and
   *  attack are already chosen by click (mode.kind === 'attackAwaitingTarget'),
   *  per the spec's guidance to keep the existing click Apex -> choose attack
   *  flow and add drag specifically for the final target step. */
  /** Commit 30.3 - starts an attack-target drag directly from any of the
   *  player's own ready-to-attack Apexes during Combat Phase, with no prior
   *  click needed to choose an attacker or attack first (the old flow
   *  required mode.kind === 'attackAwaitingTarget', meaning both were already
   *  chosen by click). Which specific attack to use is resolved after the
   *  drop lands on a legal target - see handleDragDrop's apex-attack branch -
   *  since it doesn't affect which targets are legal to drag onto in the
   *  first place. */
  /** Commit 30 - human-readable label for the drag ghost, shown by
   *  DragDropLayer while a drag is active. */
  const dragLabel = (() => {
    if (!drag.active || !drag.source) return null;
    if (drag.source.kind === 'apex-attack') {
      const attacker = state.players[drag.source.playerId].apexSlots.find((a) => a?.instanceId === drag.source!.instanceId);
      const attackDef = attacker ? (getCardDef(attacker.defId) as ApexDef).attacks.find((a) => a.id === drag.source!.attackId) : null;
      return attackDef?.name ?? 'Attack';
    }
    const card = state.players[drag.source.playerId].hand.find((c) => c.instanceId === drag.source!.instanceId);
    return card ? getCardDef(card.defId).name : null;
  })();

  /** Commit 30.2 - the actual dragged card, for DragDropLayer's real card
   *  preview (previously it only showed a text label with the card's name).
   *  Only meaningful for hand-card drags - an attack drag has no card
   *  instance of its own to preview (it's an already-placed Apex's chosen
   *  attack), so this is null there and DragDropLayer falls back to its text
   *  label. */
  const dragCardInstance = drag.active && drag.source && drag.source.kind === 'hand-card'
    ? state.players[drag.source.playerId].hand.find((c) => c.instanceId === drag.source!.instanceId) ?? null
    : null;

  const attackChoiceAttacker = mode.kind === 'attackChoicePending' ? activePlayer.apexSlots.find((a) => a?.instanceId === mode.attackerId) : null;
  const attackChoiceOptions =
    mode.kind === 'attackChoicePending' && attackChoiceAttacker
      ? (getCardDef(attackChoiceAttacker.defId) as ApexDef).attacks.filter((a) => a.syncCost <= activePlayer.availableSync)
      : [];

  const attackerApex =
    (mode.kind === 'attackerChosen' || mode.kind === 'attackAwaitingTarget') &&
    activePlayer.apexSlots.find((a) => a?.instanceId === mode.attackerId);
  const attackerDef = attackerApex ? (getCardDef(attackerApex.defId) as ApexDef) : null;

  const oppApexHighlight = (id: string): 'valid-target' | null => {
    if (state.tutorialMode) {
      const guided = currentGuidedAction();
      if (guided?.kind === 'selectTarget' && mode.kind === 'attackAwaitingTarget') return 'valid-target';
    }
    if (mode.kind === 'attackAwaitingTarget') return 'valid-target';
    if (mode.kind === 'specialReady' && (mode.requiresTarget === 'enemyApex' || mode.requiresTarget === 'enemyApexWithChoke')) {
      const target = oppPlayer.apexSlots.find((a) => a?.instanceId === id);
      if (mode.requiresTarget === 'enemyApexWithChoke' && (target?.counters?.choke ?? 0) === 0) return null;
      return 'valid-target';
    }
    return null;
  };

  function apexHasAbilitySupportChained(apexId: string): boolean {
    return activePlayer.supportSlots.some((s) => s?.type === 'AbilitySupport' && s.chainedApexId === apexId);
  }

  const ownApexHighlight = (id: string): 'valid-target' | null => {
    if (state.tutorialMode) {
      const guided = currentGuidedAction();
      if (guided?.kind === 'declareAttack') {
        const apex = activePlayer.apexSlots.find((a) => a?.instanceId === id);
        return apex && !apex.hasAttacked ? 'valid-target' : null;
      }
    }
    if (mode.kind === 'equipSwapSelectApex') {
      const apex = activePlayer.apexSlots.find((a) => a?.instanceId === id);
      return apex?.equip && apex.equip.equippedTurn !== state.turnNumber ? 'valid-target' : null;
    }
    if (mode.kind === 'supportChooseChain' || mode.kind === 'reconfigureChain' || mode.kind === 'rechainSelectApex') {
      return apexHasAbilitySupportChained(id) ? null : 'valid-target';
    }
    if (mode.kind === 'equipReady') return 'valid-target';
    if (mode.kind === 'specialReady' && (mode.requiresTarget === 'ownApex' || mode.requiresTarget === 'ownApexWithUpgrade')) {
      const target = activePlayer.apexSlots.find((a) => a?.instanceId === id);
      if (mode.requiresTarget === 'ownApexWithUpgrade' && (target?.counters?.upgrade ?? 0) === 0) return null;
      return 'valid-target';
    }
    return null;
  };

  function ownApexDisabled(id: string): boolean {
    if (mode.kind === 'equipSwapSelectApex') {
      const apex = activePlayer.apexSlots.find((a) => a?.instanceId === id);
      return !(apex?.equip && apex.equip.equippedTurn !== state.turnNumber);
    }
    if (mode.kind === 'supportChooseChain' || mode.kind === 'reconfigureChain' || mode.kind === 'rechainSelectApex') {
      return apexHasAbilitySupportChained(id);
    }
    return false;
  }

  const reconfigureDisabled = activePlayer.turnFlags.reconfigureUsedThisTurn || state.phase !== 'Main';
  const equipSwapDisabled = activePlayer.turnFlags.equipSwapUsedThisTurn || state.phase !== 'Main';
  const supportBudgetSpent = activePlayer.turnFlags.supportsPlayedThisTurn >= 1;
  const eligibleReconfigurePlays =
    mode.kind === 'reconfigurePlay' && !supportBudgetSpent
      ? activePlayer.hand.filter((c) => c.type === 'AbilitySupport' || c.type === 'BatterySupport')
      : [];

  const theme = factionTheme(activePlayer.faction);

  return (
    <div className="h-full max-h-full overflow-hidden flex gap-2 p-2 max-w-[1350px] mx-auto w-full">
      {state.pendingResponseQueue.length > 0 && <HotseatResponseGate state={state} />}
      <ActionBanner state={state} />
      <TutorialOverlay />
      {state.tutorialMode && <TutorialPanel />}
      {actionToast && (
        <div className="fixed top-[8%] left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg border-2 border-yellow-400/60 bg-[#05050ae8] text-yellow-200 text-sm font-bold shadow-[0_0_20px_rgba(250,204,21,0.3)] pointer-events-none">
          {actionToast}
        </div>
      )}
      <AudioController />

      <Sidebar
        state={state}
        topId={viewerTopId}
        bottomId={viewerBottomId}
        drag={drag}
        onOpenLog={() => {
          setLogOpen(true);
          setLastSeenLogCount(state.log.length);
        }}
        logHasUnread={state.log.length > lastSeenLogCount}
      />

      <div className="flex-1 min-w-0 flex flex-col gap-1.5 justify-center">
        {/* Row 1: Rift + Turn/Phase together, one compact bar */}
        <div className="shrink-0 flex items-center justify-center gap-3 flex-wrap">
          <RiftPanel rift={state.riftSpace} />
          <div className="rounded-lg border border-white/10 bg-[#05050a] px-3 py-1 text-[11px] text-white/50 shrink-0">
            Turn {state.turnNumber} · <span style={{ color: theme.primary }} className="font-bold">{PHASE_LABEL[state.phase]}</span>
            {phasePrompt && <span className="hidden lg:inline text-white/40 italic ml-2">{phasePrompt}</span>}
          </div>
        </div>

      {state.aiVsAiMode && <ShowcaseControls />}


      {/* Row 3: opponent board */}
      <div className="min-h-0 overflow-hidden">
        <PlayerBoard
          state={state}
          playerId={viewerTopId}
          flipped
          onApexClick={oppApexClick}
          apexHighlight={oppApexHighlight}
          onInspectCard={(instance) => setInspected({ instance, ownerId: viewerTopId, zone: 'Field' })}
          onOpenVoid={() => setVoidInspecting(viewerTopId)}
          drag={drag}
        />
      </div>

      {/* Row 5: prompt / action-context area - compact, only as tall as its content needs */}
      <div className={`shrink-0 flex flex-col gap-1.5 max-h-[40vh] overflow-y-auto ${state.tutorialMode ? 'tutorial-above-overlay' : ''}`}>

        {mode.kind === 'attackAwaitingTarget' && bottomIsActingPlayer && <AttackOutcomePreview state={state} mode={mode} />}

        {state.riftSpace?.id === 'ControlConflict' && state.phase === 'Start' && !state.startPhasePending && !aiIsActing && (
          <div className="rounded-lg border border-blue-400/30 bg-[#05050a] px-2 py-1 flex items-center gap-1 flex-wrap text-[10px]">
            <span className="text-blue-300 shrink-0">Control Conflict - lock a Support for +1 Momentum?</span>
            {activePlayer.supportSlots.filter(Boolean).map((s) => (
              <button type="button"
                key={s!.instanceId}
                disabled={!!activePlayer.lockedSupportInstanceId}
                onClick={scrollSafeClick(() => state.lockSupportControlConflict(s!.instanceId))}
                className="px-1.5 py-0.5 rounded border border-blue-400/50 hover:bg-blue-400/10 disabled:opacity-30"
              >
                lock {getCardDef(s!.defId).name}
              </button>
            ))}
            <button type="button"
              onClick={scrollSafeClick(() => state.advancePhase('Main'))}
              className="px-1.5 py-0.5 rounded border border-white/20 hover:bg-white/10 text-white/60 ml-auto"
            >
              Continue to Main Phase
            </button>
          </div>
        )}

        {state.phase === 'Combat' && mode.kind !== 'attackerChosen' && (
          <CombatControls
            apexDef={attackerDef}
            state={state}
            attackerInstanceId={attackerApex ? attackerApex.instanceId : null}
            availableSync={activePlayer.availableSync}
            hasAttacked={!!attackerApex && !!attackerApex.hasAttacked}
            selectedAttackId={mode.kind === 'attackAwaitingTarget' ? mode.attackId : null}
            onChooseAttack={chooseAttack}
            onCancel={resetMode}
            awaitingTarget={mode.kind === 'attackAwaitingTarget'}
          />
        )}

        {mode.kind === 'attackerChosen' && attackerApex && (
          <AttackSelectorModal
            attacker={attackerApex}
            state={state}
            availableSync={activePlayer.availableSync}
            onChooseAttack={chooseAttack}
            onCancel={resetMode}
          />
        )}

        {mode.kind === 'attackChoicePending' && attackChoiceAttacker && (
          <div className="rounded-lg border border-emerald-400/40 bg-[#05050a] px-2 py-1.5 flex items-center gap-1.5 flex-wrap text-[10px]">
            <span className="text-emerald-300 shrink-0">Choose an attack:</span>
            {attackChoiceOptions.map((atk) => (
              <button
                type="button"
                key={atk.id}
                onClick={() => {
                  playSfx('ui.click');
                  resolveChosenAttack(atk.id);
                }}
                className="px-1.5 py-0.5 rounded border border-emerald-400/50 hover:bg-emerald-400/10"
              >
                {atk.name} ({atk.syncCost} Sync, {atk.baseDamage} dmg)
              </button>
            ))}
            <button type="button" onClick={scrollSafeClick(resetMode)} className="px-1.5 py-0.5 rounded border border-white/20 hover:bg-white/10 text-white/60 ml-auto">
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Row 6: player board */}
      <div className="min-h-0 overflow-hidden">
        <PlayerBoard
          state={state}
          playerId={viewerBottomId}
          onApexClick={bottomIsActingPlayer ? ownApexClick : undefined}
          onSupportClick={bottomIsActingPlayer ? ownSupportClick : undefined}
          apexHighlight={bottomIsActingPlayer ? ownApexHighlight : undefined}
          apexDisabled={bottomIsActingPlayer ? ownApexDisabled : () => true}
          selectedApexId={
            mode.kind === 'attackerChosen' || mode.kind === 'attackAwaitingTarget' ? mode.attackerId : null
          }
          selectedSupportId={mode.kind === 'reconfigurePlay' || mode.kind === 'reconfigureChain' ? mode.returnId : null}
          supportDisabled={bottomIsActingPlayer ? () => mode.kind !== 'reconfigureReturn' && mode.kind !== 'idle' : () => true}
          onInspectCard={(instance) => setInspected({ instance, ownerId: viewerBottomId, zone: 'Field' })}
          onOpenVoid={() => setVoidInspecting(viewerBottomId)}
          containerRef={boardRef}
          drag={drag}
          onApexAttackDragStart={undefined}
        />
      </div>

      {/* Row 7: action feed - a real layout row (not an overlay), so it can never cover
          the board. Shows recent moves, updating live, rather than a transient popup. */}
      <div className="shrink-0 rounded-lg border border-white/10 bg-[#05050a] px-2 py-1 flex items-center gap-2 overflow-hidden text-[10px] text-white/50">
        <span className="uppercase tracking-widest text-white/30 shrink-0">Recent:</span>
        <div className="flex overflow-hidden whitespace-nowrap">
          {[...recentMoves].reverse().map((entry, i) => (
            <span key={entry.id} className={entry.kind === 'info' ? 'text-red-300/80' : 'text-white/60'}>
              {i > 0 && <span className="text-white/15 mr-3">·</span>}
              {entry.message}
            </span>
          ))}
          {recentMoves.length === 0 && <span className="text-white/25 italic">No moves yet.</span>}
        </div>
      </div>

      {/* Row 8: hand + phase controls - always visible, fixed bottom area */}
      <div className="shrink-0 flex flex-col gap-1.5">
        <div className="mx-auto w-full max-w-2xl flex flex-row flex-wrap items-start justify-center gap-2">
        <div className="rounded-lg border border-white/10 bg-[#05050a] px-2 py-1.5 flex items-center justify-center gap-2 flex-wrap">
          {state.phase === 'Start' && (
            <span className="text-[11px] text-white/40 italic px-1">Draw Phase...</span>
          )}
          {aiIsActing && (
            <span className="text-[11px] text-fuchsia-300/80 italic px-1 animate-pulse">
              {state.players.player2.faction} AI is taking its turn...
            </span>
          )}
          <button
            type="button"
            onClick={scrollSafeClick(() => state.endTurn())}
            disabled={state.phase !== 'Combat' || aiIsActing || mode.kind === 'attackerChosen'}
            className={`px-3 py-1.5 rounded text-xs font-bold tracking-wide ${
              state.phase === 'Combat' ? 'bg-red-500/80 hover:bg-red-500 text-black' : 'bg-white/5 text-white/25 cursor-not-allowed'
            }`}
          >
            End Turn
          </button>
        </div>

        {(state.phase === 'Main' || state.phase === 'Combat') && !aiIsActing && (
          <div className="rounded-lg border border-teal-500/30 bg-[#05050a] p-1.5 text-[11px]">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button type="button"
                disabled={reconfigureDisabled || mode.kind === 'reconfigureReturn' || aiIsActing}
                onClick={scrollSafeClick(() => setMode({ kind: 'reconfigureReturn' }))}
                className="px-2 py-1 rounded border border-teal-400/50 hover:bg-teal-400/10 disabled:opacity-30 font-bold text-teal-200"
              >
                Engine Reconfig {reconfigureDisabled ? '(used)' : '(once/turn)'}
              </button>
              {mode.kind === 'reconfigureReturn' && (
                <span className="text-teal-300 animate-pulse">Select a Support above to return to hand...</span>
              )}
              {mode.kind === 'reconfigurePlay' && (
                <button type="button" onClick={() => { state.reconfigure(mode.returnId); resetMode(); }} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">
                  Skip — finish Engine Reconfig
                </button>
              )}
              {(mode.kind === 'reconfigureReturn' || mode.kind === 'reconfigurePlay' || mode.kind === 'reconfigureChain') && (
                <button type="button" onClick={resetMode} className="text-white/40 hover:text-white/70">
                  cancel
                </button>
              )}
            </div>
            {mode.kind === 'reconfigurePlay' && supportBudgetSpent && (
              <div className="mt-1 text-white/40 italic">
                Already played a Support this turn - this Engine Reconfig can only return a card, not play one in.
              </div>
            )}
            {mode.kind === 'reconfigurePlay' && !supportBudgetSpent && eligibleReconfigurePlays.length > 0 && (
              <div className="mt-1 flex gap-2 flex-wrap">
                {eligibleReconfigurePlays.map((c) => {
                  const def = getCardDef(c.defId);
                  return (
                    <button type="button"
                      key={c.instanceId}
                      onClick={() => {
                        if (mode.kind !== 'reconfigurePlay') return;
                        if (c.type === 'AbilitySupport') {
                          setMode({ kind: 'reconfigureChain', returnId: mode.returnId, playId: c.instanceId });
                        } else {
                          state.reconfigure(mode.returnId, c.instanceId);
                          resetMode();
                        }
                      }}
                      className="px-2 py-1 rounded border border-teal-400/40 hover:bg-teal-400/10"
                    >
                      play {def.name}
                    </button>
                  );
                })}
              </div>
            )}
            {mode.kind === 'reconfigureChain' && (
              <div className="mt-1 text-teal-300 animate-pulse">Now click one of your Apexes above to chain it.</div>
            )}
          </div>
        )}

        {(state.phase === 'Main' || state.phase === 'Combat') && !aiIsActing && (
          <div className="rounded-lg border border-orange-500/30 bg-[#05050a] p-1.5 text-[11px]">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button type="button"
                disabled={equipSwapDisabled || mode.kind === 'equipSwapSelectApex' || aiIsActing}
                onClick={scrollSafeClick(() => setMode({ kind: 'equipSwapSelectApex' }))}
                className="px-2 py-1 rounded border border-orange-400/50 hover:bg-orange-400/10 disabled:opacity-30 font-bold text-orange-200"
              >
                Equip Swap {activePlayer.turnFlags.equipSwapUsedThisTurn ? '(used)' : '(once/turn)'}
              </button>
              {mode.kind === 'equipSwapSelectApex' && (
                <span className="text-orange-300 animate-pulse">Select an Apex above with an Equip to swap out...</span>
              )}
              {mode.kind === 'equipSwapSelectCard' && (
                <span className="text-orange-300 animate-pulse">Select an Equip in your hand to swap in...</span>
              )}
              {(mode.kind === 'equipSwapSelectApex' || mode.kind === 'equipSwapSelectCard') && (
                <button type="button" onClick={resetMode} className="text-white/40 hover:text-white/70">
                  cancel
                </button>
              )}
            </div>
          </div>
        )}
        </div>

        {/* All mode-dependent confirmation UI below (ConfirmBar variants, the
            Overdrive prompt) needs to stay clickable above the tutorial dim
            overlay - it's exactly the "Confirm" surface a player needs during a
            gated tutorial step, so it can't be caught by the same blackout that
            blocks everything else. */}
        <div className={state.tutorialMode ? 'tutorial-above-overlay flex flex-col gap-1.5' : 'contents'}>
        {mode.kind === 'apexReady' && (
          <ConfirmBar
            text={`Selected: ${selectedCard ? getCardDef(selectedCard.defId).name : 'Apex'} — play into an empty Front Line slot?`}
            onConfirm={() => { state.playApexCard(mode.cardId); resetMode(); }}
            onCancel={resetMode}
          />
        )}
        {mode.kind === 'supportReady' && (
          <ConfirmBar
            text={`Selected: ${selectedCard ? getCardDef(selectedCard.defId).name : 'Support'} — play into an empty Support slot?`}
            onConfirm={() => { state.playSupportCard(mode.cardId); resetMode(); }}
            onCancel={resetMode}
          />
        )}
        {mode.kind === 'supportChooseChain' && (
          <ConfirmBar
            text={`Selected: ${selectedCard ? getCardDef(selectedCard.defId).name : 'Support'} — click one of your Apexes above to chain it, or play it unchained as a vanilla Sync source.`}
            confirmLabel="Play Unchained"
            onConfirm={() => { state.playSupportCard(mode.cardId); resetMode(); }}
            onCancel={resetMode}
          />
        )}
        {mode.kind === 'rechainSelectApex' && (
          <ConfirmBar text="Click one of your Apexes above to chain this Support to it." onCancel={resetMode} />
        )}
        {mode.kind === 'overdrivePrompt' && (
          <div className="rounded-lg border border-yellow-400/40 bg-yellow-400/5 p-2 flex items-center justify-between gap-2 text-xs flex-wrap">
            <span className="text-yellow-200">
              Spend 1 Momentum for {mode.supportName} Overdrive? (+100 {mode.supportName === 'Juice-Box' ? 'DEF' : 'damage'})
            </span>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  state.declareAttack(mode.attackerId, mode.attackId, mode.targetId, true);
                  lockActions();
                  resetMode();
                }}
                className="px-2 py-1 rounded bg-yellow-300 text-black font-bold"
              >
                Spend 1 Momentum
              </button>
              <button
                type="button"
                onClick={() => {
                  state.declareAttack(mode.attackerId, mode.attackId, mode.targetId, false);
                  lockActions();
                  resetMode();
                }}
                className="px-2 py-1 rounded bg-white/10 hover:bg-white/20"
              >
                Skip
              </button>
            </div>
          </div>
        )}
        {mode.kind === 'equipReady' && (
          <ConfirmBar
            text={`Selected: ${selectedCard ? getCardDef(selectedCard.defId).name : 'Equip'} — click one of your Apexes above (without an Equip) to attach this.`}
            onCancel={resetMode}
          />
        )}
        {mode.kind === 'specialReady' && !mode.requiresTarget && (
          <ConfirmBar
            text={`Selected: ${selectedCard ? getCardDef(selectedCard.defId).name : 'Special'} — play it now?`}
            onConfirm={() => { state.playSpecialCard(mode.cardId); resetMode(); }}
            onCancel={resetMode}
          />
        )}
        {mode.kind === 'specialReady' && mode.requiresTarget && (
          <ConfirmBar
            text={`Selected: ${selectedCard ? getCardDef(selectedCard.defId).name : 'Special'} — click a valid target (${mode.requiresTarget}) above.`}
            onCancel={resetMode}
          />
        )}
        </div>

        <Hand
          cards={state.players[viewerBottomId].hand}
          selectedId={selectedCard?.instanceId ?? null}
          onSelect={undefined}
          disabledIds={handDisabledIds}
          onInspectCard={(instance) => setInspected({ instance, ownerId: viewerBottomId, zone: 'Hand' })}
          minWidth={boardWidth}
          state={state}
          playerId={viewerBottomId}
          tutorialSpotlightInstanceId={
            state.tutorialMode
              ? (() => {
                  const guided = currentGuidedAction();
                  if (!guided) return undefined;
                  const defId =
                    guided.kind === 'playApex' || guided.kind === 'playEngine' || guided.kind === 'playEquip' || guided.kind === 'playSpecial'
                      ? guided.defId
                      : null;
                  if (!defId) return undefined;
                  return state.players[viewerBottomId].hand.find((c) => c.defId === defId)?.instanceId ?? null;
                })()
              : undefined
          }
          onCardPointerDown={
            (state.phase === 'Main' || state.phase === 'Combat') && bottomIsActingPlayer && !aiIsActing && mode.kind !== 'attackerChosen'
              ? onHandCardPointerDown
              : undefined
          }
        />
      </div>
      </div>

      {inspected && (
        <CardInspectModal
          instance={inspected.instance}
          state={state}
          ownerId={inspected.ownerId}
          zone={inspected.zone}
          onClose={() => setInspected(null)}
        />
      )}

      {voidInspecting && (
        <VoidInspectModal
          faction={state.players[voidInspecting].faction}
          cards={state.players[voidInspecting].voidZone}
          onClose={() => setVoidInspecting(null)}
          onInspectCard={(instance) => setInspected({ instance, ownerId: voidInspecting, zone: 'Void' })}
        />
      )}

      {logOpen && (
        <BattleLogDrawer log={state.log} onClose={() => setLogOpen(false)} />
      )}
      <DragDropLayer drag={drag} label={dragLabel} cardInstance={dragCardInstance} />
    </div>
  );
}

function PhaseButton({
  label,
  active,
  enabled,
  onClick,
  highlighted,
}: {
  label: string;
  active: boolean;
  enabled: boolean;
  onClick: () => void;
  highlighted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.currentTarget.blur();
        const scrollY = window.scrollY;
        onClick();
        requestAnimationFrame(() => {
          if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: 'auto' });
        });
      }}
      disabled={!enabled}
      className={`px-3 py-1.5 rounded text-xs font-bold tracking-wide border ${
        active
          ? 'border-cyan-300 bg-cyan-300/20 text-cyan-100'
          : enabled
          ? 'border-cyan-400/50 hover:bg-cyan-400/10 text-cyan-200'
          : 'border-white/10 text-white/20 cursor-not-allowed'
      } ${highlighted ? 'pulse-border ring-2 ring-emerald-400 tutorial-spotlight' : ''}`}
    >
      {label}
    </button>
  );
}

function BattleLogDrawer({ log, onClose }: { log: GameState['log']; onClose: () => void }) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [showFallback, setShowFallback] = useState(false);

  async function handleCopyLog() {
    const text = formatLogAsText(log);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopyStatus('copied');
        setShowFallback(false);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      setCopyStatus('failed');
      setShowFallback(true);
    }
    setTimeout(() => setCopyStatus('idle'), 2500);
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full sm:w-[420px] h-full bg-[#0a0512] border-l border-white/15 flex flex-col p-3 gap-2">
        <div className="flex items-center justify-between shrink-0">
          <div className="text-xs uppercase tracking-widest text-white/50">Battle Log</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleCopyLog} className="text-[10px] px-2 py-1 rounded border border-white/20 hover:bg-white/10">
              {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'failed' ? 'Copy failed' : 'Copy Log'}
            </button>
            <button type="button" onClick={onClose} className="text-[10px] px-2 py-1 rounded border border-white/20 hover:bg-white/10">
              Close
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <GameLog log={log} />
        </div>
        {showFallback && (
          <textarea
            readOnly
            value={formatLogAsText(log)}
            className="w-full h-24 shrink-0 text-[10px] bg-black/60 border border-white/20 rounded p-1"
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
        )}
      </div>
    </div>
  );
}

/** AI vs AI Showcase mode's speed/pause bar (Commit 29). Sets useShowcaseStore's
 *  `active` flag on mount so animationStore/the AI driver start scaling their
 *  timings immediately, and clears it on unmount (leaving the match screen) so a
 *  stale multiplier can never leak into a later normal match. */
function ShowcaseControls() {
  const { speedMultiplier, paused, setSpeedMultiplier, togglePaused, setActive, setPaused } = useShowcaseStore();
  useEffect(() => {
    setActive(true);
    setPaused(false);
    return () => setActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="shrink-0 rounded-lg border border-fuchsia-500/30 bg-[#05050a] px-2 py-1 flex items-center justify-center gap-3 text-[11px]">
      <span className="text-fuchsia-300/70 uppercase tracking-widest text-[10px]">AI vs AI Showcase</span>
      <button
        type="button"
        onClick={togglePaused}
        className={`px-2 py-0.5 rounded border font-bold ${paused ? 'border-emerald-400/60 text-emerald-300 hover:bg-emerald-400/10' : 'border-yellow-400/60 text-yellow-300 hover:bg-yellow-400/10'}`}
      >
        {paused ? 'Resume' : 'Pause'}
      </button>
      <div className="flex items-center gap-1.5">
        <span className="text-white/40 text-[10px]">Fast</span>
        <input
          type="range"
          min={SHOWCASE_SPEED_MIN}
          max={SHOWCASE_SPEED_MAX}
          step={0.1}
          value={speedMultiplier}
          onChange={(e) => setSpeedMultiplier(Number(e.target.value))}
          className="w-28 accent-fuchsia-400"
          title={`${speedMultiplier.toFixed(1)}x`}
        />
        <span className="text-white/40 text-[10px]">Slow</span>
        <span className="text-fuchsia-300 font-mono text-[10px] w-8 text-right">{speedMultiplier.toFixed(1)}x</span>
      </div>
    </div>
  );
}

/** Shows the outcome against every legal target before the player commits to one -
 *  reuses getPreviewAttackDamage/getEffectiveDef/overflowToO2Loss, the exact same
 *  functions declareAttack itself uses to compute the real thing, so this can
 *  never show a number that turns out to be wrong once the attack actually
 *  resolves (Commit 29 Flow QoL). */
function AttackOutcomePreview({ state, mode }: { state: GameState; mode: Extract<Mode, { kind: 'attackAwaitingTarget' }> }) {
  const attackerHit = findApexAnywhere(state, mode.attackerId);
  if (!attackerHit) return null;
  const opponentId = attackerHit.ownerId === 'player1' ? 'player2' : 'player1';
  const targets = state.players[opponentId].apexSlots.filter((a): a is CardInstance => !!a);
  if (targets.length === 0) return null;

  return (
    <div className="rounded-lg border border-white/10 bg-[#05050a] px-2 py-1.5 text-[10px] w-fit max-w-full mx-auto">
      <div className="text-white/30 uppercase tracking-widest text-center mb-1">Attack Preview</div>
      <div className="flex flex-col gap-1">
        {targets.map((target) => {
          const targetDef = getCardDef(target.defId);
          const preview = getPreviewAttackDamage(state, mode.attackerId, mode.attackId, target.instanceId);
          if (!preview) return null;
          const effDef = getEffectiveDef(state, target.instanceId);
          const dmg = preview.modifiedDamage;
          const destroyed = dmg >= effDef;
          const overflow = destroyed ? overflowToO2Loss(dmg - effDef) : 0;
          return (
            <div key={target.instanceId} className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-white/60">→ {targetDef.name}:</span>
              <span className="font-mono font-bold text-white/80">{dmg} dmg</span>
              {destroyed ? (
                <span className="text-red-400 font-bold">Destroyed{overflow > 0 ? ` (${overflow} overflow O2)` : ''}</span>
              ) : (
                <span className="text-emerald-400">Survives at {effDef - dmg} DEF</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConfirmBar({
  text,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
}: {
  text: string;
  onConfirm?: () => void;
  onCancel: () => void;
  confirmLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-yellow-400/40 bg-yellow-400/5 p-2 flex items-center gap-4 text-xs w-fit max-w-full mx-auto">
      <span className="text-yellow-200">{text}</span>
      <div className="flex gap-2 shrink-0">
        {onConfirm && (
          <button
            type="button"
            onClick={() => {
              playSfx('ui.confirm');
              onConfirm();
            }}
            className="px-2 py-1 rounded bg-yellow-300 text-black font-bold"
          >
            {confirmLabel}
          </button>
        )}
        <button type="button" onClick={onCancel} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">
          Cancel
        </button>
      </div>
    </div>
  );
}

function OpeningApexScreen() {
  const state = useGameStore();
  const selectOpeningApex = useGameStore((s) => s.selectOpeningApex);
  const pid = state.openingApexSelectionPlayerId;
  const isAITurn = (state.vsAI && pid === 'player2') || !!state.aiVsAiMode;

  useEffect(() => {
    if (!isAITurn || !pid) return;
    const apexCards = state.players[pid].hand.filter((c) => c.type === 'Apex');
    if (apexCards.length === 0) return;
    const t = setTimeout(() => selectOpeningApex(pid, apexCards[0].instanceId), 500);
    return () => clearTimeout(t);
  }, [isAITurn, pid, state.players, selectOpeningApex]);

  if (!pid) return null;
  const player = state.players[pid];
  const apexCards = player.hand.filter((c) => c.type === 'Apex');

  if (isAITurn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-fuchsia-300/80 italic animate-pulse text-sm">{player.faction} AI is choosing its opening Apex...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-3xl w-full rounded-xl border border-cyan-400/40 bg-[#05050a] p-6">
        <div className="text-center mb-4">
          <div className="text-[11px] uppercase tracking-widest text-white/40">Opening Hand — choose your starting Apex</div>
          <div className="text-xl font-bold text-cyan-300">
            {pid} ({player.faction})
          </div>
        </div>
        <div className="flex gap-3 flex-wrap justify-center mb-4">
          {player.hand.map((c) => (
            <Card key={c.instanceId} instance={c} disabled={c.type !== 'Apex'} onClick={c.type === 'Apex' ? () => selectOpeningApex(pid, c.instanceId) : undefined} size="lg" />
          ))}
        </div>
        <div className="text-center text-xs text-white/40">Click one of your {apexCards.length} Apex card(s) above to open with it.</div>
      </div>
    </div>
  );
}

function formatLogAsText(log: GameState['log']): string {
  return log.map((entry) => `[T${entry.turn}] ${entry.message}`).join('\n');
}

function GameOverScreen() {
  const state = useGameStore();
  const theme = state.winnerId ? factionTheme(state.players[state.winnerId].faction) : null;
  const loserId: PlayerId | null = state.winnerId ? (state.winnerId === 'player1' ? 'player2' : 'player1') : null;
  const [showLog, setShowLog] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [showFallback, setShowFallback] = useState(false);

  // Commit 33 - the actual result text, matching how the match was actually
  // played rather than always showing the raw "player1"/"player2" id:
  // - Vs AI: from the human's own perspective ("You Win!"/"You Lose!")
  // - AI vs AI or Hotseat: the winning faction's name, since neither side is
  //   "you" here - a real result a spectator or either human player can read
  const winnerText = !state.winnerId
    ? 'Draw!'
    : state.vsAI
    ? state.winnerId === 'player1'
      ? 'You Win!'
      : 'You Lose!'
    : `${state.players[state.winnerId].faction} Won!`;

  useEffect(() => {
    // From the human's perspective in Vs AI mode; in Hotseat a human won either
    // way, so it's always a win worth a victory cue.
    const isHumanLoss = state.vsAI && state.winnerId === 'player2';
    playSfx(isHumanLoss ? 'match.defeat' : 'match.victory');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCopyLog() {
    const text = formatLogAsText(state.log);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopyStatus('copied');
        setShowFallback(false);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      setCopyStatus('failed');
      setShowFallback(true);
    }
    setTimeout(() => setCopyStatus('idle'), 2500);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div
        className="max-w-2xl w-full rounded-xl border-2 p-8"
        style={{ borderColor: theme?.border ?? '#888', boxShadow: theme ? `0 0 40px ${theme.primary}66` : undefined }}
      >
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-widest text-white/40 mb-2">Game Over</div>
          <div className="text-3xl font-black mb-2" style={{ color: theme?.primary ?? '#fff' }}>
            {winnerText}
          </div>
          {loserId && <div className="text-xs text-white/40 mb-2">{loserId} lost the game.</div>}
          <div className="text-xs text-white/60 mb-4">{state.gameOverReason ?? 'The game has ended.'}</div>

          <div className="flex justify-center gap-6 text-xs font-mono mb-6">
            <div className="text-left">
              <div className="text-white/40 uppercase tracking-widest text-[10px] mb-1">player1</div>
              <div>O2: {state.players.player1.o2}</div>
              <div>Momentum: {state.players.player1.momentum}</div>
            </div>
            <div className="text-left">
              <div className="text-white/40 uppercase tracking-widest text-[10px] mb-1">player2</div>
              <div>O2: {state.players.player2.o2}</div>
              <div>Momentum: {state.players.player2.momentum}</div>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-2 mb-4">
            {state.tutorialMode && (
              <>
                <button type="button"
                  onClick={() => {
                    state.startNewGame('Neon Underground', 'Dark White', false, false, true);
                    useTutorialStore.getState().setStep(0);
                    useTutorialStore.getState().setBusy(false);
                    useTutorialStore.getState().setHelperMessage(null);
                    useTutorialStore.getState().setSlideshowActive(false);
                  }}
                  className="px-4 py-2 rounded-md font-bold bg-gradient-to-r from-fuchsia-400 to-cyan-300 text-black"
                >
                  Play Again
                </button>
                <button type="button"
                  onClick={() => state.startNewGame(state.players.player1.faction, state.players.player2.faction, true, false, false)}
                  className="px-4 py-2 rounded-md text-xs font-bold bg-white/10 hover:bg-white/20"
                >
                  Play Real Match
                </button>
              </>
            )}
            <button type="button"
              onClick={() => setShowLog((v) => !v)}
              className="px-4 py-2 rounded-md text-xs font-bold bg-white/10 hover:bg-white/20"
            >
              {showLog ? 'Hide Full Game Log' : 'View Full Game Log'}
            </button>
            <button type="button"
              onClick={handleCopyLog}
              className="px-4 py-2 rounded-md text-xs font-bold bg-white/10 hover:bg-white/20"
            >
              {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'failed' ? 'Copy failed - see below' : 'Copy Game Log'}
            </button>
            <button type="button"
              onClick={() => state.resetToMenu()}
              className={state.tutorialMode ? 'px-4 py-2 rounded-md text-xs font-bold bg-white/10 hover:bg-white/20' : 'px-4 py-2 rounded-md font-bold bg-gradient-to-r from-fuchsia-400 to-cyan-300 text-black'}
            >
              {state.tutorialMode ? 'Return to Menu' : 'Start New Game'}
            </button>
          </div>
        </div>

        {showFallback && (
          <div className="mb-4">
            <div className="text-[10px] text-white/40 mb-1">
              Clipboard access isn&apos;t available here - select all text below and copy manually.
            </div>
            <textarea
              readOnly
              value={formatLogAsText(state.log)}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full h-40 text-[10px] font-mono bg-black/60 border border-white/20 rounded p-2 text-white/70"
            />
          </div>
        )}

        {showLog && (
          <div className="h-72">
            <GameLog log={state.log} />
          </div>
        )}
      </div>
    </div>
  );
}
