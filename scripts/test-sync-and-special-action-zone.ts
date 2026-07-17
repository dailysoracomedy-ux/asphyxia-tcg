/**
 * Verifies Commit 31.5's fixes for three real, reported bugs:
 *
 * 1. "Engines don't provide +1 sync on the turn they're played." A real
 *    regression from Commit 30.4's Main/Combat phase merge: Sync used to be
 *    computed when the player explicitly transitioned from Main to Combat
 *    (after they'd finished playing cards), so a freshly played Engine
 *    counted. After the merge, Sync is computed once, immediately, before
 *    any cards are played that turn - and playSupportCard never updated it
 *    afterward, so no Engine ever contributed Sync the turn it was played,
 *    not just a "second Engine mid-turn" edge case as an earlier commit
 *    summary incorrectly assumed.
 *
 * 2. All Specials (targeted or not) now play into the Action Zone first,
 *    then the player picks the target afterward - not straight onto the
 *    target, per direct request (Overclock, and Specials generally).
 *
 * 3. This also fixes Dark White (and any faction's) targeted Specials
 *    failing to show any legal drop zone at all in certain board states -
 *    the Action Zone is now always the drop target regardless of what kind
 *    of target the Special eventually needs.
 */
import { useGameStore } from '@/store/gameStore';
import { legalZonesFor } from '@/ui/dragDrop/dragDropLogic';
import { zoneKey, type DragSource } from '@/ui/dragDrop/dragDropTypes';
import { createInstance } from '@/data/decks';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

function freshMain(p1: 'Neon Underground' | 'Dark White' = 'Neon Underground', p2: 'Neon Underground' | 'Dark White' = 'Dark White') {
  useGameStore.getState().startNewGame(p1, p2, true, false, false);
  let s = useGameStore.getState();
  if (s.status === 'selectingOpeningApex') {
    const apex1 = s.players.player1.hand.find((c) => c.type === 'Apex');
    if (apex1) s.selectOpeningApex('player1', apex1.instanceId);
    s = useGameStore.getState();
    const apex2 = s.players.player2.hand.find((c) => c.type === 'Apex');
    if (apex2) s.selectOpeningApex('player2', apex2.instanceId);
  }
  s = useGameStore.getState();
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  s = useGameStore.getState();
  if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
  useGameStore.setState({ activePlayerId: 'player1' });
}

// --- Fix 1: Engine provides Sync immediately ---
freshMain();
let s = useGameStore.getState();
const syncBefore = s.players.player1.availableSync;
const engine = createInstance('nu-dead-battery', 'BatterySupport');
useGameStore.setState((st) => ({
  players: { ...st.players, player1: { ...st.players.player1, hand: [...st.players.player1.hand, engine] } },
}));
s = useGameStore.getState();
s.playSupportCard(engine.instanceId);
s = useGameStore.getState();
check('Engine genuinely played', s.players.player1.supportSlots.some((sl) => sl?.instanceId === engine.instanceId));
check('availableSync genuinely increased by 1 immediately, same turn it was played (the actual reported bug, now fixed)', s.players.player1.availableSync === syncBefore + 1);

// Confirm it doesn't refund Sync already spent this turn.
freshMain();
s = useGameStore.getState();
useGameStore.setState((st) => ({ players: { ...st.players, player1: { ...st.players.player1, availableSync: 1 } } }));
s = useGameStore.getState();
const spentTracking = s.players.player1.availableSync; // simulate 1 already spent out of some higher max
const engine2 = createInstance('nu-juice-box', 'AbilitySupport');
useGameStore.setState((st) => ({
  players: { ...st.players, player1: { ...st.players.player1, hand: [...st.players.player1.hand, engine2] } },
}));
s = useGameStore.getState();
s.playSupportCard(engine2.instanceId);
s = useGameStore.getState();
check('playing a second Engine increments (not recomputes) availableSync - does not silently refund already-spent Sync', s.players.player1.availableSync === spentTracking + 1);

// --- Fix 2 & 3: all Specials drop into the Action Zone, including targeted Dark White Specials ---
freshMain('Neon Underground', 'Dark White');
s = useGameStore.getState();
const enemyApex = s.players.player2.apexSlots.find(Boolean);
check('test setup: an enemy Apex genuinely exists as a potential target', !!enemyApex);

const overclock = createInstance('nu-overclock', 'Special');
useGameStore.setState((st) => ({
  players: { ...st.players, player1: { ...st.players.player1, hand: [...st.players.player1.hand, overclock] } },
}));
s = useGameStore.getState();
const overclockSource: DragSource = { kind: 'hand-card', playerId: 'player1', instanceId: overclock.instanceId, cardType: 'Special' };
const overclockZones = legalZonesFor(s, overclockSource);
check('Overclock (a targeted Special) drag: the Action Zone is genuinely the legal drop target now', overclockZones.has(zoneKey({ kind: 'action-zone', playerId: 'player1' })));
check('Overclock drag: dragging straight onto an Apex is genuinely no longer a legal destination', !enemyApex || !overclockZones.has(zoneKey({ kind: 'enemy-apex', playerId: 'player2', instanceId: enemyApex.instanceId, slotIndex: 0 })));

// Dark White's Choke Protocol specifically, as player1.
freshMain('Dark White', 'Neon Underground');
s = useGameStore.getState();
const chokeProtocol = createInstance('dw-choke-protocol', 'Special');
useGameStore.setState((st) => ({
  players: { ...st.players, player1: { ...st.players.player1, hand: [...st.players.player1.hand, chokeProtocol] } },
}));
s = useGameStore.getState();
const chokeSource: DragSource = { kind: 'hand-card', playerId: 'player1', instanceId: chokeProtocol.instanceId, cardType: 'Special' };
const chokeZones = legalZonesFor(s, chokeSource);
check(
  'Choke Protocol (Dark White) drag: the Action Zone is genuinely a legal drop target - the actual reported "couldn\u2019t play any Dark White Specials" bug, now fixed',
  chokeZones.has(zoneKey({ kind: 'action-zone', playerId: 'player1' }))
);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
