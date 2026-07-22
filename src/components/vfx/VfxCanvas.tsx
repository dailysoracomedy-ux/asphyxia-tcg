'use client';

import { useEffect, useRef } from 'react';
import { useAnimationStore, type VisualEvent } from '@/store/animationStore';
import { useVfxSettingsStore } from '@/store/vfxSettingsStore';
import { factionTheme } from '@/lib/theme';
import type { Faction } from '@/types/game';

/**
 * Commit 54 - the real particle layer. One fullscreen canvas over the board,
 * one pooled requestAnimationFrame loop, subscribed imperatively to the exact
 * same animationStore stream every CSS vfx already reads - zero new game-store
 * knowledge, zero React re-renders per frame.
 *
 * Effects:
 *  - CARD_HIT          radial impact burst at the target card, particle count
 *                      scaled by damage; plus a neon TRAIL streaking from the
 *                      most recent attacker (<=1.2s old ATTACK_DECLARED) to
 *                      the target - source and target correlated the same way
 *                      the AI ceremony gate correlates its pacing.
 *  - CARD_DESTROYED    faction-flavored dissolve at the slot:
 *                        Neon Underground  -> glitch squares (magenta/cyan jitter)
 *                        Dark White        -> ash & embers, slow updrift
 *                        Synth Ascendancy  -> voxel disintegration, grid-snapped
 *                      ...then a VOID-SUCK stream: the debris curves toward the
 *                      owner's deck stack, making Void Recycle visible for the
 *                      first time (destroyedGhost.ownerId names the seat).
 *  - O2_DAMAGE         ember burst off that player's StatsPanel, scaled by the
 *                      point loss (pairs with the giant popup + panel flash).
 *
 * Positioning: DOM anchors, not layout math - cards tag themselves with
 * data-vfx-anchor={instanceId} (still present during the destroy-ghost
 * window, which is exactly what makes destroy effects land on a slot that
 * game state already emptied), StatsPanel with data-vfx-o2, DeckVoidStack
 * with data-vfx-deck. getBoundingClientRect -> viewport coords -> this fixed
 * canvas, no transforms to fight.
 *
 * Budget: hard particle cap + devicePixelRatio clamped to 1.5 so integrated
 * GPUs never melt; 'low' quality drops the cap to ~1/3 and disables trails;
 * 'off' (or prefers-reduced-motion) never mounts the canvas at all. The rAF
 * loop self-suspends when the pool is empty - an idle board costs nothing.
 * In jsdom (mount-smoke tests) getContext('2d') returns null and the whole
 * component is inert by the same guard.
 */

interface Particle {
  x: number; y: number; vx: number; vy: number;
  ax: number; ay: number;
  life: number; maxLife: number;
  size: number; color: string;
  shape: 'square' | 'circle' | 'spark';
  // Void-suck: particles with a target point steer toward it, accelerating.
  tx?: number; ty?: number; suck?: number;
  gridSnap?: boolean;
  fade: number;
}

const DPR_CAP = 1.5;
const CAPS = { high: 420, low: 140 } as const;

function themeColor(faction?: string): string {
  try {
    return factionTheme((faction ?? 'Neon Underground') as Faction).primary;
  } catch {
    return '#e879f9';
  }
}

function anchorRect(sel: string): DOMRect | null {
  const el = document.querySelector(sel);
  return el ? el.getBoundingClientRect() : null;
}

