import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Commit 54 - graphics quality for the new VfxCanvas particle layer.
 * Persisted to localStorage exactly like audioStore (persist middleware no-ops
 * safely in Node, so /scripts simulations are unaffected).
 *
 * 'high'  - full particle budget (default; still capped + DPR-clamped so
 *           integrated GPUs survive - see VfxCanvas).
 * 'low'   - roughly a third of the particle budget, no trails.
 * 'off'   - the canvas never mounts. CSS-keyframe vfx (Commits 23-46) are
 *           untouched by this setting - they're cheap and carry the core
 *           game-readability signals, so they stay on in all three modes.
 *
 * prefers-reduced-motion is honored at the CONSUMER (VfxCanvas checks it and
 * treats it as 'off') rather than baked into stored state, so a user turning
 * reduced-motion off at the OS level gets their chosen quality back without
 * us having silently overwritten their setting.
 */
export type VfxQuality = 'high' | 'low' | 'off';

interface VfxSettingsState {
  quality: VfxQuality;
  setQuality: (q: VfxQuality) => void;
}

export const useVfxSettingsStore = create<VfxSettingsState>()(
  persist(
    (set) => ({
      quality: 'high',
      setQuality: (q) => set({ quality: q }),
    }),
    { name: 'asphyxia-vfx-settings' }
  )
);
