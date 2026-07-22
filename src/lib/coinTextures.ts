/**
 * Commit 50.4 - extracted from CoinFlip3D.tsx so the new lightweight Locker
 * coin preview (CoinPreview3D.tsx) can build pixel-identical coin materials
 * without duplicating the emissive-mask math. Anything that touches "how a
 * coin texture is built" belongs here now, not copy-pasted per component.
 */
import * as THREE from 'three';

/** Draws an image through an optional CSS filter onto a canvas, then derives
 *  an emissive mask from it: only saturated, bright pixels (the neon inlays)
 *  survive; stone/metal goes black. Both textures share the same pixels, so
 *  the glow always sits exactly on the art it comes from. `size` controls the
 *  canvas resolution - the full flip uses 1024 for a crisp toss close-up;
 *  small Locker previews can use far less since they're rendered tiny. */
export function loadCoinTextures(
  src: string,
  filter: string,
  size: number,
  onReady: (base: THREE.Texture, emissive: THREE.Texture) => void
) {
  const img = new Image();
  img.onload = () => {
    const S = size;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d')!;
    // Flatten onto the scene's near-black so any transparent corners blend in.
    x.fillStyle = '#05050a';
    x.fillRect(0, 0, S, S);
    if (filter && filter !== 'none') x.filter = filter;
    x.drawImage(img, 0, 0, S, S);

    const e = document.createElement('canvas');
    e.width = e.height = S;
    const ex = e.getContext('2d')!;
    ex.drawImage(c, 0, 0);
    const data = ex.getImageData(0, 0, S, S);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      const lum = mx / 255;
      // Soft-edged keep factor: fully on for vivid bright pixels, ramping to
      // zero for anything dull or dark - a hard cutoff leaves crunchy fringes.
      const k = Math.min(1, Math.max(0, (sat - 0.35) / 0.2)) * Math.min(1, Math.max(0, (lum - 0.3) / 0.22));
      px[i] = r * k;
      px[i + 1] = g * k;
      px[i + 2] = b * k;
    }
    ex.putImageData(data, 0, 0);

    const base = new THREE.CanvasTexture(c);
    base.anisotropy = 8;
    base.colorSpace = THREE.SRGBColorSpace;
    const emissive = new THREE.CanvasTexture(e);
    emissive.anisotropy = 8;
    emissive.colorSpace = THREE.SRGBColorSpace;
    onReady(base, emissive);
  };
  img.src = src;
}

export function reededEdgeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#2b2b33';
  x.fillRect(0, 0, 1024, 64);
  for (let i = 0; i < 1024; i += 8) {
    x.fillStyle = (i / 8) % 2 ? '#1a1a20' : '#43434f';
    x.fillRect(i, 0, 8, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.x = 4;
  return t;
}
