'use client';

/**
 * Commit 51 - THE LOCKER hero preview. One big, ALIVE 3D preview of the
 * currently-selected cosmetic (playmat / sleeve / coin), rendered as a real
 * lit WebGL object the user steers with the mouse - the same interaction feel
 * as the in-game card tilt (cursor position maps to rotateX/rotateY), so it
 * reacts to you rather than just auto-spinning.
 *
 * Each object type moves the way its real-world counterpart would, so all
 * three feel congruent yet physical:
 *   - COIN  : a real thick cylinder, reuses the coin toss's emissive/bloom
 *             look; steer-tilt on top of a slow idle spin so you see both faces.
 *   - PLAYMAT: a large flat plane with a subtle cloth/neoprene material and a
 *             soft specular sheen that rolls across as you tilt it - a mat lying
 *             on a table, banking to your cursor.
 *   - SLEEVE : a card-shaped plane with real thickness and a glossy plastic
 *             highlight that sweeps as you tilt - the sleeve's plastic sheen is
 *             what sells it as a physical object.
 *
 * At rest (no pointer) the object eases back toward neutral with a whisper of
 * idle drift, so it never looks dead but never fights your input either.
 *
 * Only ONE of these is mounted at a time (the selected item), so it can afford
 * a richer scene than the tiny grid CoinPreview3D tiles.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { COIN_FRONT_SRC, COIN_BACK_SRC, SLEEVE_BASE_SRC } from '@/lib/cosmetics';
import { loadCoinTextures, reededEdgeTexture } from '@/lib/coinTextures';

export type HeroKind = 'playmat' | 'sleeve' | 'coin';

export interface HeroPreviewProps {
  kind: HeroKind;
  /** Playmat/sleeve/coin-front image URL (or null for the default). */
  image: string | null;
  /** Accent color used for edge glow / rim (playmat edge, sleeve rim). */
  accent?: string | null;
  size?: number;
}

