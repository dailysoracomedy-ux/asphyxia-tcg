/**
 * Verifies Commit 30.3's music track selection logic - the core decision of
 * which track category should be playing given real game state. The
 * crossfade mechanism itself is DOM/timer-based (real <audio> elements,
 * setInterval ramps) and isn't meaningfully testable headlessly; this tests
 * the pure decision function that drives it, exactly per spec: Menu,
 * Tutorial, and AI vs AI all share the theme track (no distinction between
 * them at all), and only a real battle (Vs AI or Hotseat) plays a faction
 * track, keyed off player1's faction.
 */
import { desiredTrackKey } from '@/audio/MusicController';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

check(
  'Menu screen plays the theme track',
  desiredTrackKey({ status: 'menu', selectedFactions: { player1: null } }) === 'theme'
);
check(
  'Tutorial mode plays the theme track, even mid-match with a real faction selected',
  desiredTrackKey({ status: 'playing', tutorialMode: true, selectedFactions: { player1: 'Neon Underground' } }) === 'theme'
);
check(
  'AI vs AI Showcase plays the theme track, even mid-match with a real faction selected',
  desiredTrackKey({ status: 'playing', aiVsAiMode: true, selectedFactions: { player1: 'Dark White' } }) === 'theme'
);
check(
  'A real Vs AI battle plays player1\u2019s faction track, not the theme',
  desiredTrackKey({ status: 'playing', selectedFactions: { player1: 'Neon Underground' } }) === 'Neon Underground'
);
check(
  'A real Hotseat battle also plays player1\u2019s faction track (battle is battle, regardless of vsAI/hotseat)',
  desiredTrackKey({ status: 'playing', selectedFactions: { player1: 'Synth Ascendancy' } }) === 'Synth Ascendancy'
);
check(
  'Game-over screen still plays the faction track, not the theme (the match itself hasn\u2019t left "battle")',
  desiredTrackKey({ status: 'gameover', selectedFactions: { player1: 'Dark White' } }) === 'Dark White'
);
check(
  'A missing player1 faction (should never really happen outside menu, but must not crash) falls back to theme',
  desiredTrackKey({ status: 'playing', selectedFactions: { player1: null } }) === 'theme'
);
check(
  'Different factions genuinely produce different track keys - the actual "switches per faction" behavior',
  desiredTrackKey({ status: 'playing', selectedFactions: { player1: 'Neon Underground' } }) !==
    desiredTrackKey({ status: 'playing', selectedFactions: { player1: 'Dark White' } })
);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
