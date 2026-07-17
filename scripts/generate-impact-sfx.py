#!/usr/bin/env python3
"""
Commit 43 - generates the three synthesized "impact layer" sounds that play
UNDER the existing sample set (see src/audio/sfx.ts SFX_LAYERS):

  combat.whoosh  - air-cut swoosh for the attack lunge animation
  combat.subBoom - sub-bass body thump layered under heavy hits / destroys / O2
  vfx.shatter    - digital glass/glitch shatter layered onto card destruction

Design notes: these are deliberately synthesized, not sampled - the game's
network-restricted build environment can't fetch sample libraries, and for a
neon/glitch aesthetic, clean DSP reads as intentional sound design. Each is
mastered (normalized, faded, soft-clipped where it helps) and exported via
ffmpeg to the same AAC/m4a format as the rest of public/audio/sfx.

Run from the repo root:  python3 scripts/generate-impact-sfx.py
Requires: numpy, scipy, ffmpeg on PATH. Output is committed, so this script
only needs re-running when the sounds themselves are being redesigned.
"""
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
OUT_DIR = Path(__file__).resolve().parent.parent / 'public' / 'audio' / 'sfx'
rng = np.random.default_rng(43)  # deterministic: re-running regenerates identical files


def master(x: np.ndarray, peak: float = 0.85, fade_ms: float = 6.0) -> np.ndarray:
    """DC-remove, normalize to `peak`, micro-fade both ends (kills clicks)."""
    x = x - np.mean(x, axis=0, keepdims=True)
    m = np.max(np.abs(x))
    if m > 0:
        x = x * (peak / m)
    n = int(SR * fade_ms / 1000)
    env = np.ones(x.shape[0])
    env[:n] = np.linspace(0, 1, n)
    env[-n:] = np.linspace(1, 0, n)
    return x * env[:, None]


def export(x: np.ndarray, name: str):
    x16 = np.int16(np.clip(x, -1, 1) * 32767)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        wavfile.write(f.name, SR, x16)
        wav_path = f.name
    out = OUT_DIR / f'{name}.m4a'
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path, '-c:a', 'aac', '-b:a', '96k', str(out)],
        check=True,
    )
    Path(wav_path).unlink()
    print(f'  {out.name}: {out.stat().st_size / 1024:.0f} KB')


def sweep_bandpass_noise(dur: float, f0: float, f1: float, seed_noise: np.ndarray, q: float = 2.2) -> np.ndarray:
    """Noise through a bandpass whose center sweeps f0->f1 exponentially -
    processed in short chunks with per-chunk filter coefficients."""
    n = int(SR * dur)
    out = np.zeros(n)
    chunk = 256
    for i in range(0, n, chunk):
        t = i / n
        fc = f0 * (f1 / f0) ** t
        lo = max(20, fc / (1 + 1 / q) / 1.4)
        hi = min(SR / 2 - 100, fc * 1.4)
        sos = signal.butter(2, [lo, hi], btype='bandpass', fs=SR, output='sos')
        seg = seed_noise[i : i + chunk]
        out[i : i + len(seg)] = signal.sosfilt(sos, seg)
    return out


def make_whoosh() -> np.ndarray:
    """~0.42s air-cut: two decorrelated noise channels through an upward
    sweeping bandpass, skewed envelope peaking ~60% through the swing."""
    dur = 0.42
    n = int(SR * dur)
    t = np.linspace(0, 1, n)
    # Envelope: slow build, sharp peak, quick release - the shape of a swing.
    env = np.sin(np.clip(t / 0.62, 0, 1) * np.pi / 2) ** 2 * np.exp(-np.clip((t - 0.62) / 0.16, 0, None) ** 2 * 3)
    ch = []
    for _ in range(2):
        noise = rng.standard_normal(n)
        swept = sweep_bandpass_noise(dur, 260, 2900, noise)
        ch.append(swept * env)
    x = np.stack(ch, axis=1)
    return master(x, peak=0.7)


