/**
 * Background music playlist. Empty by default - no tracks have been uploaded yet.
 * MusicController handles the empty-array case gracefully (does nothing, no
 * error), so this is safe to ship as-is and fill in later.
 *
 * To add your own tracks:
 * 1. Drop the audio file (mp3, ogg, or m4a all work fine) into /public/audio/music/
 * 2. Add one entry below with a matching `src` path.
 *
 * Example:
 *   { id: 'track-1', title: 'My Track', src: '/audio/music/my-track.mp3' },
 *
 * MusicController shuffles this list into a playlist and loops it continuously
 * while music is unmuted (off by default - see audioStore.ts).
 */
export interface MusicTrack {
  id: string;
  title: string;
  src: string;
}

export const MUSIC_TRACKS: MusicTrack[] = [];
