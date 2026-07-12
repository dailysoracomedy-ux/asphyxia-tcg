'use client';

import { useEffect, useRef } from 'react';
import { useAudioStore } from '@/store/audioStore';
import { useGameStore } from '@/store/gameStore';
import { THEME_TRACK_SRC, FACTION_TRACK_SRC } from './musicTracks';
import type { Faction } from '@/types/game';

/**
 * Commit 30.3 - faction-aware background music with crossfading. Replaces the
 * earlier shuffled-playlist scaffolding entirely.
 *
 * Track selection rule, exactly as specified: Menu, Tutorial, and AI vs AI
 * all share one theme track and never crossfade or swap between each other -
 * as far as this controller is concerned, those three are the same "screen
 * category." Only a real battle (Vs AI or Hotseat, i.e. tutorialMode and
 * aiVsAiMode both false and status isn't 'menu') plays a faction track,
 * chosen by player1's selected faction. Whoever's "playing the deck" from the
 * menu is player1, in both Vs AI and Hotseat, so that's the one consistent
 * choice across both modes.
 *
 * Crossfade only happens when the actual track category changes (theme <->
 * a faction, or one faction <-> another if a new battle starts with a
 * different faction) - moving between Menu/Tutorial/AI-vs-AI never triggers
 * one, since the desired track key doesn't change, by construction, not by
 * special-casing.
 *
 * Architecture: two <audio> elements (A/B), always exactly one "active"
 * (audible, looping) at a time. A track change fades the new one in on the
 * inactive element while fading the active one out, then swaps which is
 * "active" and pauses the other - a real overlap, not a cut.
 */

const CROSSFADE_MS = 1800;
const FADE_STEP_MS = 50;

export function desiredTrackKey(state: { status: string; tutorialMode?: boolean; aiVsAiMode?: boolean; selectedFactions: { player1: Faction | null } }): 'theme' | Faction {
  if (state.tutorialMode || state.aiVsAiMode) return 'theme';
  if (state.status === 'menu') return 'theme';
  if (!state.selectedFactions.player1) return 'theme';
  return state.selectedFactions.player1;
}

function srcForKey(key: 'theme' | Faction): string {
  return key === 'theme' ? THEME_TRACK_SRC : FACTION_TRACK_SRC[key];
}

export default function MusicController() {
  const slotsRef = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const activeIndexRef = useRef<0 | 1>(0);
  const currentKeyRef = useRef<'theme' | Faction | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const musicMuted = useAudioStore((s) => s.musicMuted);
  const musicVolume = useAudioStore((s) => s.musicVolume);
  const musicVolumeRef = useRef(musicVolume);
  useEffect(() => {
    musicVolumeRef.current = musicVolume;
  }, [musicVolume]);

  const desiredKey = useGameStore(desiredTrackKey);

  // Build both audio elements once.
  useEffect(() => {
    const a = new Audio();
    const b = new Audio();
    a.loop = true;
    b.loop = true;
    a.preload = 'auto';
    b.preload = 'auto';
    a.volume = 0;
    b.volume = 0;
    slotsRef.current = [a, b];
    return () => {
      if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
      a.pause();
      b.pause();
      slotsRef.current = [null, null];
    };
  }, []);

  function clearFade() {
    if (fadeTimerRef.current) {
      clearInterval(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }

  /** Crossfades from whatever's currently active to `key`. If nothing has
   *  played yet (currentKeyRef is null - first ever play), just starts it
   *  directly at full volume instead of fading from silence, since there's
   *  nothing to fade *from*. */
  function switchToKey(key: 'theme' | Faction) {
    const [a, b] = slotsRef.current;
    if (!a || !b) return;
    clearFade();
    const targetVolume = musicVolumeRef.current;

    if (currentKeyRef.current === null) {
      const active = slotsRef.current[activeIndexRef.current]!;
      active.src = srcForKey(key);
      active.volume = targetVolume;
      active.currentTime = 0;
      active.play().catch(() => {});
      currentKeyRef.current = key;
      return;
    }

    const outgoingIndex = activeIndexRef.current;
    const incomingIndex: 0 | 1 = outgoingIndex === 0 ? 1 : 0;
    const outgoing = slotsRef.current[outgoingIndex]!;
    const incoming = slotsRef.current[incomingIndex]!;

    incoming.src = srcForKey(key);
    incoming.currentTime = 0;
    incoming.volume = 0;
    incoming.play().catch(() => {});

    const steps = Math.max(1, Math.round(CROSSFADE_MS / FADE_STEP_MS));
    let step = 0;
    fadeTimerRef.current = setInterval(() => {
      step++;
      const t = Math.min(1, step / steps);
      outgoing.volume = Math.max(0, targetVolume * (1 - t));
      incoming.volume = Math.min(targetVolume, targetVolume * t);
      if (t >= 1) {
        clearFade();
        outgoing.pause();
        activeIndexRef.current = incomingIndex;
        currentKeyRef.current = key;
      }
    }, FADE_STEP_MS);
  }

  // React to a genuine track-category change.
  useEffect(() => {
    if (musicMuted) return;
    if (desiredKey === currentKeyRef.current) return;
    switchToKey(desiredKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredKey, musicMuted]);

  // Start/stop in response to the mute toggle, without losing playback
  // position or restarting a crossfade in progress.
  useEffect(() => {
    const [a, b] = slotsRef.current;
    if (!a || !b) return;
    if (musicMuted) {
      clearFade();
      a.pause();
      b.pause();
    } else if (currentKeyRef.current === null) {
      switchToKey(desiredKey);
    } else {
      slotsRef.current[activeIndexRef.current]?.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicMuted]);

  // Live volume updates without interrupting playback or an in-progress fade.
  useEffect(() => {
    if (fadeTimerRef.current) return; // a fade owns the volume ramp right now
    const active = slotsRef.current[activeIndexRef.current];
    if (active) active.volume = musicVolume;
  }, [musicVolume]);

  return null;
}