export default function VfxCanvas() {
  const quality = useVfxSettingsStore((s) => s.quality);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const reducedMotion =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  const enabled = quality !== 'off' && !reducedMotion;

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // jsdom logs a console.error INSIDE getContext() (even when returning
    // null), which the mount-smoke test rightly counts as noise - so in jsdom
    // we never call it at all. Real browsers never carry 'jsdom' in the UA.
    if (typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return; // no-2d environments: fully inert

    const cap = CAPS[quality === 'low' ? 'low' : 'high'];
    const trailsOn = quality === 'high';
    let dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const pool: Particle[] = [];
    let raf = 0;
    let running = false;
    let last = 0;

    function resize() {
      if (!canvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    }
    resize();
    window.addEventListener('resize', resize);

    function spawn(p: Particle) {
      if (pool.length >= cap) pool.shift(); // oldest dies first, never over budget
      pool.push(p);
      if (!running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    }

    function burst(cx: number, cy: number, n: number, color: string, opts?: Partial<Particle> & { speed?: number; spread?: number }) {
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = (opts?.speed ?? 220) * (0.35 + Math.random() * 0.85);
        spawn({
          x: cx + (Math.random() - 0.5) * (opts?.spread ?? 14),
          y: cy + (Math.random() - 0.5) * (opts?.spread ?? 14),
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          ax: 0, ay: opts?.ay ?? 340,
          life: 0,
          maxLife: 0.45 + Math.random() * 0.5,
          size: (opts?.size ?? 3) * (0.6 + Math.random() * 0.9),
          color,
          shape: opts?.shape ?? 'spark',
          fade: 1,
          ...(opts?.tx !== undefined ? { tx: opts.tx, ty: opts.ty, suck: opts.suck } : {}),
          ...(opts?.gridSnap ? { gridSnap: true } : {}),
        });
      }
    }

    /** Particles staggered along a slight arc from (x1,y1) to (x2,y2). */
    function trail(x1: number, y1: number, x2: number, y2: number, color: string) {
      if (!trailsOn) return;
      const n = 26;
      const mx = (x1 + x2) / 2 + (y1 - y2) * 0.18; // control point off the line
      const my = (y1 + y2) / 2 + (x2 - x1) * 0.18;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const it = 1 - t;
        const px = it * it * x1 + 2 * it * t * mx + t * t * x2;
        const py = it * it * y1 + 2 * it * t * my + t * t * y2;
        spawn({
          x: px, y: py,
          vx: (Math.random() - 0.5) * 40,
          vy: (Math.random() - 0.5) * 40,
          ax: 0, ay: 0,
          life: -t * 0.16, // stagger: head of the streak lights first
          maxLife: 0.3 + Math.random() * 0.18,
          size: 2.4 + Math.random() * 2.2,
          color,
          shape: 'circle',
          fade: 1,
        });
      }
    }

    function destroyEffect(rect: DOMRect, faction: string | undefined, deckRect: DOMRect | null) {
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const color = themeColor(faction);
      const suckOpts = deckRect
        ? { tx: deckRect.left + deckRect.width / 2, ty: deckRect.top + deckRect.height / 2, suck: 1400 }
        : {};
      if (faction === 'Dark White') {
        // Ash & embers - pale flecks drifting up, embers falling, all curving home to the deck
        burst(cx, cy, 34, '#e7e5e4', { speed: 90, ay: -70, shape: 'circle', size: 2.2, spread: rect.width * 0.55, ...suckOpts });
        burst(cx, cy, 14, color, { speed: 140, ay: 160, shape: 'spark', size: 2.6, spread: rect.width * 0.4, ...suckOpts });
      } else if (faction === 'Synth Ascendancy') {
        // Voxel disintegration - grid-snapped squares, orderly collapse
        burst(cx, cy, 40, color, { speed: 110, ay: 220, shape: 'square', size: 5, spread: rect.width * 0.7, gridSnap: true, ...suckOpts });
      } else {
        // Neon Underground (and fallback) - glitch squares, two-tone jitter
        burst(cx, cy, 24, color, { speed: 260, ay: 0, shape: 'square', size: 4.4, spread: rect.width * 0.6, ...suckOpts });
        burst(cx, cy, 24, '#22d3ee', { speed: 260, ay: 0, shape: 'square', size: 3.4, spread: rect.width * 0.6, ...suckOpts });
      }
    }

    // ---- event intake: imperative subscribe, diff by id -------------------
    const seen = new Set<string>(useAnimationStore.getState().events.map((e) => e.id));
    let recentAttack: { instanceId: string; at: number } | null = null;

    function handle(e: VisualEvent) {
      if (e.type === 'ATTACK_DECLARED' && e.apexInstanceId) {
        recentAttack = { instanceId: e.apexInstanceId, at: performance.now() };
        return;
      }
      if (e.type === 'CARD_HIT' && e.apexInstanceId) {
        const rect = anchorRect(`[data-vfx-anchor="${e.apexInstanceId}"]`);
        if (!rect) return;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dmg = Math.abs(parseInt(e.label ?? '', 10)) || 200;
        const n = Math.min(10 + Math.round(dmg / 28), 46);
        burst(cx, cy, n, themeColor(e.faction), { speed: 200 + Math.min(dmg / 3, 260) });
        burst(cx, cy, Math.round(n / 3), '#ffffff', { speed: 140, size: 2 });
        if (recentAttack && performance.now() - recentAttack.at < 1200) {
          const src = anchorRect(`[data-vfx-anchor="${recentAttack.instanceId}"]`);
          if (src) trail(src.left + src.width / 2, src.top + src.height / 2, cx, cy, themeColor(e.faction));
        }
        return;
      }
      if (e.type === 'CARD_DESTROYED' && e.apexInstanceId) {
        const rect = anchorRect(`[data-vfx-anchor="${e.apexInstanceId}"]`);
        if (!rect) return;
        const ownerId = e.destroyedGhost?.ownerId;
        const deckRect = ownerId ? anchorRect(`[data-vfx-deck="${ownerId}"]`) : null;
        destroyEffect(rect, e.faction, deckRect);
        return;
      }
      if (e.type === 'O2_DAMAGE' && e.playerId) {
        const rect = anchorRect(`[data-vfx-o2="${e.playerId}"]`);
        if (!rect) return;
        const cx = rect.left + rect.width / 4; // O2 half of the panel
        const cy = rect.top + rect.height / 2;
        const pts = Math.abs(parseInt(e.label ?? '', 10)) || 1;
        burst(cx, cy, Math.min(14 + pts * 16, 60), '#fb923c', { speed: 190 + pts * 40, ay: 300 });
        burst(cx, cy, 8, '#ef4444', { speed: 120, size: 2.4 });
        return;
      }
    }

    const unsub = useAnimationStore.subscribe((s) => {
      for (const e of s.events) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        handle(e);
      }
      // seen only grows while events churn; prune against the live list
      if (seen.size > 200) {
        const live = new Set(s.events.map((e) => e.id));
        for (const id of seen) if (!live.has(id)) seen.delete(id);
      }
    });

    // ---- render loop ------------------------------------------------------
    function tick(now: number) {
      if (!ctx || !canvas) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = pool.length - 1; i >= 0; i--) {
        const p = pool[i];
        p.life += dt;
        if (p.life < 0) continue; // staggered trail particles not yet born
        if (p.life >= p.maxLife) { pool.splice(i, 1); continue; }
        if (p.tx !== undefined && p.ty !== undefined && p.suck) {
          // steer toward the deck, ramping in over the particle's life
          const w = Math.min(p.life / p.maxLife * 1.6, 1);
          const dx = p.tx - p.x, dy = p.ty - p.y;
          const d = Math.max(Math.hypot(dx, dy), 1);
          p.vx += (dx / d) * p.suck * w * dt;
          p.vy += (dy / d) * p.suck * w * dt;
          // arrived: collapse into the deck
          if (d < 16) { pool.splice(i, 1); continue; }
        } else {
          p.vx += p.ax * dt;
          p.vy += p.ay * dt;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const t = p.life / p.maxLife;
        const alpha = Math.max(0, 1 - t) * p.fade;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        const dx = p.gridSnap ? Math.round(p.x / 6) * 6 : p.x;
        const dy = p.gridSnap ? Math.round(p.y / 6) * 6 : p.y;
        if (p.shape === 'square') {
          ctx.fillRect(dx - p.size / 2, dy - p.size / 2, p.size, p.size);
        } else if (p.shape === 'spark') {
          // motion-stretched spark
          const len = Math.min(Math.hypot(p.vx, p.vy) * 0.03, 9);
          const ang = Math.atan2(p.vy, p.vx);
          ctx.save();
          ctx.translate(dx, dy);
          ctx.rotate(ang);
          ctx.fillRect(-len, -p.size / 2, len * 2, p.size);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(dx, dy, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (pool.length > 0) {
        raf = requestAnimationFrame(tick);
      } else {
        running = false;
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      }
    }

    return () => {
      unsub();
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(raf);
    };
  }, [enabled, quality]);

  if (!enabled) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-0 pointer-events-none z-[26]"
      style={{ width: '100vw', height: '100vh' }}
    />
  );
}
