'use client';

/**
 * Commit 55.3 - shape and material overhaul, from Daily's real-pack
 * reference photos:
 *
 *  1. GEOMETRY: the old depth function was sin(u)*sin(v) across the WHOLE
 *     face - a dome, maximum at dead-center, fading the entire way to every
 *     edge. That's a pillow/lens shape, which is why it read as "fat."
 *     Real packs (per the references) are flat slabs: constant depth
 *     through the middle, with curvature only in a narrow band right at
 *     the edges (a bevel on left/right, a pinch-to-neck on top/bottom where
 *     the foil tapers into the crimped seal). Replaced with a
 *     plateau-then-smoothstep-taper falloff (edgeFalloff below) instead of
 *     a bell curve - flat through the center, curved only near the
 *     boundary. Also stopped tapering the seam-facing edge of the body/
 *     strip meshes (taperVStart/taperVEnd) so the two halves meet at full,
 *     equal depth with zero visible step - one continuous flat slab.
 *  2. MATERIAL: swapped the lit PBR look (MeshStandardMaterial responding
 *     unevenly to the pink/green point lights depending on where the dome
 *     curved) for an emissive-DOMINANT material - color pushed dark so the
 *     lit term barely contributes, emissiveIntensity pushed way up so the
 *     texture itself provides the brightness, consistently, regardless of
 *     viewing angle or light position. Bloom strength/threshold both
 *     lowered to match - it's now a thin glow kissing the brightest pixels
 *     instead of doing the heavy lifting.
 *  3. The interior "mouth" (dark box revealing the torn opening) used to
 *     stay visible for the whole 6-card reveal, riding along as the pack
 *     drifted aside - that was the stray black bar Daily saw during flips.
 *     It now fades out over 0.5s shortly after the rip finishes.
 *
 * Everything else (rip mechanics, faction warp shaders, edge glow, one-by-
 * one reveal, procedural SFX, skip button) is unchanged from Commit 55.2.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SLEEVE_BASE_SRC } from '@/lib/cosmetics';

const COMMON_ART = [
  'dw-absolute-refusal', 'dw-blank-directive', 'dw-choke-protocol', 'dw-emergency-authority',
  'dw-gatekeeper-drone', 'dw-monomolecular-blade', 'dw-oxygen-siphon', 'dw-reserve-grid',
  'dw-sterile-mantle', 'dw-system-scan', 'dw-verdict-protocol',
  'nu-black-market-cell', 'nu-data-thief', 'nu-dead-battery', 'nu-feedback-loop',
  'nu-glitch-step', 'nu-juice-box', 'nu-no-gods', 'nu-overclock', 'nu-plasma-edge',
  'nu-smog-jacket', 'nu-spark-plug',
  'sa-ascension-complete', 'sa-backup-consciousness', 'sa-blank-core', 'sa-chrome-halo',
  'sa-compile-sequence', 'sa-drone-choir', 'sa-emergency-shell', 'sa-logic-bloom',
  'sa-logic-denial', 'sa-pattern-blade', 'sa-upgrade-path',
];
const APEX_ART = [
  'dw-enforcer-v4', 'dw-glass-warden', 'dw-overseer-prime', 'dw-pale-executioner',
  'nu-alley-wraith', 'nu-riot-runner', 'nu-static-jack', 'nu-street-beast',
  'sa-chrome-seraph', 'sa-halcyon-maw', 'sa-model-00-crown', 'sa-virex',
];

// Real 2in x 3in booster proportions.
const PACK_W = 2.0, PACK_H = 3.0, STRIP_H = 0.42;
// Flat-slab depth (constant through the middle) and the edge margins where
// it tapers to zero - see edgeFalloff. MARGIN_X is the side bevel, MARGIN_Y
// is how far the "neck" pinch reaches in from the true top/bottom.
const PACK_DEPTH = 0.13, MARGIN_X = 0.16, MARGIN_Y = 0.22;
const CARD_W = 1.5, CARD_H = 2.1;
const RIP_DRAG_FRACTION = 0.16;
const BLOOM = { strength: 0.22, radius: 0.42, threshold: 0.7 };
const EMISSIVE = { pack: 0.85, cardFace: 0.3 };
const CENTER_SCALE = 1.08;
const RECAP_SCALE = 0.62;
const WARP_SECONDS = 0.85;
const CORNER_R = 0.085;
// Commit 55.4 - the glow plane used to be the SAME SIZE as the card, so the
// ring had no room to render outward and was structurally clipped inside
// the card's own edge ("glow on the inside"). GLOW_MARGIN gives it a strip
// of extra plane to bloom into; GLOW_OUTSET centers the ring just outside
// the true edge instead of straddling it. width/skirt both cut down
// (Daily: "too intense/thick").
const EDGE_GLOW = { width: 0.01, outset: 0.014, marginW: 0.09, marginH: 0.07 };

type Faction = 'neon' | 'dw' | 'synth';
const factionOf = (key: string): Faction => (key.startsWith('nu-') ? 'neon' : key.startsWith('dw-') ? 'dw' : 'synth');
const FACTION_COLOR: Record<Faction, THREE.Color> = {
  neon: new THREE.Color('#ff2fa0'), dw: new THREE.Color('#9be8e0'), synth: new THREE.Color('#a78bfa'),
};
const GOLD = new THREE.Color('#ffc24d');

function pickPull(): string[] {
  const commons = [...COMMON_ART].sort(() => Math.random() - 0.5).slice(0, 5).map((n) => `/art/cards/${n}.webp`);
  const apex = APEX_ART[Math.floor(Math.random() * APEX_ART.length)];
  return [...commons, `/art/apex/${apex}.webp`];
}

// ---------------------------------------------------------------------------
// Procedural SFX - a tiny synth, not sample files.
// ---------------------------------------------------------------------------
function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function playRip(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.5);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(1100, t0);
  bp.frequency.exponentialRampToValueAtTime(3800, t0 + 0.38);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.55, t0 + 0.035);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.48);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(t0); src.stop(t0 + 0.5);
}
function playFlip(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.18);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 2400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
  src.connect(hp).connect(g).connect(ctx.destination);
  src.start(t0); src.stop(t0 + 0.2);
  const osc = ctx.createOscillator();
  osc.type = 'square'; osc.frequency.value = 950;
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.07, t0);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
  osc.connect(og).connect(ctx.destination);
  osc.start(t0); osc.stop(t0 + 0.05);
}
function playWarp(ctx: AudioContext, faction: Faction) {
  const t0 = ctx.currentTime;
  if (faction === 'neon') {
    for (let i = 0; i < 7; i++) {
      const delay = i * 0.055 + Math.random() * 0.02;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.05);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 6; bp.frequency.value = 700 + Math.random() * 3200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, t0 + delay);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.045);
      src.connect(bp).connect(g).connect(ctx.destination);
      src.start(t0 + delay); src.stop(t0 + delay + 0.06);
    }
  } else if (faction === 'dw') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.85);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.6;
    bp.frequency.setValueAtTime(380, t0);
    bp.frequency.exponentialRampToValueAtTime(5200, t0 + 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.24, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(t0); src.stop(t0 + 0.9);
  } else {
    [220, 330, 440, 660, 880, 1320].forEach((f, i) => {
      const delay = i * 0.08;
      const osc = ctx.createOscillator();
      osc.type = 'square'; osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + delay);
      g.gain.exponentialRampToValueAtTime(0.13, t0 + delay + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.09);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + delay); osc.stop(t0 + delay + 0.1);
    });
  }
}

const WARP_VERT = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const WARP_FRAG = `
uniform sampler2D map;
uniform float progress;
uniform float modeF;
uniform float time;
uniform float aspect;
uniform float cornerUv;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float cardSd(vec2 uvIn, float asp, float r) {
  vec2 q = (uvIn - 0.5) * vec2(asp, 1.0);
  vec2 b = vec2(0.5 * asp, 0.5) - r;
  vec2 d2 = abs(q) - b;
  return length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0) - r;
}
void main() {
  if (cardSd(vUv, aspect, cornerUv) > 0.0) discard;
  vec2 uv = vUv;
  float p = clamp(progress, 0.0, 1.0);
  vec4 col;
  if (modeF < 0.5) {
    float band = floor(uv.y * 24.0);
    float shear = (hash(vec2(band, floor(time * 18.0))) - 0.5) * 2.0;
    uv.x += shear * p * p * 0.9;
    float split = 0.02 + 0.1 * p;
    float r = texture2D(map, uv + vec2(split, 0.0)).r;
    float g = texture2D(map, uv).g;
    float b = texture2D(map, uv - vec2(split, 0.0)).b;
    col = vec4(r, g, b, 1.0);
    float block = hash(vec2(floor(uv.x * 10.0), band));
    if (block < p * 1.25 - 0.1) discard;
    if (uv.x < 0.0 || uv.x > 1.0) discard;
    col.rgb += vec3(1.0, 0.18, 0.63) * p * 0.6 * step(0.92, hash(vec2(band, floor(time * 24.0))));
    col.a = 1.0 - smoothstep(0.75, 1.0, p);
  } else if (modeF < 1.5) {
    float n = vnoise(uv * 3.2) * 0.62 + vnoise(uv * 11.0) * 0.28 + vnoise(uv * 31.0) * 0.10;
    n = clamp((n - 0.5) * 2.3 + 0.5, 0.0, 1.0);
    float th = p * 1.15;
    if (n < th) discard;
    col = texture2D(map, uv);
    float edge = smoothstep(th, th + 0.09, n);
    col.rgb = mix(vec3(1.0, 0.97, 0.9) * 1.6, col.rgb, edge);
    col.a = 1.0;
  } else {
    float q = mix(256.0, 9.0, p);
    vec2 quv = floor(uv * q) / q;
    float band = floor(uv.y * 18.0);
    float lift = hash(vec2(band, 7.0)) * p * p * 1.4;
    quv.y -= lift;
    if (quv.y < 0.0) discard;
    col = texture2D(map, quv);
    col.rgb = mix(col.rgb, col.rgb * vec3(0.8, 0.7, 1.35) + vec3(0.12, 0.05, 0.3), p * 0.8);
    float scan = step(0.5, fract(uv.y * q * 0.5)) * 0.15 * p;
    col.rgb += vec3(0.4, 0.3, 1.0) * scan;
    col.a = 1.0 - smoothstep(0.7, 1.0, p + hash(vec2(band, 3.0)) * 0.2 * p);
  }
  if (col.a < 0.02) discard;
  gl_FragColor = col;
}`;

const GLOW_VERT = `varying vec2 vPos;
void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const GLOW_FRAG = `
uniform vec3 color;
uniform float intensity;
uniform float width;
uniform float outset;
uniform vec2 cardHalf;
uniform float corner;
varying vec2 vPos;
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  // d in the SAME world units as the card itself: d<0 inside, d>0 outside.
  float d = sdRoundRect(vPos, cardHalf, corner);
  // ring centered OUTSIDE the true edge (at d=outset), never straddling it
  float core = 1.0 - smoothstep(0.0, width, abs(d - outset));
  // hard-kill anything still meaningfully inside the card - this is the
  // actual fix for "glow on the inside": no amount of the ring's math can
  // paint over the art once this mask is in the mix.
  float insideMask = smoothstep(-0.004, 0.006, d);
  float a = core * insideMask * intensity;
  if (a < 0.015) discard;
  gl_FragColor = vec4(color, a);
}`;

function makeWarpMat(tex: THREE.Texture, mode: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex }, progress: { value: 0 }, modeF: { value: mode }, time: { value: 0 },
      aspect: { value: CARD_W / CARD_H }, cornerUv: { value: CORNER_R / CARD_H },
    },
    vertexShader: WARP_VERT, fragmentShader: WARP_FRAG, transparent: true, side: THREE.DoubleSide,
  });
}
function makeGlowMat(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: color.clone() }, intensity: { value: 0 },
      width: { value: EDGE_GLOW.width }, outset: { value: EDGE_GLOW.outset },
      cardHalf: { value: new THREE.Vector2(CARD_W / 2, CARD_H / 2) }, corner: { value: CORNER_R },
    },
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** Smoothstep, clamped. */
function smooth01(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}
/** Plateau-then-taper falloff along one axis: 1.0 through the middle,
 *  smoothstepping down to 0 only within `margin` of whichever end(s) are
 *  flagged to taper. This is the flat-slab-with-edge-bevel shape, replacing
 *  the old bell-curve dome. */