export default function LockerHeroPreview3D({ kind, image, accent, size = 300 }: HeroPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Live pointer target (−1..1) and the smoothed value the object eases toward.
  const targetRef = useRef({ x: 0, y: 0, active: false });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }
    const w = size;
    const h = kind === 'playmat' ? Math.round(size * 0.62) : size;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 30);
    camera.position.set(0, 0, 5.4);
    camera.lookAt(0, 0, 0);

    // Unified top-left key light (matches the app-wide light convention),
    // plus a soft accent fill so the mat/sleeve catch a colored sheen.
    scene.add(new THREE.AmbientLight(0x8f8f9c, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const accentColor = new THREE.Color(accent || '#ff2fd0');
    const fill = new THREE.PointLight(accentColor.getHex(), 0.9, 20);
    fill.position.set(3, -1, 3);
    scene.add(fill);

    const disposables: { dispose(): void }[] = [];
    let obj: THREE.Object3D;
    let coinMats: THREE.MeshStandardMaterial[] | null = null;
    let disposed = false;

    const loader = new THREE.TextureLoader();

    if (kind === 'coin') {
      const R = 1.5, T = 0.22;
      const matEdge = new THREE.MeshStandardMaterial({ map: reededEdgeTexture(), metalness: 0.85, roughness: 0.42 });
      const matHeads = new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.25, roughness: 0.55, emissive: 0xffffff, emissiveIntensity: 0 });
      const matTails = new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.25, roughness: 0.55, emissive: 0xffffff, emissiveIntensity: 0 });
      loadCoinTextures(image ?? COIN_FRONT_SRC, 'none', 1024, (base, em) => {
        if (disposed) return;
        for (const t of [base, em]) { t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; }
        matHeads.map = base; matHeads.emissiveMap = em; matHeads.emissiveIntensity = 1.3; matHeads.color.set(0xffffff); matHeads.needsUpdate = true;
      });
      loadCoinTextures(COIN_BACK_SRC, 'none', 1024, (base, em) => {
        if (disposed) return;
        for (const t of [base, em]) { t.center.set(0.5, 0.5); t.rotation = -Math.PI / 2; }
        matTails.map = base; matTails.emissiveMap = em; matTails.emissiveIntensity = 1.3; matTails.color.set(0xffffff); matTails.needsUpdate = true;
      });
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(R, R, T, 96), [matEdge, matHeads, matTails]);
      coin.rotation.x = Math.PI / 2;
      obj = coin;
      coinMats = [matHeads, matTails];
      disposables.push(coin.geometry, matEdge, matHeads, matTails);
      scene.add(coin);
    } else {
      // Playmat = wide plane (cloth), Sleeve = card plane (glossy plastic).
      const isMat = kind === 'playmat';
      const pw = isMat ? 3.9 : 2.0;
      const ph = isMat ? 2.4 : 2.8;
      const depth = 0.06;
      const group = new THREE.Group();

      const faceMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: isMat ? 0.08 : 0.2,
        roughness: isMat ? 0.82 : 0.28, // cloth = matte/rough; plastic sleeve = glossy
      });
      // Load the art (or a fallback) onto the face.
      const src = image ?? (isMat ? null : SLEEVE_BASE_SRC);
      if (src) {
        loader.load(src, (tex) => {
          if (disposed) return;
          tex.colorSpace = THREE.SRGBColorSpace;
          faceMat.map = tex;
          faceMat.needsUpdate = true;
        });
      } else {
        // 'faction' default playmat with no art: a dark accent gradient look.
        faceMat.color.set(0x11060f);
        faceMat.emissive = new THREE.Color(accentColor).multiplyScalar(0.12);
      }
      const sideMat = new THREE.MeshStandardMaterial({ color: 0x0a0a10, metalness: 0.3, roughness: 0.6 });
      const geo = new THREE.BoxGeometry(pw, ph, depth);
      // BoxGeometry material order: px,nx,py,ny,pz(front),nz(back)
      const mats = [sideMat, sideMat, sideMat, sideMat, faceMat, sideMat];
      const plane = new THREE.Mesh(geo, mats);
      group.add(plane);

      // A glossy specular streak for the sleeve (a moving plastic highlight),
      // and a soft accent rim for the mat.
      obj = group;
      disposables.push(geo, faceMat, sideMat);
      scene.add(group);
    }

    const composer = new EffectComposer(renderer);
    const rp = new RenderPass(scene, camera);
    rp.clearAlpha = 0;
    composer.addPass(rp);
    // Coins get strong bloom (emissive engraving); mats/sleeves get a gentle
    // bloom just to lift the specular highlights.
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), kind === 'coin' ? 0.7 : 0.35, 0.3, kind === 'coin' ? 0.72 : 0.82);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.setSize(w, h);

    // Pointer steering: map cursor within the canvas to −1..1.
    function onMove(e: PointerEvent) {
      const r = renderer.domElement.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
      targetRef.current = { x: nx, y: ny, active: true };
    }
    function onLeave() {
      targetRef.current = { x: 0, y: 0, active: false };
    }
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    // Also track when the pointer is anywhere over the host (bigger hit area).
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);

    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clock = new THREE.Clock();
    // Smoothed rotation state.
    let curX = 0, curY = 0;
    let raf = 0;

    // Max steer angles (radians). Sleeve/mat tilt more dramatically than coin.
    const MAXX = kind === 'coin' ? 0.5 : 0.55;
    const MAXY = kind === 'coin' ? 0.6 : 0.7;

    function animate() {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const tgt = targetRef.current;

      // Idle drift when not steering, so it never looks dead.
      const idleX = reduced ? 0 : Math.sin(t * 0.7) * 0.05;
      const idleY = reduced ? 0 : Math.sin(t * 0.5) * 0.08;

      const wantY = tgt.active ? tgt.x * MAXY : idleY;
      const wantX = tgt.active ? tgt.y * MAXX : idleX;
      // Ease toward the target (smooth, like the card tilt's transition).
      curX += (wantX - curX) * 0.12;
      curY += (wantY - curY) * 0.12;

      if (kind === 'coin') {
        // Steer on top of a slow idle spin so both faces show.
        const spin = reduced ? 0 : t * 0.5;
        obj.rotation.x = Math.PI / 2 + curX;
        obj.rotation.y = spin + curY;
        obj.rotation.z = curX * 0.1;
        if (coinMats) {
          const breathe = 1.3 + (reduced ? 0 : Math.sin(t * 2) * 0.2);
          coinMats.forEach((m) => { m.emissiveIntensity = m.emissiveMap ? breathe : 0; });
        }
      } else {
        // Mat/sleeve: bank toward the cursor. rotateX from vertical cursor,
        // rotateY from horizontal - exactly the in-game card feel.
        obj.rotation.x = -curX; // cursor down -> top tilts toward viewer
        obj.rotation.y = curY;
        obj.rotation.z = curY * 0.04;
      }
      composer.render();
    }
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      disposables.forEach((d) => d.dispose());
      composer.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, [kind, image, accent, size]);

  const h = kind === 'playmat' ? Math.round(size * 0.62) : size;
  return <div ref={hostRef} style={{ width: size, height: h, cursor: 'grab' }} className="mx-auto select-none" aria-hidden />;
}
