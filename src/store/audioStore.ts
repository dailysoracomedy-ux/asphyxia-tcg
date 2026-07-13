import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Audio settings - both SFX (Commit 25) and background music (this addition).
 * Deliberately separate from both gameStore.ts (game state) and animationStore.ts
 * (transient visual events). Persisted to localStorage via Zustand's own persist
 * middleware, which no-ops safely in any environment without localStorage
 * (Node/simulate.ts, SSR) rather than throwing.
 *
 * SFX and music are independent on purpose - a person might want combat sounds
 * but not music, or vice versa, so they're two separate mute/volume pairs rather
 * than one shared "audio on/off."
 */
interface AudioSettingsState {
  sfxMuted: boolean;
  sfxVolume: number; // 0-1
  toggleSfxMuted: () => void;
  setSfxVolume: (v: number) => void;

  musicMuted: boolean;
  musicVolume: number; // 0-1
  toggleMusicMuted: () => void;
  setMusicVolume: (v: number) => void;
}

export const useAudioStore = create<AudioSettingsState>()(
  persist(
    (set) => ({
      sfxMuted: false,
      sfxVolume: 0.5,
      toggleSfxMuted: () => set((s) => ({ sfxMuted: !s.sfxMuted })),
      setSfxVolume: (v) => set({ sfxVolume: Math.max(0, Math.min(1, v)) }),

      // Commit 33 - music now defaults ON. The autoplay-retry mechanism
      // (Commit 31.1 - retries playback on the very first click/keydown if
      // the browser blocked the initial attempt) already handles the one
      // real risk of defaulting to on, so there's no reason to make everyone
      // opt in by hand anymore. Volume defaults much lower too - reported
      // directly as too loud at the old 0.35 default.
      musicMuted: false,
      musicVolume: 0.07,
      toggleMusicMuted: () => set((s) => ({ musicMuted: !s.musicMuted })),
      setMusicVolume: (v) => set({ musicVolume: Math.max(0, Math.min(1, v)) }),
    }),
    { name: 'asphyxia-audio-settings' }
  )
);
