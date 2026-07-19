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
 *   - COIN  : a real thick cylinder (reuses the coin toss's emissive/bloom
 *             look). Rests facing the viewer (no auto-spin - that felt weird)
 *             and is steered by the mouse, with a whisper of idle sway.
 *   - PLAYMAT: a large ROUNDED-CORNER cloth plate, sized to the art's true
 *             aspect ratio (never stretched), resting at a 3/4 tilt and
 *             floating with a subtle idle bob; a raking light sweeps a real
 *             highlight across it as you tilt.
 *   - SLEEVE : a rounded card plate with a glossy plastic material, same
 *             resting tilt + bob; the spec highlight sweep is what sells the
 *             plastic sheen.
 *
 * At rest the object floats with a subtle bob/sway (alive, never dead); the
 * moment you steer it, that idle fades out so it never fights your input.
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
    // Canvas fills the container's WIDTH (the wide hero panel) so a tilted mat
    // has the full panel width to swing into and never clips at the canvas edge
    // (Commit 52). Height is fixed per object type. Fall back to `size` if the
    // container hasn't been laid out yet.
    const containerW = host.clientWidth || size;
    const w = Math.max(containerW, size);
    const h = kind === 'playmat' ? Math.round(size * 0.62) : size;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 30);
    camera.position.set(0, 0, kind === 'playmat' ? 4.2 : 4.8);
    camera.lookAt(0, 0, 0);

    // Emissive-driven previews (Commit 52): the mat/sleeve art is put on the
    // EMISSIVE channel (below), so the surface shows at full, even brightness
    // everywhere - no lit hotspots, no dark corners - and bloom keys off the
    // texture's own bright areas (bright neon art glows more). So we only need
    // a little ambient + a soft key to give the beveled rounded EDGES some
    // dimensional shading; the face itself is self-lit. The coin keeps its
    // existing lit+emissive treatment.
    const isCoin = kind === 'coin';
    scene.add(new THREE.AmbientLight(0xffffff, isCoin ? 1.15 : 0.55));
    const key = new THREE.DirectionalLight(0xffffff, isCoin ? 2.0 : 0.7);
    key.position.set(-4, 5, 6);
    scene.add(key);
    const accentColor = new THREE.Color(accent || '#ff2fd0');
    if (isCoin) {
      // Coin only: gentle accent bounce + raking spec (unchanged behavior).
      const fillHue = accentColor.clone().lerp(new THREE.Color(0xffffff), 0.6);
      const fill = new THREE.PointLight(fillHue.getHex(), 0.55, 24);
      fill.position.set(3.5, -2, 4);
      scene.add(fill);
      const rake = new THREE.PointLight(0xffffff, 1.4, 18);
      rake.position.set(-1.5, 3.5, 3.5);
      scene.add(rake);
    }

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
      // Playmat = wide (cloth), Sleeve = card (glossy plastic). Both are built
      // as ROUNDED-CORNER extruded plates so they read as real physical
      // objects, and their dimensions are locked to the ART'S aspect ratio
      // once it loads, so the image is never stretched or squashed.
      const isMat = kind === 'playmat';

      const faceMat = new THREE.MeshStandardMaterial({
        color: 0x000000,           // base is black; all visible light is emissive
        emissive: 0xffffff,
        emissiveIntensity: 0.82,   // self-lit and glowing, but not blown out
        metalness: 0.0,
        roughness: 1.0,
      });
      const sideMat = new THREE.MeshStandardMaterial({ color: 0x08080d, metalness: 0.4, roughness: 0.5 });
      const group = new THREE.Group();
      obj = group;

      // Build (or rebuild) the rounded plate at a given width/height so we can
      // resize it to the art's true aspect ratio the moment the texture loads.
      let plate: THREE.Mesh | null = null;
      let plateGeo: THREE.ExtrudeGeometry | null = null;
      function buildPlate(pw: number, ph: number) {
        const r = Math.min(pw, ph) * (isMat ? 0.06 : 0.05); // corner radius
        const shape = new THREE.Shape();
        const x = -pw / 2, y = -ph / 2;
        shape.moveTo(x + r, y);
        shape.lineTo(x + pw - r, y);
        shape.quadraticCurveTo(x + pw, y, x + pw, y + r);
        shape.lineTo(x + pw, y + ph - r);
        shape.quadraticCurveTo(x + pw, y + ph, x + pw - r, y + ph);
        shape.lineTo(x + r, y + ph);
        shape.quadraticCurveTo(x, y + ph, x, y + ph - r);
        shape.lineTo(x, y + r);
        shape.quadraticCurveTo(x, y, x + r, y);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, steps: 1 });
        geo.center();
        // UVs from ExtrudeGeometry are in world units - normalize the front-face
        // UVs to 0..1 across the plate so the texture maps cleanly, no stretch.
        const pos = geo.attributes.position;
        const uv = geo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
          const px = pos.getX(i), py = pos.getY(i);
          uv.setXY(i, (px + pw / 2) / pw, (py + ph / 2) / ph);
        }
        uv.needsUpdate = true;
        if (plate) { group.remove(plate); plateGeo?.dispose(); }
        plateGeo = geo;
        plate = new THREE.Mesh(geo, [faceMat, sideMat]);
        group.add(plate);
      }
      // Initial placeholder size (replaced once the art's ratio is known).
      buildPlate(isMat ? 3.6 : 2.0, isMat ? 2.4 : 2.8);

      const src = image ?? (isMat ? null : SLEEVE_BASE_SRC);
      if (src) {
        loader.load(src, (tex) => {
          if (disposed) return;
          tex.colorSpace = THREE.SRGBColorSpace;
          // Emissive-driven: the art self-illuminates evenly (no lit hotspots),
          // and bloom keys off its own bright pixels.
          faceMat.emissiveMap = tex;
          faceMat.needsUpdate = true;
          // Lock the plate to the ART's real aspect ratio - never stretch it.
          const img = tex.image as { width: number; height: number };
          if (img?.width && img?.height) {
            const ar = img.width / img.height;
            // Mat can be wider now (canvas fills the panel width, so a tilted
            // mat has room to swing). Sleeve height trimmed so it's not so tall.
            const maxW = isMat ? 5.4 : 2.5;
            const maxH = isMat ? 3.1 : 3.0;
            let pw = maxW, ph = maxW / ar;
            if (ph > maxH) { ph = maxH; pw = maxH * ar; }
            buildPlate(pw, ph);
          }
        });
      } else {
        // 'faction' default playmat with no art: a subtle self-lit accent
        // glow (emissive-driven like everything else, kept dim so it reads as
        // "the stock mat" rather than a bright panel).
        faceMat.emissive = new THREE.Color(accentColor).multiplyScalar(1.0);
        faceMat.emissiveIntensity = 0.32;
      }
      disposables.push(faceMat, sideMat, { dispose: () => plateGeo?.dispose() });
      scene.add(group);
    }

    const composer = new EffectComposer(renderer);
    const rp = new RenderPass(scene, camera);
    rp.clearAlpha = 0;
    composer.addPass(rp);
    // Coin: strong bloom on the emissive engraving. Mat/sleeve: moderate bloom
    // with a threshold set so only the BRIGHTER areas of the emissive art bloom
    // (bright neon glows; dark areas stay put) - the "bloom is brighter on
    // brighter colors" behavior. strength / radius / threshold.
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      kind === 'coin' ? 0.7 : 0.55,
      kind === 'coin' ? 0.35 : 0.5,
      kind === 'coin' ? 0.72 : 0.6,
    );
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

      // Steer targets from the pointer (−1..1 within the canvas).
      const steerY = tgt.active ? tgt.x * MAXY : 0;
      const steerX = tgt.active ? tgt.y * MAXX : 0;
      // Ease toward the steer target (smooth, like the in-game card tilt).
      curX += (steerX - curX) * 0.1;
      curY += (steerY - curY) * 0.1;

      // Subtle idle bob/drift so it's alive even untouched. Fades out while the
      // user is actively steering so it never fights their input.
      const idleAmt = reduced ? 0 : (tgt.active ? 0.25 : 1);
      const bob = reduced ? 0 : Math.sin(t * 1.1) * 0.045 * idleAmt;       // vertical float
      const driftY = reduced ? 0 : Math.sin(t * 0.6) * 0.09 * idleAmt;      // slow yaw sway
      const driftX = reduced ? 0 : Math.cos(t * 0.5) * 0.05 * idleAmt;      // slow pitch sway

      if (kind === 'coin') {
        // No auto-spin (felt weird). Coin rests facing the viewer and is
        // steered by the mouse; a whisper of idle sway keeps it alive.
        obj.rotation.x = Math.PI / 2 + curX + driftX;
        obj.rotation.y = curY + driftY;
        obj.rotation.z = curX * 0.08;
        obj.position.y = bob;
        if (coinMats) {
          const breathe = 1.3 + (reduced ? 0 : Math.sin(t * 2) * 0.2);
          coinMats.forEach((m) => { m.emissiveIntensity = m.emissiveMap ? breathe : 0; });
        }
      } else {
        // Mat/sleeve rest at a natural 3/4 tilt (so they always read as a
        // dimensional object), and the mouse pushes the tilt from there. The
        // resting angles + idle bob make it feel like it's floating and alive.
        const baseYaw = -0.32;   // resting turn to the right
        const basePitch = 0.14;  // resting lean back
        obj.rotation.y = baseYaw + curY + driftY;
        obj.rotation.x = basePitch - curX + driftX;
        obj.rotation.z = (curY + driftY) * 0.05;
        obj.position.y = bob;
        // The resting yaw + perspective push the visual mass rightward; nudge
        // the object left so it reads centered in the canvas.
        obj.position.x = -0.28;
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
  return <div ref={hostRef} style={{ width: '100%', height: h, cursor: 'grab', display: 'flex', justifyContent: 'center' }} className="select-none" aria-hidden />;
}
