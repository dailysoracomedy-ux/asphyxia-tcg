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
  /** Square canvas size in px. */
  size?: number;
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

export default function CoinFlip3D({ size = 280, skinFilter = 'none', flipId, flipTo, onLanded }: CoinFlip3DProps) {
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
    renderer.setSize(size, size);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    camera.position.set(0, 1.15, 6.0);
    camera.lookAt(0, 0.35, 0);

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
    const matHeads = new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.25, roughness: 0.55 });
    const matTails = new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.25, roughness: 0.55 });

    let disposed = false;
    loadFilteredTexture(COIN_FRONT_SRC, skinFilter, (t) => {
      if (disposed) return;
      t.center.set(0.5, 0.5);
      t.rotation = Math.PI / 2; // top cap: stand the art upright
      matHeads.map = t;
      matHeads.color.set(0xffffff);
      matHeads.needsUpdate = true;
    });
    loadFilteredTexture(COIN_BACK_SRC, skinFilter, (t) => {
      if (disposed) return;
      t.center.set(0.5, 0.5);
      t.rotation = -Math.PI / 2; // bottom cap UVs run the other way
      matTails.map = t;
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
      } else if (state === 'flip') {
        const p = Math.min((t - t0) / FLIP_DUR, 1);
        spinner.rotation.x = fromRot + (toRot - fromRot) * easeOutCubic(p);
        rig.position.y = 0.35 + TOSS_H * 4 * p * (1 - p); // parabolic toss
        spinner.rotation.y = Math.sin(p * Math.PI) * 0.35; // mid-air wobble
        spinner.rotation.z = Math.sin(p * Math.PI * 2) * 0.12;
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
      [matEdge, matHeads, matTails].forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
    // skinFilter/size changes rebuild the scene - both only change between
    // flips (Locker / menu navigation), never mid-toss.
  }, [size, skinFilter]);

  // Prop-driven flip trigger: a new flipId with a target face launches the toss.
  useEffect(() => {
    if (flipTo && flipId > 0 && flipId !== lastFlipId.current) {
      lastFlipId.current = flipId;
      controlRef.current?.flip(flipTo);
    }
  }, [flipId, flipTo]);

  return (
    <div ref={hostRef} style={{ width: size, height: size }} className="relative select-none">
      {fallback && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={fallbackFace === 'heads' ? COIN_FRONT_SRC : COIN_BACK_SRC}
          alt={fallbackFace === 'heads' ? 'Heads' : 'Tails'}
          draggable={false}
          className="absolute rounded-full pointer-events-none"
          style={{
            filter: skinFilter !== 'none' ? skinFilter : undefined,
            width: size * 0.75,
            height: size * 0.75,
            left: size * 0.125,
            top: size * 0.125,
          }}
        />
      )}
    </div>
  );
}
