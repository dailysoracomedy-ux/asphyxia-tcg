'use client';

import { useEffect, useRef } from 'react';
import { useAudioStore } from '@/store/audioStore';
import { MUSIC_TRACKS } from './musicTracks';

/**
 * Background music playlist player. Renders nothing - just owns a single shared
 * <audio> element and drives it based on audioStore's music settings. Safe with
 * zero tracks (MUSIC_TRACKS is empty until real songs are added - see
 * musicTracks.ts): every effect below checks for an empty playlist first and
 * simply does nothing, no error, no console spam.
 *
 * Music defaults to muted (see audioStore.ts) specifically so the first time it
 * actually tries to play is always in direct response to the person turning the
 * toggle on themselves - that click is what satisfies the browser's autoplay
 * policy, rather than fighting it with an autoplay attempt on page load that
 * would just get silently blocked (and log warnings) anyway.
 */
export default function MusicController() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playlistRef = useRef<string[]>([]);
  const trackIndexRef = useRef(0);
  const musicMuted = useAudioStore((s) => s.musicMuted);
  const musicVolume = useAudioStore((s) => s.musicVolume);

  // Build the element and a shuffled play order once.
  useEffect(() => {
    if (MUSIC_TRACKS.length === 0) return;
    const audio = new Audio();
    audio.preload = 'none';
    audioRef.current = audio;
    playlistRef.current = shuffle(MUSIC_TRACKS.map((t) => t.src));

    const handleEnded = () => {
      trackIndexRef.current = (trackIndexRef.current + 1) % playlistRef.current.length;
      playCurrent();
    };
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.pause();
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function playCurrent() {
    const audio = audioRef.current;
    if (!audio || playlistRef.current.length === 0) return;
    audio.src = playlistRef.current[trackIndexRef.current];
    audio.volume = musicVolume;
    audio.play().catch(() => {
      // Autoplay/permission failure - safe to ignore, the person can just press
      // the toggle again; nothing here should ever throw into the rest of the app.
    });
  }

  // Start/stop playback in response to the mute toggle.
  useEffect(() => {
    if (MUSIC_TRACKS.length === 0) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (musicMuted) {
      audio.pause();
    } else {
      playCurrent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicMuted]);

  // Live volume updates without interrupting playback.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = musicVolume;
  }, [musicVolume]);

  return null;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