function edgeFalloff(t: number, taper0: boolean, taper1: boolean, margin: number): number {
  let f = 1;
  if (taper0 && t < margin) f = Math.min(f, smooth01(t / margin));
  if (taper1 && t > 1 - margin) f = Math.min(f, smooth01((1 - t) / margin));
  return f;
}

interface PillowOpts {
  jag?: number[];
  jagEdge?: 'top' | 'bottom';
  /** Whether the v=0 (bottom) and v=1 (top) edges of THIS mesh taper to
   *  zero depth. The body's top edge and the strip's bottom edge are the
   *  invisible pre-rip SEAM between them - those stay false so both meshes
   *  meet at full, equal depth with no visible step. Only the true outer
   *  top/bottom (next to the crimps) taper, giving the neck-pinch look. */
  taperVStart?: boolean;
  taperVEnd?: boolean;
}
function pillowGeometry(w: number, h: number, depth: number, sign: 1 | -1, opts: PillowOpts = {}) {
  const { jag, jagEdge, taperVStart = true, taperVEnd = true } = opts;
  const geo = new THREE.PlaneGeometry(w, h, 40, 48);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const u = x / w + 0.5, v = y / h + 0.5;
    let py = y;
    if (jag && jagEdge === 'top' && v > 0.985) py = y + jag[Math.min(jag.length - 1, Math.floor(u * (jag.length - 1)))];
    if (jag && jagEdge === 'bottom' && v < 0.015) py = y + jag[Math.min(jag.length - 1, Math.floor(u * (jag.length - 1)))];
    const fx = edgeFalloff(u, true, true, MARGIN_X);
    const fy = edgeFalloff(v, taperVStart, taperVEnd, MARGIN_Y);
    pos.setXYZ(i, x, py, sign * depth * fx * fy);
  }
  geo.computeVertexNormals();
  return geo;
}

