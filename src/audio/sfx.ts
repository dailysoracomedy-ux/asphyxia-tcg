/**
 * Reusable SFX framework (Commit 25). No sound assets exist yet, so every key
 * below is a small synthesized tone via the Web Audio API rather than an
 * <audio>/mp3 file - this is explicitly allowed by the spec ("optionally use
 * simple generated browser oscillator blips... if not appropriate and not
 * annoying") and means the framework is fully wired and usable today, with real
 * sound files a drop-in swap later (see NOTE at the bottom) rather than a second
 * build pass.
 *
 * Safety, all handled here so no caller needs to think about it:
 * - a single shared AudioContext, created lazily on first real playback attempt
 *   (never at module load, which can throw/warn under browser autoplay policies)
 * - every playback wrapped in try/catch; a failure here can never throw into
 *   game logic, matching the same defensive pattern gameStore.ts's emitVfx uses
 * - respects useAudioStore's mute/volume settings, read fresh on every call
 * - does nothing at all outside a browser (Node/simulate.ts/tests never trigger
 *   this path in the first place, since it's only ever invoked from a mounted
 *   React component's effect, never from gameStore.ts or rules.ts directly)
 */
import { useAudioStore } from '@/store/audioStore';

export type SfxKey =
  // UI
  | 'ui.click'
  | 'ui.hover'
  | 'ui.invalid'
  | 'ui.confirm'
  // Card
  | 'card.draw'
  | 'card.apexPlay'
  | 'card.enginePlay'
  | 'card.equipAttach'
  | 'card.equipSwap'
  | 'card.specialPlay'
  | 'card.reactPlay'
  | 'card.negatePlay'
  // Combat
  | 'combat.attackDeclare'
  | 'combat.hit'
  | 'combat.heavyHit'
  | 'combat.directO2'
  | 'combat.overflow'
  | 'combat.destroy'
  // Resources
  | 'resource.o2Loss'
  | 'resource.momentumGain'
  | 'resource.momentumSpend'
  // Mechanics
  | 'engine.trigger'
  | 'rift.trigger'
  // End
  | 'match.victory'
  | 'match.defeat';

interface Tone {
  freq: number;
  durationMs: number;
  type?: OscillatorType;
  gain?: number; // 0-1, relative to the user's volume setting
  delayMs?: number; // for multi-note sequences
}

/** One or more tones per key - a sequence plays as a tiny melodic/rhythmic
 *  phrase (used for victory/defeat and a couple of the more "eventful" cues)
 *  rather than needing a separate sequencing system. */