def make_sub_boom() -> np.ndarray:
    """~0.8s cinematic body thump: exponential sine glide 140->36Hz with a 2nd
    harmonic, a 3ms transient click, an 80ms low noise body, soft-clipped."""
    dur = 0.8
    n = int(SR * dur)
    t = np.arange(n) / SR
    f = 140 * (36 / 140) ** (t / dur) ** 0.6
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) + 0.35 * np.sin(2 * phase)
    body *= np.exp(-t / 0.22)
    # transient click - tiny burst of highpassed noise right at the front
    click = rng.standard_normal(n) * np.exp(-t / 0.003)
    sos_hp = signal.butter(2, 900, btype='highpass', fs=SR, output='sos')
    click = signal.sosfilt(sos_hp, click) * 0.5
    # low noise body - the "air" of the impact
    lown = rng.standard_normal(n) * np.exp(-t / 0.08)
    sos_lp = signal.butter(2, 220, btype='lowpass', fs=SR, output='sos')
    lown = signal.sosfilt(sos_lp, lown) * 0.5
    x = np.tanh((body + click + lown) * 1.8)
    # keep it sub - everything above ~500Hz belongs to the sample it layers under
    sos_final = signal.butter(2, 500, btype='lowpass', fs=SR, output='sos')
    x = signal.sosfilt(sos_final, x)
    # peak 0.66, not 0.85: AAC encoding overshoots low-frequency-heavy signals
    # (inter-sample peaks) - measured 1.2 post-encode at 0.85, i.e. clipping.
    return master(np.stack([x, x], axis=1), peak=0.66)


def make_shatter() -> np.ndarray:
    """~0.9s digital shatter: 16 fast-decaying inharmonic partials scattered
    over the first 220ms + gated glitch noise bursts + a short synthetic
    reverb tail. Highpassed - the subBoom owns the bottom end."""
    dur = 0.9
    n = int(SR * dur)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for _ in range(16):
        f = float(np.exp(rng.uniform(np.log(700), np.log(6500))))
        amp = rng.uniform(0.3, 1.0)
        tau = rng.uniform(0.02, 0.12)
        onset = rng.uniform(0, 0.22)
        i0 = int(onset * SR)
        tt = t[: n - i0]
        partial = amp * np.sin(2 * np.pi * f * tt + rng.uniform(0, 2 * np.pi)) * np.exp(-tt / tau)
        x[i0:] += partial
    # gated glitch bursts - stuttery digital debris
    sos_hp = signal.butter(2, 1500, btype='highpass', fs=SR, output='sos')
    for k in range(6):
        onset = 0.03 * k + rng.uniform(0, 0.02)
        blen = rng.uniform(0.015, 0.03)
        i0, i1 = int(onset * SR), int((onset + blen) * SR)
        if i1 >= n:
            break
        burst = signal.sosfilt(sos_hp, rng.standard_normal(i1 - i0)) * rng.uniform(0.4, 0.9)
        x[i0:i1] += burst
    x *= np.exp(-t / 0.28)
    # short synthetic reverb tail so the debris "lands in a room"
    ir_n = int(0.25 * SR)
    ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / (0.09 * SR))
    wet = signal.fftconvolve(x, ir)[:n] * 0.0025
    x = x + wet
    sos_final = signal.butter(2, 550, btype='highpass', fs=SR, output='sos')
    x = signal.sosfilt(sos_final, x)
    # a touch of stereo: the right channel is the left, 7ms late and inverted-ish
    d = int(0.007 * SR)
    right = np.concatenate([np.zeros(d), x[:-d]]) * 0.92
    return master(np.stack([x, right], axis=1), peak=0.88)


if __name__ == '__main__':
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print('Generating Commit 43 impact layer:')
    export(make_whoosh(), 'combat.whoosh')
    export(make_sub_boom(), 'combat.subBoom')
    export(make_shatter(), 'vfx.shatter')
    print('Done.')
