'use client';

import { useState } from 'react';
import type { GameState, PendingResponseItem, PlayerId } from '@/types/game';
import ResponseModal from './ResponseModal';
import PassScreen from './PassScreen';

/** Which stages involve one player looking at cards the other player shouldn't see,
 *  and therefore need a hotseat "pass the screen" privacy step around them. */
function needsPrivacy(item: PendingResponseItem): boolean {
  return item.stage === 'reactionChoice' || item.stage === 'negateWindow';
}

function respondingPlayerOf(item: PendingResponseItem): PlayerId | null {
  if (item.stage === 'reactionChoice') return item.respondingPlayerId;
  if (item.stage === 'negateWindow') return item.negatingPlayerId;
  return null;
}

type GateMode = 'idle' | 'passingToResponder' | 'showingModal' | 'passingBackToActive';

export default function HotseatResponseGate({ state }: { state: GameState }) {
  const item = state.pendingResponseQueue[0] ?? null;
  const [mode, setMode] = useState<GateMode>('idle');
  const [snapshot, setSnapshot] = useState<{ responder: PlayerId; activePlayer: PlayerId } | null>(null);
  const [lastHandledId, setLastHandledId] = useState<string | null>(null);

  // Adjust state during render (React's recommended pattern for "start a new cycle when a new
  // qualifying item shows up") rather than in a useEffect, to avoid an extra render pass.
  // Only starts a fresh privacy cycle when we're not already mid-flow, which is what lets the
  // "pass back to active player" step stick around even after the queue drains to empty.
  if (mode === 'idle' && item && needsPrivacy(item) && item.id !== lastHandledId) {
    setLastHandledId(item.id);
    setSnapshot({ responder: respondingPlayerOf(item)!, activePlayer: state.activePlayerId });
    setMode('passingToResponder');
  }

  if (mode === 'idle') {
    if (!item) return null;
    if (!needsPrivacy(item)) {
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