const SFX_TONES: Record<SfxKey, Tone[]> = {
  'ui.click': [{ freq: 880, durationMs: 35, type: 'square', gain: 0.5 }],
  'ui.hover': [{ freq: 660, durationMs: 25, type: 'sine', gain: 0.25 }],
  'ui.invalid': [{ freq: 180, durationMs: 120, type: 'sawtooth', gain: 0.5 }],
  'ui.confirm': [{ freq: 720, durationMs: 60, type: 'triangle', gain: 0.5 }],

  'card.draw': [{ freq: 500, durationMs: 60, type: 'sine', gain: 0.4 }],
  'card.apexPlay': [
    { freq: 220, durationMs: 90, type: 'triangle', gain: 0.55 },
    { freq: 330, durationMs: 110, type: 'triangle', gain: 0.45, delayMs: 60 },
  ],
  'card.enginePlay': [{ freq: 300, durationMs: 130, type: 'sine', gain: 0.5 }],
  'card.equipAttach': [
    { freq: 260, durationMs: 70, type: 'square', gain: 0.4 },
    { freq: 520, durationMs: 90, type: 'square', gain: 0.4, delayMs: 50 },
  ],
  'card.equipSwap': [
    { freq: 520, durationMs: 60, type: 'square', gain: 0.4 },
    { freq: 260, durationMs: 90, type: 'square', gain: 0.4, delayMs: 60 },
  ],
  'card.specialPlay': [{ freq: 700, durationMs: 130, type: 'triangle', gain: 0.5 }],
  'card.reactPlay': [{ freq: 900, durationMs: 100, type: 'sine', gain: 0.5 }],
  'card.negatePlay': [
    { freq: 900, durationMs: 60, type: 'sawtooth', gain: 0.5 },
    { freq: 160, durationMs: 140, type: 'sawtooth', gain: 0.55, delayMs: 50 },
  ],

  'combat.attackDeclare': [{ freq: 340, durationMs: 90, type: 'sawtooth', gain: 0.5 }],
  'combat.hit': [{ freq: 150, durationMs: 90, type: 'square', gain: 0.55 }],
  'combat.heavyHit': [{ freq: 100, durationMs: 160, type: 'square', gain: 0.65 }],
  'combat.directO2': [{ freq: 200, durationMs: 140, type: 'sawtooth', gain: 0.55 }],
  'combat.overflow': [{ freq: 130, durationMs: 180, type: 'sawtooth', gain: 0.6 }],
  'combat.destroy': [
    { freq: 400, durationMs: 80, type: 'sawtooth', gain: 0.55 },
    { freq: 90, durationMs: 220, type: 'sawtooth', gain: 0.6, delayMs: 70 },
  ],

  'resource.o2Loss': [{ freq: 260, durationMs: 90, type: 'sine', gain: 0.4 }],
  'resource.momentumGain': [{ freq: 660, durationMs: 80, type: 'triangle', gain: 0.45 }],
  'resource.momentumSpend': [{ freq: 440, durationMs: 70, type: 'triangle', gain: 0.4 }],

  'engine.trigger': [{ freq: 380, durationMs: 90, type: 'sine', gain: 0.4 }],
  'rift.trigger': [{ freq: 250, durationMs: 200, type: 'sine', gain: 0.45 }],

  'match.victory': [
    { freq: 523, durationMs: 130, type: 'triangle', gain: 0.55 },
    { freq: 659, durationMs: 130, type: 'triangle', gain: 0.55, delayMs: 120 },
    { freq: 784, durationMs: 220, type: 'triangle', gain: 0.6, delayMs: 240 },
  ],
  'match.defeat': [
    { freq: 300, durationMs: 160, type: 'sawtooth', gain: 0.5 },
    { freq: 220, durationMs: 160, type: 'sawtooth', gain: 0.5, delayMs: 140 },
    { freq: 140, durationMs: 320, type: 'sawtooth', gain: 0.55, delayMs: 280 },
  ],
};

let ctx: AudioContext | null = null;
function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

function playTone(audioCtx: AudioContext, tone: Tone, masterVolume: number) {
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = tone.type ?? 'sine';
  osc.frequency.value = tone.freq;
  const peakGain = (tone.gain ?? 0.5) * masterVolume;
  const startAt = audioCtx.currentTime + (tone.delayMs ?? 0) / 1000;
  const endAt = startAt + tone.durationMs / 1000;
  // Quick attack, exponential-ish decay to a near-zero floor - avoids the sharp
  // "click" a hard cutoff would otherwise produce at the end of every tone.
  gainNode.gain.setValueAtTime(0, startAt);
  gainNode.gain.linearRampToValueAtTime(peakGain, startAt + 0.008);
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakGain * 0.01), endAt);
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(endAt + 0.02);
}

/** Play a sound effect by key. Safe to call from anywhere in a mounted React
 *  component - does nothing (silently) if muted, if audio can't initialize, or
 *  if the browser blocks playback for any reason. Never throws. */
export function playSfx(key: SfxKey) {
  try {
    const { sfxMuted, sfxVolume } = useAudioStore.getState();
    if (sfxMuted || sfxVolume <= 0) return;
    const audioCtx = getContext();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      // Best-effort - browsers require a user gesture to resume; if this fails,
      // the tone below simply won't be audible yet, but nothing throws either way.
      audioCtx.resume().catch(() => {});
    }
    for (const tone of SFX_TONES[key]) playTone(audioCtx, tone, sfxVolume);
  } catch {
    // Audio is enhancement-only - never let a playback failure affect anything else.
  }
}

/*
 * NOTE for swapping in real sound files later: replace playTone's internals with
 * an <audio>/HTMLAudioElement (or decoded AudioBuffer) lookup keyed by the same
 * SfxKey, pooling a few instances per key for overlapping playback if needed. The
 * public API (playSfx(key)) and every call site elsewhere in the app would not
 * need to change at all.
 */
