'use client';

import { useState } from 'react';
import type { GameState, PendingResponseItem, PlayerId } from '@/types/game';
import ResponseModal from './ResponseModal';
import PassScreen from './PassScreen';

/** Which stages involve one player looking at cards the other player shouldn't see,
 *  and therefore need a hotseat "pass the screen" privacy step around them.
 *  Privacy only matters when there's a second human who could be looking at the
 *  screen - in Vs AI mode there's exactly one human ever touching the device, so
 *  the entire pass-screen ceremony is pointless even for the human's own
 *  decisions (Commit 24.1 - this was reported as still showing up, and it was: the
 *  original check only ever looked at the response *stage*, never at whether a
 *  second human actually existed to hide anything from). */
function needsPrivacy(item: PendingResponseItem, vsAI: boolean): boolean {
  if (vsAI) return false;
  return item.stage === 'reactionChoice' || item.stage === 'negateWindow';
}

/** Which player this specific decision belongs to, across every possible stage -
 *  used both for the existing hotseat privacy flow and (Commit 23.3) to decide
 *  whether to show anything at all in Vs AI mode. */
function respondingPlayerOf(item: PendingResponseItem): PlayerId {
  if (item.stage === 'reactionChoice') return item.respondingPlayerId;
  if (item.stage === 'negateWindow') return item.negatingPlayerId;
  return item.playerId;
}

type GateMode = 'idle' | 'passingToResponder' | 'showingModal' | 'passingBackToActive';

export default function HotseatResponseGate({ state }: { state: GameState }) {
  const item = state.pendingResponseQueue[0] ?? null;
  const [mode, setMode] = useState<GateMode>('idle');
  const [snapshot, setSnapshot] = useState<{ responder: PlayerId; activePlayer: PlayerId } | null>(null);
  const [lastHandledId, setLastHandledId] = useState<string | null>(null);

  // In Vs AI mode, any decision belonging to the AI (player2) should never show
  // anything to the human at all - no pass-screen, no modal, for any of the 4
  // response stages. The AI driver elsewhere resolves it on its own short delay;
  // the human just sees the board pause briefly, same as any other "AI is
  // thinking" moment, and then the result lands in the Battle Log as normal.
  if (item && state.vsAI && respondingPlayerOf(item) === 'player2') {
    return null;
  }

  // Adjust state during render (React's recommended pattern for "start a new cycle when a new
  // qualifying item shows up") rather than in a useEffect, to avoid an extra render pass.
  // Only starts a fresh privacy cycle when we're not already mid-flow, which is what lets the
  // "pass back to active player" step stick around even after the queue drains to empty.
  if (mode === 'idle' && item && needsPrivacy(item, state.vsAI) && item.id !== lastHandledId) {
    setLastHandledId(item.id);
    setSnapshot({ responder: respondingPlayerOf(item), activePlayer: state.activePlayerId });
    setMode('passingToResponder');
  }

  if (mode === 'idle') {
    if (!item) return null;
    if (!needsPrivacy(item, state.vsAI)) {
      // Human Error / Alley Wraith choices belong to the currently-visible active player
      // (no hidden hand info involved), so no pass-screen is needed - show directly.
      return <ResponseModal state={state} />;
    }
    return null; // the state-adjustment above will flip mode on this same render pass
  }

  if (mode === 'passingToResponder' && snapshot) {
    return <PassScreen toPlayerId={snapshot.responder} direction="toResponder" onReady={() => setMode('showingModal')} />;
  }

  if (mode === 'showingModal') {
    return <ResponseModal state={state} onAfterChoose={() => setMode('passingBackToActive')} />;
  }

  if (mode === 'passingBackToActive' && snapshot) {
    return <PassScreen toPlayerId={snapshot.activePlayer} direction="backToActive" onReady={() => setMode('idle')} />;
  }

  return null;
}
