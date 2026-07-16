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
 * Face-orientation note (learned the hard way in the standalone demo): three's
 * cylinder cap UVs sit 90° rotated relative to the screen once the coin is
 * pitched to face the camera, and the two caps' UVs run in opposite
 * directions - hence the +90°/-90° texture rotations below. No mirroring is
 * needed; the bottom cap reads unmirrored once the rotation is right.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
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

/** Draws an image through a CSS filter onto a canvas -> WebGL-safe texture. */
function loadFilteredTexture(src: string, filter: string, onReady: (t: THREE.Texture) => void) {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const x = c.getContext('2d')!;
    // Flatten onto the scene's near-black so any transparent corners blend in.
    x.fillStyle = '#05050a';
    x.fillRect(0, 0, 1024, 1024);
    if (filter && filter !== 'none') x.filter = filter;
    x.drawImage(img, 0, 0, 1024, 1024);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    onReady(t);
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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
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

    // Shadow-only floor: invisible surface, real cast shadow.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.5 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.7;
    floor.receiveShadow = true;
    scene.add(floor);

    const R = 1.25;
    const T = 0.18;
    const matEdge = new THREE.MeshStandardMaterial({ map: reededEdgeTexture(), metalness: 0.85, roughness: 0.42 });
    // Low metalness: the art is pre-lit; metal shading would darken and double-light it.
    // emissive + emissiveMap (set alongside map below) lets the art itself
    // glow faintly - reads as the coin catching neon, not just being lit.
    const matHeads = new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.25, roughness: 0.55, emissive: 0x2e2e34 });
    const matTails = new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.25, roughness: 0.55, emissive: 0x2e2e34 });

    let disposed = false;
    loadFilteredTexture(COIN_FRONT_SRC, skinFilter, (t) => {
      if (disposed) return;
      t.center.set(0.5, 0.5);
      t.rotation = Math.PI / 2; // top cap: stand the art upright
      matHeads.map = t;
      matHeads.emissiveMap = t;
      matHeads.color.set(0xffffff);
      matHeads.needsUpdate = true;
    });
    loadFilteredTexture(COIN_BACK_SRC, skinFilter, (t) => {
      if (disposed) return;
      t.center.set(0.5, 0.5);
      t.rotation = -Math.PI / 2; // bottom cap UVs run the other way
      matTails.map = t;
      matTails.emissiveMap = t;
      matTails.color.set(0xffffff);
      matTails.needsUpdate = true;
    });

    const coin = new THREE.Mesh(new THREE.CylinderGeometry(R, R, T, 96), [matEdge, matHeads, matTails]);
    coin.castShadow = true;
    coin.rotation.x = Math.PI / 2; // heads toward camera at rest

    const spinner = new THREE.Group(); // flip rotation
    spinner.add(coin);
    const rig = new THREE.Group(); // toss height + idle bob
    rig.add(spinner);
    rig.add(riderLight);
    // Additive neon halo behind the coin - a soft radial sprite that pulses
    // gently at rest and flares during the toss. Parented to the rig so it
    // travels with the throw.
    const haloCanvas = document.createElement('canvas');
    haloCanvas.width = haloCanvas.height = 256;
    const hx = haloCanvas.getContext('2d')!;
    const hg = hx.createRadialGradient(128, 128, 10, 128, 128, 128);
    hg.addColorStop(0, 'rgba(255,47,208,0.55)');
    hg.addColorStop(0.45, 'rgba(255,47,208,0.18)');
    hg.addColorStop(1, 'rgba(255,47,208,0)');
    hx.fillStyle = hg;
    hx.fillRect(0, 0, 256, 256);
    const haloTex = new THREE.CanvasTexture(haloCanvas);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    );
    halo.position.z = -0.55;
    halo.scale.setScalar(4.4);
    rig.add(halo);
    rig.position.y = 0.35;
    scene.add(rig);

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
        halo.material.opacity = 0.75 + Math.sin(t * 2.1) * 0.2; // breathing glow
        halo.scale.setScalar(4.4 + Math.sin(t * 2.1) * 0.15);
      } else if (state === 'flip') {
        const p = Math.min((t - t0) / FLIP_DUR, 1);
        spinner.rotation.x = fromRot + (toRot - fromRot) * easeOutCubic(p);
        rig.position.y = 0.35 + TOSS_H * 4 * p * (1 - p); // parabolic toss
        spinner.rotation.y = Math.sin(p * Math.PI) * 0.35; // mid-air wobble
        spinner.rotation.z = Math.sin(p * Math.PI * 2) * 0.12;
        halo.material.opacity = 0.85 + Math.sin(p * Math.PI) * 0.35; // flare at the apex
        halo.scale.setScalar(4.4 + Math.sin(p * Math.PI) * 0.9);
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

      renderer.render(scene, camera);
    }
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      controlRef.current = null;
      coin.geometry.dispose();
      halo.material.map?.dispose();
      halo.material.dispose();
      [matEdge, matHeads, matTails].forEach((m) => {
        m.map?.dispose();
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
      style={{
        width,
        height,
        // CSS silhouette glow - drop-shadow follows the coin's rendered alpha,
        // so the glow hugs the coin itself (and its whole arc), not the box.
        filter: 'drop-shadow(0 0 22px rgba(255,47,208,0.4)) drop-shadow(0 0 60px rgba(255,47,208,0.16))',
      }}
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