type Phase = 'idle' | 'ripping' | 'revealing' | 'done';
type Sub = '' | 'rising' | 'back' | 'flipping' | 'face' | 'warping';

export default function PackOpening3D({ onComplete }: { onComplete: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [sub, setSub] = useState<Sub>('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;

    let audioCtx: AudioContext | null = null;
    function ensureAudio(): AudioContext | null {
      if (!audioCtx) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        audioCtx = Ctx ? new Ctx() : null;
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    camera.position.set(0, 0.15, 7.2);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    host.appendChild(renderer.domElement);
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), BLOOM.strength, BLOOM.radius, BLOOM.threshold));
    composer.addPass(new OutputPass());
    function size() {
      const w = host!.clientWidth, h = host!.clientHeight;
      renderer.setSize(w, h); composer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    size();
    const ro = new ResizeObserver(size);
    ro.observe(host);

    scene.add(new THREE.AmbientLight(0x8888aa, 0.55));
    const pink = new THREE.PointLight(0xff2fa0, 55, 30); pink.position.set(-4, 2.5, 4); scene.add(pink);
    const green = new THREE.PointLight(0x53ff2f, 26, 30); green.position.set(4.2, -1.5, 3.2); scene.add(green);
    const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(1.5, 3, 5); scene.add(key);

    const loader = new THREE.TextureLoader();
    const srgb = (t: THREE.Texture) => { t.colorSpace = THREE.SRGBColorSpace; return t; };
    const texFront = srgb(loader.load('/images/pack-front.webp'));
    const texBack = srgb(loader.load('/images/pack-back.webp'));
    const texSleeve = srgb(loader.load(SLEEVE_BASE_SRC));

    function crimpTexture() {
      const c = document.createElement('canvas'); c.width = 256; c.height = 32;
      const g = c.getContext('2d')!;
      for (let x = 0; x < 256; x++) {
        const v = 118 + Math.round(70 * Math.sin((x / 256) * Math.PI * 56));
        g.fillStyle = `rgb(${v},${v},${v + 6})`; g.fillRect(x, 0, 1, 32);
      }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
    }
    function roundedAlphaTex() {
      const W = 512, H = Math.round(512 * (CARD_H / CARD_W));
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d')!;
      const r = (CORNER_R / CARD_W) * W;
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.beginPath(); g.roundRect(0, 0, W, H, r); g.fill();
      return new THREE.CanvasTexture(c);
    }
    const cardAlpha = roundedAlphaTex();
    // Commit 55.3 - emissive-DOMINANT foil material: dark base color so the
    // lit PBR term barely registers, high emissiveIntensity so the texture
    // itself carries the brightness consistently regardless of viewing
    // angle or light position.
    const foilMat = (map: THREE.Texture) => new THREE.MeshStandardMaterial({
      map, color: 0x3a3a44, metalness: 0.12, roughness: 0.55,
      emissive: 0xffffff, emissiveMap: map, emissiveIntensity: EMISSIVE.pack,
    });
    const crimpMat = new THREE.MeshStandardMaterial({ map: crimpTexture(), metalness: 0.75, roughness: 0.35, color: 0x9a9aa6 });

    const JAG_N = 33;
    const jag = Array.from({ length: JAG_N }, (_, i) => (i % 2 ? 0.05 : -0.05) * (0.6 + Math.random() * 0.8));
    const pack = new THREE.Group();
    scene.add(pack);
    const bodyH = PACK_H - STRIP_H;

    const body = new THREE.Group();
    const bodyFrontTex = texFront.clone(); bodyFrontTex.needsUpdate = true; bodyFrontTex.repeat.set(1, bodyH / PACK_H);
    const bodyBackTex = texBack.clone(); bodyBackTex.needsUpdate = true; bodyBackTex.repeat.set(1, bodyH / PACK_H);
    const bodyFrontMesh = new THREE.Mesh(pillowGeometry(PACK_W, bodyH, PACK_DEPTH, 1, { taperVStart: true, taperVEnd: false }), foilMat(bodyFrontTex));
    const bodyBackMesh = new THREE.Mesh(pillowGeometry(PACK_W, bodyH, PACK_DEPTH, -1, { taperVStart: true, taperVEnd: false }), foilMat(bodyBackTex));
    bodyBackMesh.rotation.y = Math.PI;
    body.add(bodyFrontMesh, bodyBackMesh);
    const botCrimp = new THREE.Mesh(new THREE.BoxGeometry(PACK_W * 1.02, 0.2, PACK_DEPTH * 0.85), crimpMat);
    botCrimp.position.y = -bodyH / 2 - 0.08; body.add(botCrimp);
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(PACK_W * 0.86, 0.26, PACK_DEPTH * 1.3),
      new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.95, transparent: true, opacity: 1 })
    );
    mouth.position.y = bodyH / 2 - 0.16; mouth.visible = false; body.add(mouth);
    body.position.y = -STRIP_H / 2;
    pack.add(body);

    const strip = new THREE.Group();
    const stripFrontTex = texFront.clone(); stripFrontTex.needsUpdate = true;
    stripFrontTex.repeat.set(1, STRIP_H / PACK_H); stripFrontTex.offset.set(0, 1 - STRIP_H / PACK_H);
    const stripBackTex = texBack.clone(); stripBackTex.needsUpdate = true;
    stripBackTex.repeat.set(1, STRIP_H / PACK_H); stripBackTex.offset.set(0, 1 - STRIP_H / PACK_H);
    const stripFrontMesh = new THREE.Mesh(pillowGeometry(PACK_W, STRIP_H, PACK_DEPTH, 1, { taperVStart: false, taperVEnd: true }), foilMat(stripFrontTex));
    const stripBackMesh = new THREE.Mesh(pillowGeometry(PACK_W, STRIP_H, PACK_DEPTH, -1, { taperVStart: false, taperVEnd: true }), foilMat(stripBackTex));
    stripBackMesh.rotation.y = Math.PI;
    const topCrimp = new THREE.Mesh(new THREE.BoxGeometry(PACK_W * 1.02, 0.2, PACK_DEPTH * 0.85), crimpMat);
    topCrimp.position.y = STRIP_H / 2 + 0.08;
    strip.add(stripFrontMesh, stripBackMesh, topCrimp);
    const stripHomeY = bodyH / 2;
    strip.position.y = stripHomeY;
    pack.add(strip);

    let tornApplied = false;
    function applyTornGeometry() {
      if (tornApplied) return;
      tornApplied = true;
      const oldBF = bodyFrontMesh.geometry, oldBB = bodyBackMesh.geometry;
      const oldSF = stripFrontMesh.geometry, oldSB = stripBackMesh.geometry;
      bodyFrontMesh.geometry = pillowGeometry(PACK_W, bodyH, PACK_DEPTH, 1, { taperVStart: true, taperVEnd: false, jag, jagEdge: 'top' });
      bodyBackMesh.geometry = pillowGeometry(PACK_W, bodyH, PACK_DEPTH, -1, { taperVStart: true, taperVEnd: false, jag, jagEdge: 'top' });
      stripFrontMesh.geometry = pillowGeometry(PACK_W, STRIP_H, PACK_DEPTH, 1, { taperVStart: false, taperVEnd: true, jag, jagEdge: 'bottom' });
      stripBackMesh.geometry = pillowGeometry(PACK_W, STRIP_H, PACK_DEPTH, -1, { taperVStart: false, taperVEnd: true, jag, jagEdge: 'bottom' });
      oldBF.dispose(); oldBB.dispose(); oldSF.dispose(); oldSB.dispose();
    }

    const blobC = document.createElement('canvas'); blobC.width = blobC.height = 128;
    const bg2 = blobC.getContext('2d')!;
    const grad = bg2.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    bg2.fillStyle = grad; bg2.fillRect(0, 0, 128, 128);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blobC), transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = -2.4;
    scene.add(blob);

    interface CardEntry {
      group: THREE.Group; front: THREE.Mesh; back: THREE.Mesh;
      warpMat: THREE.ShaderMaterial; stdMat: THREE.MeshStandardMaterial; glowMat: THREE.ShaderMaterial; faction: Faction;
    }
    const pull = pickPull();
    const cards: CardEntry[] = [];
    pull.forEach((src, i) => {
      const g = new THREE.Group();
      const faceTex = srgb(loader.load(src));
      const faction = factionOf(src.split('/').pop()!.replace('.webp', ''));
      const stdMat = new THREE.MeshStandardMaterial({ map: faceTex, metalness: 0.15, roughness: 0.5, emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: EMISSIVE.cardFace, alphaMap: cardAlpha, transparent: true, alphaTest: 0.5 });
      const warpMat = makeWarpMat(faceTex, faction === 'neon' ? 0 : faction === 'dw' ? 1 : 2);
      const front = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), stdMat);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), new THREE.MeshStandardMaterial({ map: texSleeve, metalness: 0.2, roughness: 0.55, emissive: 0xffffff, emissiveMap: texSleeve, emissiveIntensity: 0.14, alphaMap: cardAlpha, transparent: true, alphaTest: 0.5 }));
      back.rotation.y = Math.PI;
      const glowMat = makeGlowMat(i === 5 ? GOLD : FACTION_COLOR[faction]);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W + EDGE_GLOW.marginW, CARD_H + EDGE_GLOW.marginH), glowMat);
      glow.position.z = 0.005;
      g.add(front, back, glow);
      g.position.set(0, -0.4, 0);
      g.rotation.y = Math.PI;
      g.scale.setScalar(0.72);
      g.visible = false;
      scene.add(g);
      cards.push({ group: g, front, back, warpMat, stdMat, glowMat, faction });
    });

    const scraps: { m: THREE.Mesh; v: THREE.Vector3; r: THREE.Vector3 }[] = [];
    function spawnScraps() {
      for (let i = 0; i < 16; i++) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.07 + Math.random() * 0.1, 0.05 + Math.random() * 0.08), new THREE.MeshStandardMaterial({ color: 0xc9c9d4, metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }));
        s.position.set((Math.random() - 0.5) * PACK_W, strip.position.y + (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.4);
        scene.add(s);
        scraps.push({ m: s, v: new THREE.Vector3((Math.random() - 0.5) * 2.4, 1 + Math.random() * 2, (Math.random() - 0.5) * 1.5), r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6) });
      }
    }

    let curPhase: Phase = 'idle', curSub: Sub = '';
    let idx = -1, subT = 0, ripT = -1, packT = 0;
    let mouthFadeT = -1;
    const pointer = { x: 0, y: 0 };
    let t0 = performance.now();

    function startCard(i: number) {
      idx = i; curSub = 'rising'; setSub('rising'); subT = 0;
      const c = cards[i];
      c.group.visible = true;
      c.group.position.set(0, -0.4, 0.2);
      c.group.rotation.y = Math.PI;
      c.group.scale.setScalar(0.72);
      c.front.material = c.stdMat;
      c.warpMat.uniforms.progress.value = 0;
      c.glowMat.uniforms.intensity.value = 0;
    }
    function rip() {
      if (curPhase !== 'idle') return;
      curPhase = 'ripping'; setPhase('ripping');
      ripT = 0;
      applyTornGeometry();
      const ac = ensureAudio();
      if (ac) playRip(ac);
      spawnScraps();
    }
    function advance() {
      if (curPhase !== 'revealing') return;
      const ac = ensureAudio();
      if (curSub === 'back') {
        curSub = 'flipping'; setSub('flipping'); subT = 0;
        if (ac) playFlip(ac);
      } else if (curSub === 'face') {
        curSub = 'warping'; setSub('warping'); subT = 0;
        const c = cards[idx];
        c.front.material = c.warpMat;
        c.back.visible = false;
        if (ac) playWarp(ac, c.faction);
      }
    }
    function skip() {
      onComplete();
    }

    let dragStart: { x: number } | null = null;
    function onDown(e: PointerEvent) { if (curPhase === 'idle' && e.clientY / host!.clientHeight < 0.42) dragStart = { x: e.clientX }; }
    function onMove(e: PointerEvent) {
      const rect = host!.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      if (dragStart && Math.abs(e.clientX - dragStart.x) > rect.width * RIP_DRAG_FRACTION) { dragStart = null; rip(); }
    }
    function onUp() { dragStart = null; }
    function onClick() { advance(); }
    function onKey(e: KeyboardEvent) { if (e.key === 'r' || e.key === 'R') rip(); if (e.key === ' ' || e.key === 'Enter') advance(); if (e.key === 'Escape') skip(); }
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('click', onClick);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);

    const ease = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);
    let raf = 0, disposed = false;

    function tick(now: number) {
      if (disposed) return;
      const dt = Math.min((now - t0) / 1000, 0.05);
      t0 = now;
      const time = now / 1000;

      if (curPhase === 'idle') {
        pack.position.y = Math.sin(time * 1.3) * 0.07;
        pack.rotation.y = pointer.x * 0.28 + Math.sin(time * 0.7) * 0.05;
        pack.rotation.x = pointer.y * 0.12;
      }
      if (ripT >= 0 && curPhase === 'ripping') {
        ripT += dt;
        const k = ease(ripT / 0.7);
        strip.position.x = k * 3.4;
        strip.position.y += dt * 1.6 * k;
        strip.rotation.z = -k * 1.1;
        strip.rotation.y = k * 2.2;
        if (ripT > 0.75) strip.visible = false;
        pack.rotation.z = Math.sin(Math.min(ripT, 0.5) * Math.PI * 2) * 0.06 * (1 - Math.min(ripT / 0.6, 1));
        if (ripT > 0.55) {
          curPhase = 'revealing'; setPhase('revealing');
          mouth.visible = true;
          mouthFadeT = 0;
          startCard(0);
        }
      }
      if (mouthFadeT >= 0) {
        mouthFadeT += dt;
        const FADE_DELAY = 0.6, FADE_DUR = 0.5;
        const k = Math.min(Math.max((mouthFadeT - FADE_DELAY) / FADE_DUR, 0), 1);
        (mouth.material as THREE.MeshStandardMaterial).opacity = 1 - k;
        if (k >= 1) { mouth.visible = false; mouthFadeT = -1; }
      }
      if (curPhase === 'revealing' || curPhase === 'done') {
        packT += dt;
        const settle = ease(packT / 2.2);
        pack.rotation.x = -0.35 * settle;
        pack.position.x = -2.6 * settle;
        pack.position.y = -0.6 * settle;
        pack.position.z = -1.2 * settle;
      }
      if (curPhase === 'revealing' && idx >= 0) {
        subT += dt;
        const c = cards[idx];
        const g = c.group;
        if (curSub === 'rising') {
          const rise = ease(subT / 0.5);
          const travel = ease((subT - 0.25) / 0.55);
          const sy = -0.4 + rise * 1.5;
          g.position.set(0, sy + (0.15 - sy) * travel, 0.2 + 2.2 * travel);
          g.scale.setScalar(0.72 + (CENTER_SCALE - 0.72) * travel);
          g.rotation.y = Math.PI;
          if (subT > 0.85) { curSub = 'back'; setSub('back'); }
        } else if (curSub === 'flipping') {
          const f = ease(subT / 0.45);
          g.rotation.y = Math.PI * (1 - f);
          c.glowMat.uniforms.intensity.value = f * (idx === 5 ? 1.0 : 0.55);
          if (subT > 0.5) { curSub = 'face'; setSub('face'); }
        } else if (curSub === 'face') {
          g.rotation.y = 0;
          const breathe = idx === 5 ? 1.0 + 0.25 * Math.sin(time * 5) : 0.55 + 0.12 * Math.sin(time * 3);
          c.glowMat.uniforms.intensity.value = breathe;
          g.position.y = 0.15 + Math.sin(time * 1.6) * 0.03;
        } else if (curSub === 'warping') {
          const p = Math.min(subT / WARP_SECONDS, 1);
          c.warpMat.uniforms.progress.value = p;
          c.warpMat.uniforms.time.value = time;
          c.glowMat.uniforms.intensity.value = Math.max(0, 1 - p * 1.6);
          if (c.faction === 'synth') g.position.y = 0.15 + p * p * 0.5;
          if (p >= 1) {
            g.visible = false;
            if (idx >= 5) {
              curPhase = 'done'; setPhase('done'); setDone(true);
              cards.forEach((cc, i) => {
                cc.front.material = cc.stdMat;
                cc.back.visible = true;
                cc.group.visible = true;
                cc.group.rotation.y = 0;
                const col = i % 3, row = Math.floor(i / 3);
                cc.group.position.set((col - 1) * (CARD_W * RECAP_SCALE + 0.35), 0.7 - row * (CARD_H * RECAP_SCALE + 0.35), 1.4);
                cc.group.scale.setScalar(RECAP_SCALE);
                cc.glowMat.uniforms.intensity.value = i === 5 ? 0.8 : 0.4;
              });
            } else {
              startCard(idx + 1);
            }
          }
        }
      }
      if (curPhase === 'done') {
        cards.forEach((cc, i) => { cc.glowMat.uniforms.intensity.value = (i === 5 ? 0.7 : 0.35) + 0.15 * Math.sin(time * 3 + i); });
      }
      for (const sc of scraps) {
        sc.v.y -= 3.2 * dt;
        sc.m.position.addScaledVector(sc.v, dt);
        sc.m.rotation.x += sc.r.x * dt;
        sc.m.rotation.y += sc.r.y * dt;
      }
      blob.material.opacity = curPhase === 'idle' ? 0.9 - Math.sin(time * 1.3) * 0.15 : Math.max(0, 0.9 - packT * 0.5);
      composer.render();
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('click', onClick);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      renderer.dispose();
      host.removeChild(renderer.domElement);
      if (audioCtx) audioCtx.close();
    };
  }, [onComplete]);

  return (
    <div className="fixed inset-0 bg-[#07070c] z-[90] overflow-hidden font-mono">
      <div ref={hostRef} className="absolute inset-0" />

      <button
        type="button"
        onClick={onComplete}
        aria-label="Skip and return to ladder"
        className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full border border-white/20 bg-black/50 text-white/60 hover:text-white hover:border-white/50 hover:bg-black/70 transition-colors flex items-center justify-center text-lg"
      >
        ✕
      </button>

      {phase === 'idle' && (
        <div className="absolute bottom-10 inset-x-0 text-center text-white/60 text-sm animate-pulse pointer-events-none select-none">
          drag across the top to rip it open — or press R
        </div>
      )}
      {phase === 'revealing' && sub === 'back' && (
        <div className="absolute bottom-10 inset-x-0 text-center text-white/60 text-sm pointer-events-none select-none">click to flip</div>
      )}
      {phase === 'revealing' && sub === 'face' && (
        <div className="absolute bottom-10 inset-x-0 text-center text-white/60 text-sm pointer-events-none select-none">click to release</div>
      )}
      {done && (
        <div className="absolute bottom-10 inset-x-0 flex justify-center">
          <button
            type="button"
            onClick={onComplete}
            className="px-6 py-2.5 rounded border border-fuchsia-400/60 text-fuchsia-200 text-sm tracking-widest uppercase hover:bg-fuchsia-400/10"
          >
            Claim Pack
          </button>
        </div>
      )}
    </div>
  );
}
