'use client';

import { useAudioStore } from '@/store/audioStore';
import { playSfx } from './sfx';

/** Compact SFX mute+volume and Music mute+volume controls - two independent
 *  pairs, since a person might want one without the other. Used in both the
 *  in-game top bar and the main menu, so it's one shared component rather than
 *  two copies. */
export default function AudioSettingsControl({ compact }: { compact?: boolean }) {
  const { sfxMuted, sfxVolume, toggleSfxMuted, setSfxVolume, musicMuted, musicVolume, toggleMusicMuted, setMusicVolume } = useAudioStore();

  return (
    <div className={`flex items-center gap-3 ${compact ? '' : 'text-xs'}`}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            toggleSfxMuted();
            if (sfxMuted) playSfx('ui.click'); // only audible when this click un-mutes
          }}
          title={sfxMuted ? 'Unmute SFX' : 'Mute SFX'}
          className="px-1.5 py-1 rounded border border-white/15 hover:bg-white/10 hover:text-white text-white/50 leading-none"
        >
          {sfxMuted ? '🔇' : '🔊'}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={sfxVolume}
          disabled={sfxMuted}
          onChange={(e) => setSfxVolume(Number(e.target.value))}
          onMouseUp={() => playSfx('ui.click')}
          className="w-14 accent-fuchsia-400 disabled:opacity-30"
          title="SFX volume"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            toggleMusicMuted();
            if (musicMuted) playSfx('ui.click');
          }}
          title={musicMuted ? 'Turn music on' : 'Turn music off'}
          className="px-1.5 py-1 rounded border border-white/15 hover:bg-white/10 hover:text-white text-white/50 leading-none"
        >
          {musicMuted ? '🎵' : '🎶'}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={musicVolume}
          disabled={musicMuted}
          onChange={(e) => setMusicVolume(Number(e.target.value))}
          className="w-14 accent-cyan-400 disabled:opacity-30"
          title="Music volume"
        />
      </div>
    </div>
  );
}
