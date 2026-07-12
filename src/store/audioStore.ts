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

      // Music defaults to muted - autoplay-with-sound is broadly blocked by
      // browsers until a real user gesture anyway, and starting silent by default
      // is the friendlier choice regardless (nobody's ever mad their game was
      // too quiet on first load; the opposite happens constantly).
      musicMuted: true,
      musicVolume: 0.35,
      toggleMusicMuted: () => set((s) => ({ musicMuted: !s.musicMuted })),
      setMusicVolume: (v) => set({ musicVolume: Math.max(0, Math.min(1, v)) }),
    }),
    { name: 'asphyxia-audio-settings' }
  )
);
