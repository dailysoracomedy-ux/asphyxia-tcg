'use client';

/**
 * Commit 42 - the real 3D coin. A genuine three.js cylinder (not a CSS
 * face-swap): your coin art on the caps, a machined reeded edge around the
 * side, pink/green scene lights, and a cast shadow that sells the toss.
 *
 * Replaces NewGameMenu's old 2D squash-flip. Total spin is ~1.1s + ~0.55s
 * landing wobble - roughly half the old audio-loop-length spin, per the
 * Commit 42 brief. Audio here is orchestrated around that shorter arc:
 * coin.flipStart fires at the toss and coin.flipLand at touchdown; the old
 * coin.flipLoop is intentionally retired since a 1.1s toss has no room for a
 * 1.785s loop (see sfx.ts's Commit 34.3 note for the measured durations).
 *
 * Coin skins (lib/cosmetics.ts) are applied by drawing the coin art through a
 * CSS filter on a 2D canvas before it becomes a WebGL texture - filters can't
 * reach inside WebGL, so the tint is baked in at texture build time instead.
 *
 * Commit 44 lighting model - the coin's own colors glow, nothing else does.
 * The old approach (a big additive halo sprite + a shadow-mapped floor) had
 * three reported failures: the halo clipped at the canvas edges, the coin's
 * real cast shadow smeared across the halo mid-sway, and the glow read as "a
 * light behind the coin" rather than "neon inlays IN the coin." All replaced:
 * an emissive mask is extracted from the coin art itself (high-saturation,
 * bright pixels = the neon triangle channels; stone and metal masked out),
 * and a real UnrealBloomPass with a luminance threshold blooms only those
 * regions - so the inlays bleed light past their own edges, the rim stays
 * matte, and mid-flip the edge-on coin shows a thin glowing seam. Grounding
 * comes from a fake contact blob that shrinks and fades as the coin rises -
 * physically plausible and structurally incapable of smearing over anything.
 *
 * Face-orientation note (learned the hard way in the standalone demo): three's
 * cylinder cap UVs sit 90° rotated relative to the screen once the coin is
 * pitched to face the camera, and the two caps' UVs run in opposite
 * directions - hence the +90°/-90° texture rotations below. No mirroring is
 * needed; the bottom cap reads unmirrored once the rotation is right.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { COIN_FRONT_SRC, COIN_BACK_SRC } from '@/lib/cosmetics';
import { playSfx } from '@/audio/sfx';

export type CoinFace = 'heads' | 'tails';

interface CoinFlip3DProps {
  /** Canvas size in px. Portrait by default (Commit 43): the toss arc is tall,
   *  and a square canvas was cropping the coin at the apex of its throw. */
  width?: number;
  height?: number;
  /** CSS filter baked into the coin textures (from the selected CoinSkin). */
  skinFilter?: string;
  /** Bump this to a new positive value to launch a flip to `flipTo`. */
  flipId: number;
  flipTo: CoinFace | null;
  /** Fires once, after the landing wobble settles. */
  onLanded?: () => void;
}

const FLIP_DUR = 1.1;
const SETTLE_DUR = 0.55;
const TOSS_H = 1.9;
const TURNS = 4;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/** Draws an image through a CSS filter onto a canvas, then derives an
 *  emissive mask from it: only saturated, bright pixels (the neon inlays)
 *  survive; stone/metal goes black. Both textures share the same pixels, so
 *  the glow always sits exactly on the art it comes from - including through
 *  coin-skin tint filters, since the mask is computed AFTER the filter. */
