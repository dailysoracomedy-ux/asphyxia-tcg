'use client';

/**
 * Commit 50.4 - a small, cheap, ALWAYS-3D coin for Locker preview tiles.
 * Reuses the exact same emissive-mask + bloom technique as the full
 * CoinFlip3D toss (via lib/coinTextures.ts) so a preview genuinely looks
 * like the real coin, not an approximation - but everything else is tuned
 * down hard, since up to ~10 of these can be mounted at once (one per coin
 * option in the grid) and each needs its own WebGL context:
 *   - small canvas (~120px), devicePixelRatio capped at 1
 *   - 48-segment cylinder instead of 96
 *   - bloom resolution capped low, one point light instead of three
 *   - texture size 512 instead of 1024 (see loadCoinTextures' `size` arg)
 *   - no contact blob / floor - it's a display case, not a toss
 * Motion is a slow continuous idle spin (not the toss state machine) so the
 * viewer glimpses both faces without any interaction needed.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { COIN_FRONT_SRC, COIN_BACK_SRC } from '@/lib/cosmetics';
import { loadCoinTextures, reededEdgeTexture } from '@/lib/coinTextures';

export default function CoinPreview3D({ frontSrc, size = 120 }: { frontSrc?: string | null; size?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // no WebGL - the tile's own name/blurb text is enough of a fallback
    }
    renderer.setPixelRatio(1); // capped hard - many of these render at once
    renderer.setSize(size, size);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
    camera.position.set(0, 0.4, 3.4);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x8a8a95, 1.1));
    const key = new THREE.PointLight(0xff2fd0, 0.8, 12);
    key.position.set(-2, 2, 2);
    scene.add(key);

    const R = 1.05;
    const T = 0.16;
    const matEdge = new THREE.MeshStandardMaterial({ map: reededEdgeTexture(), metalness: 0.85, roughness: 0.42 });
    const matHeads = new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.25, roughness: 0.55, emissive: 0xffffff, emissiveIntensity: 0 });
    const matTails = new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.25, roughness: 0.55, emissive: 0xffffff, emissiveIntensity: 0 });

    let disposed = false;
    loadCoinTextures(frontSrc ?? COIN_FRONT_SRC, 'none', 512, (base, emissive) => {
      if (disposed) return;
      for (const t of [base, emissive]) {
        t.center.set(0.5, 0.5);
        t.rotation = Math.PI / 2;
      }
      matHeads.map = base;
      matHeads.emissiveMap = emissive;
      matHeads.emissiveIntensity = 1.3;
      matHeads.color.set(0xffffff);
      matHeads.needsUpdate = true;
    });
    loadCoinTextures(COIN_BACK_SRC, 'none', 512, (base, emissive) => {
      if (disposed) return;
      for (const t of [base, emissive]) {
        t.center.set(0.5, 0.5);
        t.rotation = -Math.PI / 2;
      }
      matTails.map = base;
      matTails.emissiveMap = emissive;
      matTails.emissiveIntensity = 1.3;
      matTails.color.set(0xffffff);
      matTails.needsUpdate = true;
    });

    const coin = new THREE.Mesh(new THREE.CylinderGeometry(R, R, T, 48), [matEdge, matHeads, matTails]);
    coin.rotation.x = Math.PI / 2;
    scene.add(coin);

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    renderPass.clearAlpha = 0;
    composer.addPass(renderPass);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(size, size), 0.7, 0.25, 0.72);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    composer.setSize(size, size);

    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clock = new THREE.Clock();
    let raf = 0;
    function animate() {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      if (!reducedMotion) {
        coin.rotation.y = t * 0.6; // slow continuous spin - a display case, not a toss
        coin.rotation.z = Math.sin(t * 1.3) * 0.06;
      }
      const breathe = 1.3 + (reducedMotion ? 0 : Math.sin(t * 2) * 0.2);
      matHeads.emissiveIntensity = matHeads.emissiveMap ? breathe : 0;
      matTails.emissiveIntensity = matTails.emissiveMap ? breathe : 0;
      composer.render();
    }
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      coin.geometry.dispose();
      composer.dispose();
      [matEdge, matHeads, matTails].forEach((m) => {
        m.map?.dispose();
        m.emissiveMap?.dispose();
        m.dispose();
      });
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [frontSrc, size]);

  return <div ref={hostRef} style={{ width: size, height: size }} className="mx-auto select-none" aria-hidden />;
}
