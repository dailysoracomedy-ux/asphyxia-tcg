#!/usr/bin/env python3
"""
Commit 46 - generates the grunge texture kit under public/textures/. Five
small PNGs that the CSS chrome system (globals.css) layers over buttons,
panels and the whole screen:

  grain.png    - fine tileable film grain, animated by CSS into living static
  grime.png    - tileable multi-octave stain blotches (multiply layer)
  scratches.png- sparse thin wear scratches (screen layer on plates)
  plate.png    - dark brushed-metal plate surface (panel base)
  frame.png    - 9-slice chipped/eroded border frame (border-image on the
                 ::after of every .btn-3d / .panel-3d - the "chipped paint"
                 edge that makes chrome read as worn hardware)

All procedural (numpy/PIL), deterministic seed, tileable where marked - the
network-restricted build environment can't fetch texture packs, and generated
assets keep the repo lean (each file is a few KB). Re-run only when
redesigning the textures:  python3 scripts/generate-grunge-textures.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parent.parent / 'public' / 'textures'
rng = np.random.default_rng(46)


def make_tileable(a: np.ndarray, blend: int = 48) -> np.ndarray:
    """Cross-fade opposite edges so the texture tiles seamlessly."""
    h, w = a.shape
    out = a.copy().astype(np.float64)
    ramp = np.linspace(0, 1, blend)
    # horizontal wrap
    for i in range(blend):
        out[:, i] = out[:, i] * ramp[i] + out[:, w - blend + i] * (1 - ramp[i])
    # vertical wrap
    for i in range(blend):
        out[i, :] = out[i, :] * ramp[i] + out[h - blend + i, :] * (1 - ramp[i])
    return out


def octave_noise(size: int, octaves=(4, 8, 16, 32, 64), weights=None) -> np.ndarray:
    """Multi-octave value noise in [0,1] - upscaled random grids summed."""
    weights = weights or [1 / (i + 1) for i in range(len(octaves))]
    acc = np.zeros((size, size))
    for cells, w in zip(octaves, weights):
        grid = rng.random((cells, cells))
        img = Image.fromarray((grid * 255).astype(np.uint8)).resize((size, size), Image.BILINEAR)
        acc += (np.asarray(img) / 255.0) * w
    acc -= acc.min()
    acc /= acc.max()
    return acc


def save_la(lum: np.ndarray, alpha: np.ndarray, name: str):
    img = Image.merge(
        'LA',
        (
            Image.fromarray(np.clip(lum, 0, 255).astype(np.uint8)),
            Image.fromarray(np.clip(alpha, 0, 255).astype(np.uint8)),
        ),
    )
    path = OUT / name
    img.save(path, optimize=True)
    print(f'  {name}: {path.stat().st_size / 1024:.0f} KB')


def grain():
    """256px tileable white-noise grain. CSS animates its position in steps()
    for living film static; opacity is controlled CSS-side."""
    n = rng.normal(128, 55, (256, 256))
    save_la(n, np.full((256, 256), 255), 'grain.png')


def grime():
    """512px tileable stain blotches - dark multiply layer. High-contrast
    thresholded octave noise reads as oil smears and handling grime."""
    n = make_tileable(octave_noise(512))
    # soft threshold: only the darkest ~35% of the noise becomes grime
    a = np.clip((0.52 - n) / 0.52, 0, 1) ** 1.6
    save_la(np.full((512, 512), 12), a * 110, 'grime.png')


def scratches():
    """512px sparse thin scratches - light screen layer for metal plates."""
    a = np.zeros((512, 512))
    for _ in range(70):
        x0, y0 = rng.integers(0, 512, 2)
        ang = rng.uniform(-0.5, 0.5) + (0 if rng.random() < 0.7 else np.pi / 2)
        ln = rng.integers(30, 200)
        xs = (x0 + np.cos(ang) * np.arange(ln)).astype(int) % 512
        ys = (y0 + np.sin(ang) * np.arange(ln)).astype(int) % 512
        a[ys, xs] = rng.uniform(60, 160)
    img = Image.fromarray(a.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.4))
    save_la(np.full((512, 512), 235), np.asarray(img), 'scratches.png')


def plate():
    """512px dark brushed-metal plate: base tone + horizontal brushing +
    low-frequency mottling. Opaque - panel base surface."""
    base = octave_noise(512, octaves=(3, 6), weights=[1, 0.5]) * 26 + 14
    brush = rng.normal(0, 8, (512, 512))
    brush = np.asarray(Image.fromarray((brush + 128).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)))
    brush = np.asarray(Image.fromarray(brush).resize((512, 512))).astype(float)
    # smear horizontally for the brushed look
    k = np.ones((1, 24)) / 24
    from scipy.signal import convolve2d
    brushed = convolve2d(brush - 128, k, mode='same', boundary='wrap')
    lum = make_tileable(np.clip(base + brushed * 1.2, 6, 60))
    save_la(lum, np.full((512, 512), 255), 'plate.png')


def frame():
    """256px 9-slice chipped border frame with alpha: a dark eroded band
    around a transparent center. border-image-slice: 84 keeps corners intact.
    The erosion (noise carving both edges of the band) is what makes any
    button or panel border look like chipped, worn paint."""
    S = 256
    yy, xx = np.mgrid[0:S, 0:S]
    d = np.minimum.reduce([xx, yy, S - 1 - xx, S - 1 - yy]).astype(float)  # dist from edge
    n = octave_noise(S, octaves=(8, 16, 32), weights=[1, 0.6, 0.35])
    band = 26 + n * 26            # eroded inner boundary: 26..52px
    outer = 1 + n * 5             # slightly eaten outer edge too
    inside_band = (d >= outer) & (d <= band)
    a = np.zeros((S, S))
    # solid near the outer edge, ragged falloff toward the inner boundary
    fall = np.clip((band - d) / 14, 0, 1)
    a[inside_band] = (150 + n[inside_band] * 90) * fall[inside_band]
    # chip holes INSIDE the band - paint flaked off
    holes = octave_noise(S, octaves=(24, 48), weights=[1, 0.7])
    a[holes > 0.82] *= 0.15
    lum = 8 + n * 14
    save_la(lum, a, 'frame.png')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    print('Generating Commit 46 grunge texture kit:')
    grain()
    grime()
    scratches()
    plate()
    frame()
    print('Done.')