function loadCoinTextures(src: string, filter: string, onReady: (base: THREE.Texture, emissive: THREE.Texture) => void) {
  const img = new Image();
  img.onload = () => {
    const S = 1024;
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

function reededEdgeTexture(): THREE.Texture {
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

export default function CoinFlip3D({ width = 300, height = 430, skinFilter = 'none', flipId, flipTo, onLanded }: CoinFlip3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  /** Imperative bridge into the render loop - re-renders never rebuild the scene. */
  const controlRef = useRef<{ flip: (to: CoinFace) => void } | null>(null);
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;
  const lastFlipId = useRef(0);
  // No-WebGL fallback (jsdom test harness, blocked/absent GPU): a flat coin
  // image that still honors the exact same flip contract - same sounds, same
  // total duration, same onLanded timing - so game flow and tests behave
  // identically whether or not a GPU showed up.
  const [fallback, setFallback] = useState(false);
  const [fallbackFace, setFallbackFace] = useState<CoinFace>('heads');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reducedMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFallback(true);
      const timeouts: ReturnType<typeof setTimeout>[] = [];
      controlRef.current = {
        flip(to: CoinFace) {
          playSfx('coin.flipStart');
          timeouts.push(
            setTimeout(() => {
              setFallbackFace(to);
              playSfx('coin.flipLand');
              timeouts.push(setTimeout(() => onLandedRef.current?.(), SETTLE_DUR * 1000));
            }, FLIP_DUR * 1000)
          );
        },
      };
      return () => {
        timeouts.forEach(clearTimeout);
        controlRef.current = null;
      };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Commit 43 reframe - the full toss must fit: coin top at the arc's apex
    // reaches y ~= 0.35 + TOSS_H + R = 3.5 world units, and the old square
    // frame (fov 38 at 6 units) topped out around 2.4, cropping the coin at
    // the height of its own throw (the reported bug). Portrait aspect + wider
    // fov + a higher, farther camera puts the visible top at ~4.2 and still
    // keeps the floor shadow at -1.7 in frame.
    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 60);
    camera.position.set(0, 1.7, 7.2);
    camera.lookAt(0, 1.15, 0);

    // The art carries baked lighting - bright ambient keeps it true, and the
    // neon points work the edge, rim glint and floor shadow.
    scene.add(new THREE.AmbientLight(0x8a8a95, 1.05));
    const key = new THREE.PointLight(0xff2fd0, 0.9, 24);
    key.position.set(-4, 3.4, 3.2);
    scene.add(key);
    const rim = new THREE.PointLight(0x39ff6a, 0.6, 24);
    rim.position.set(4.2, 2.2, -2.4);
    scene.add(rim);
    // Commit 43 - a light that RIDES the toss. The fixed scene lights are
    // aimed at the rest position, so mid-throw the coin used to climb out of
    // its own lighting and go flat; this one is parented to the rig and
    // travels with it, keeping the faces lit at the apex.
    const riderLight = new THREE.PointLight(0xff2fd0, 1.15, 9);
    riderLight.position.set(-0.6, 0.5, 1.6);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(0, 6, 5);
    scene.add(fill);

    // Contact blob instead of a shadow-mapped floor: a soft dark disc that
    // shrinks and fades as the coin rises. Grounds the coin exactly like a
    // shadow would, but it's fully controlled - it can never be cast across
    // the glow or anything else (the reported smearing bug).
    const blobCanvas = document.createElement('canvas');
    blobCanvas.width = blobCanvas.height = 128;
    const bx = blobCanvas.getContext('2d')!;
    const bg = bx.createRadialGradient(64, 64, 4, 64, 64, 64);
    bg.addColorStop(0, 'rgba(0,0,0,0.55)');
    bg.addColorStop(0.6, 'rgba(0,0,0,0.28)');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    bx.fillStyle = bg;
    bx.fillRect(0, 0, 128, 128);
    const blobMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(blobCanvas),
      transparent: true,
      depthWrite: false,
    });
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = -1.68;
    blob.scale.setScalar(2.7);
    scene.add(blob);

    const R = 1.25;
    const T = 0.18;
    const matEdge = new THREE.MeshStandardMaterial({ map: reededEdgeTexture(), metalness: 0.85, roughness: 0.42 });
    // Low metalness: the art is pre-lit; metal shading would darken and double-light it.
    // emissive is driven by the extracted neon mask (set below with the base
    // map): white emissive color x mask x intensity pushes ONLY the inlay
    // pixels over the bloom threshold. Everything else stays matte.
    const matHeads = new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.25, roughness: 0.55, emissive: 0xffffff, emissiveIntensity: 0 });
    const matTails = new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.25, roughness: 0.55, emissive: 0xffffff, emissiveIntensity: 0 });

    let disposed = false;
    loadCoinTextures(COIN_FRONT_SRC, skinFilter, (base, emissive) => {
      if (disposed) return;
      for (const t of [base, emissive]) {
        t.center.set(0.5, 0.5);
        t.rotation = Math.PI / 2; // top cap: stand the art upright
      }
      matHeads.map = base;
      matHeads.emissiveMap = emissive;
      matHeads.emissiveIntensity = 1.45;
      matHeads.color.set(0xffffff);
      matHeads.needsUpdate = true;
    });
    loadCoinTextures(COIN_BACK_SRC, skinFilter, (base, emissive) => {
      if (disposed) return;
      for (const t of [base, emissive]) {
        t.center.set(0.5, 0.5);
        t.rotation = -Math.PI / 2; // bottom cap UVs run the other way
      }
      matTails.map = base;
      matTails.emissiveMap = emissive;
      matTails.emissiveIntensity = 1.45;
      matTails.color.set(0xffffff);
      matTails.needsUpdate = true;
    });

    const coin = new THREE.Mesh(new THREE.CylinderGeometry(R, R, T, 96), [matEdge, matHeads, matTails]);
    coin.rotation.x = Math.PI / 2; // heads toward camera at rest

    const spinner = new THREE.Group(); // flip rotation
    spinner.add(coin);
    const rig = new THREE.Group(); // toss height + idle bob
    rig.add(spinner);
    rig.add(riderLight);
    rig.position.y = 0.35;
    scene.add(rig);

    // Post-processing: real bloom with a luminance threshold. Only pixels the
    // emissive mask pushed bright enough bloom - the neon inlays and the
    // occasional specular ping - so the glow hugs the art instead of haloing
    // the whole coin, and there is nothing scaled past the canvas to clip.
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    renderPass.clearAlpha = 0; // keep the canvas transparent over the menu card
    composer.addPass(renderPass);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.85, 0.28, 0.72);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    composer.setSize(width, height);

    const clock = new THREE.Clock();
    let state: 'idle' | 'flip' | 'settle' = 'idle';
    let t0 = 0;
    let fromRot = 0;
    let toRot = 0;
    let isTails = false;

    controlRef.current = {
      flip(to: CoinFace) {
        if (state !== 'idle') return;
        isTails = to === 'tails';
        playSfx('coin.flipStart');
        if (reducedMotion) {
          spinner.rotation.set(isTails ? Math.PI : 0, 0, 0);
          playSfx('coin.flipLand');
          onLandedRef.current?.();
          return;
        }
        fromRot = spinner.rotation.x % (Math.PI * 2);
        toRot = Math.PI * 2 * TURNS + (isTails ? Math.PI : 0);
        state = 'flip';
        t0 = clock.getElapsedTime();
      },
    };

    let raf = 0;
    function animate() {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      if (state === 'idle') {
        rig.position.y = 0.35 + Math.sin(t * 1.6) * 0.05;
        spinner.rotation.y = Math.sin(t * 0.7) * 0.16;
        spinner.rotation.z = Math.sin(t * 0.9) * 0.05;
        // Neon inlays breathe: a slow emissive swell, picked up by the bloom.
        const breathe = 1.45 + Math.sin(t * 2.1) * 0.25;
        matHeads.emissiveIntensity = matHeads.emissiveMap ? breathe : 0;
        matTails.emissiveIntensity = matTails.emissiveMap ? breathe : 0;
      } else if (state === 'flip') {
        const p = Math.min((t - t0) / FLIP_DUR, 1);
        spinner.rotation.x = fromRot + (toRot - fromRot) * easeOutCubic(p);
        rig.position.y = 0.35 + TOSS_H * 4 * p * (1 - p); // parabolic toss
        spinner.rotation.y = Math.sin(p * Math.PI) * 0.35; // mid-air wobble
        spinner.rotation.z = Math.sin(p * Math.PI * 2) * 0.12;
        // Inlays flare hardest at the apex of the throw.
        const flare = 1.45 + Math.sin(p * Math.PI) * 0.8;
        matHeads.emissiveIntensity = matHeads.emissiveMap ? flare : 0;
        matTails.emissiveIntensity = matTails.emissiveMap ? flare : 0;
        if (p >= 1) {
          spinner.rotation.x = isTails ? Math.PI : 0;
          playSfx('coin.flipLand');
          state = 'settle';
          t0 = t;
        }
      } else {
        const s = Math.min((t - t0) / SETTLE_DUR, 1);
        const damp = Math.exp(-5.5 * s);
        spinner.rotation.z = damp * Math.sin(s * 22) * 0.16;
        spinner.rotation.y = damp * Math.sin(s * 17) * 0.1;
        rig.position.y = 0.35 + damp * Math.abs(Math.sin(s * 14)) * 0.06;
        if (s >= 1) {
          spinner.rotation.set(isTails ? Math.PI : 0, 0, 0);
          state = 'idle';
          onLandedRef.current?.();
        }
      }

      // Contact blob: shrink + fade with height above the rest position.
      const hNorm = Math.min(1, Math.max(0, (rig.position.y - 0.35) / TOSS_H));
      blob.scale.setScalar(2.7 * (1 - 0.4 * hNorm));
      blobMat.opacity = 1 - 0.8 * hNorm;

      composer.render();
    }
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      controlRef.current = null;
      coin.geometry.dispose();
      blob.geometry.dispose();
      blobMat.map?.dispose();
      blobMat.dispose();
      composer.dispose();
      [matEdge, matHeads, matTails].forEach((m) => {
        m.map?.dispose();
        m.emissiveMap?.dispose();
        m.dispose();
      });
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
    // skinFilter/dimension changes rebuild the scene - all only change
    // between flips (Locker / menu navigation), never mid-toss.
  }, [width, height, skinFilter]);

  // Prop-driven flip trigger: a new flipId with a target face launches the toss.
  useEffect(() => {
    if (flipTo && flipId > 0 && flipId !== lastFlipId.current) {
      lastFlipId.current = flipId;
      controlRef.current?.flip(flipTo);
    }
  }, [flipId, flipTo]);

  return (
    <div
      ref={hostRef}
      style={{ width, height }}
      className="relative select-none"
    >
      {fallback && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={fallbackFace === 'heads' ? COIN_FRONT_SRC : COIN_BACK_SRC}
          alt={fallbackFace === 'heads' ? 'Heads' : 'Tails'}
          draggable={false}
          className="absolute rounded-full pointer-events-none"
          style={{
            filter: skinFilter !== 'none' ? skinFilter : undefined,
            width: width * 0.75,
            height: width * 0.75,
            left: width * 0.125,
            top: (height - width * 0.75) / 2,
          }}
        />
      )}
    </div>
  );
}
