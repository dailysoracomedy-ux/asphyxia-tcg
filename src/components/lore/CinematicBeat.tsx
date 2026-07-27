'use client';

/**
 * Commit 56 - the shared engine both LoreIntro and FactionSplash are built
 * on. Plays exactly ONE beat: background (real image if it loads, a themed
 * gradient if it 404s), narration (real audio if it loads and has a
 * duration, a readable-pace fallback timer if it doesn't), and text that
 * fades in with the voice and out before the next beat. Calls onComplete
 * when the beat's natural duration elapses - the CALLER decides what that
 * means (auto-advance to the next beat, or just sit there having finished
 * revealing its text while an interactive UI - the faction cards, a
 * Continue button - waits for the person, not the clock).
 *
 * This is deliberately asset-optional: nothing here requires a single real
 * audio or image file to exist to be fully functional and testable today.
 */

import { useEffect, useRef, useState } from 'react';

export interface CinematicBeatData {
  id: string;
  text: string;
  audioSrc: string;
  imageSrc: string;
  fallbackMs: number;
  visual?: 'calm' | 'glitch';
}

export default function CinematicBeat({
  beat,
  onComplete,
  gradient,
  textClassName,
  holdText = false,
  postHoldMs = 0,
}: {
  beat: CinematicBeatData;
  onComplete: () => void;
  /** Fallback background when beat.imageSrc hasn't been supplied yet. */
  gradient: string;
  /** Lets callers (FactionSplash's per-variant styling) override text
   *  typography without duplicating the reveal/timing logic. */
  textClassName?: string;
  /** When true, the text reaches 'hold' and STAYS - no fade-out timer.
   *  onComplete still fires at the natural duration; only the visual
   *  fade-out is suppressed. Used by the 12th intro beat, whose line
   *  ("Which faction will YOU join?") needs to keep labeling the faction
   *  cards that fade in below it, not disappear out from under them. */
  holdText?: boolean;
  /** Extra silent pause AFTER the beat's natural duration (real audio or
   *  fallback) before onComplete fires - text stays visible throughout.
   *  This is what gives Dark White's pacing its weight without ever
   *  fighting real audio once it exists: it's added ON TOP of however long
   *  the actual line takes, never a fudge to the line's own timing. */
  postHoldMs?: number;
}) {
  const [imageOk, setImageOk] = useState(true);
  const [textPhase, setTextPhase] = useState<'in' | 'hold' | 'out'>('in');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    let completeTimer: ReturnType<typeof setTimeout> | null = null;
    let outTimer: ReturnType<typeof setTimeout> | null = null;
    let inTimer: ReturnType<typeof setTimeout> | null = null;

    function schedule(baseMs: number) {
      const total = baseMs + postHoldMs;
      inTimer = setTimeout(() => setTextPhase('hold'), 260);
      if (!holdText) {
        outTimer = setTimeout(() => setTextPhase('out'), Math.max(300, total - 500));
      }
      completeTimer = setTimeout(() => {
        if (!doneRef.current) {
          doneRef.current = true;
          onComplete();
        }
      }, total);
    }

    // Audio is enhancement-only here too, same promise the rest of the
    // app's audio makes - a missing/broken file can never break the intro.
    let audio: HTMLAudioElement | null = null;
    try {
      audio = new Audio(beat.audioSrc);
      audioRef.current = audio;
      let settled = false;
      const onMeta = () => {
        if (settled) return;
        settled = true;
        const real = audio!.duration;
        schedule(Number.isFinite(real) && real > 0.2 ? real * 1000 : beat.fallbackMs);
        audio!.play().catch(() => {});
      };
      const onErr = () => {
        if (settled) return;
        settled = true;
        schedule(beat.fallbackMs);
      };
      audio.addEventListener('loadedmetadata', onMeta);
      audio.addEventListener('error', onErr);
      // Belt-and-suspenders: if neither event fires (some browsers stay
      // silent on a 404 instead of emitting 'error'), don't hang the intro.
      const safetyTimer = setTimeout(() => { if (!settled) onErr(); }, 900);
      return () => {
        clearTimeout(safetyTimer);
        audio?.removeEventListener('loadedmetadata', onMeta);
        audio?.removeEventListener('error', onErr);
        audio?.pause();
        if (completeTimer) clearTimeout(completeTimer);
        if (outTimer) clearTimeout(outTimer);
        if (inTimer) clearTimeout(inTimer);
      };
    } catch {
      schedule(beat.fallbackMs);
      return () => {
        if (completeTimer) clearTimeout(completeTimer);
        if (outTimer) clearTimeout(outTimer);
        if (inTimer) clearTimeout(inTimer);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat.id]);

  const isGlitch = beat.visual === 'glitch';

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* background: real image with graceful gradient fallback */}
      <div className="absolute inset-0" style={{ background: gradient }} />
      {imageOk && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={beat.id}
          src={beat.imageSrc}
          alt=""
          onError={() => setImageOk(false)}
          className={isGlitch ? 'lore-bg-glitch' : 'lore-bg-pan'}
        />
      )}
      {isGlitch && <div className="absolute inset-0 lore-scanlines pointer-events-none" />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/50" />

      <div className="absolute inset-0 flex items-end justify-center pb-[14%] px-8">
        <p
          className={`max-w-2xl text-center transition-opacity duration-500 ${
            textPhase === 'in' ? 'opacity-0' : textPhase === 'out' ? 'opacity-0' : 'opacity-100'
          } ${textClassName ?? 'text-xl md:text-2xl font-bold text-white leading-relaxed'}`}
          style={{ textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}
        >
          {beat.text}
        </p>
      </div>
    </div>
  );
}
