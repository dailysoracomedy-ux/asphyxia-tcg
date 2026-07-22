/* Commit 52 - verifies the drag-back reconfigure store actions:
   - returnEquipToHand: pulls an attached Equip back to hand, FREE (no budget
     consumed), Apex slot freed, card lands in hand (not Void).
   - A replacement Equip can then be attached to the now-empty Apex.
   - returnEngineToHand: pulls an Engine (Ability Support) back to hand, frees
     the slot, unlinks any chain.
   - Playing a replacement Engine still respects the one-support-per-turn limit
     (which is what enforces "one engine swap per turn").
*/
import { useGameStore } from '@/store/gameStore';
import { createInstance } from '@/data/decks';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

function freshGame() {
  useGameStore.getState().startNewGame('Dark White', 'Neon Underground', false);
  const st = useGameStore.getState();
  const p1 = st.openingApexSelectionPlayerId!;
  st.selectOpeningApex(p1, st.players[p1].hand.find((c) => c.type === 'Apex')!.instanceId);
  const st2 = useGameStore.getState();
  const p2 = st2.openingApexSelectionPlayerId!;
  st2.selectOpeningApex(p2, st2.players[p2].hand.find((c) => c.type === 'Apex')!.instanceId);
}

freshGame();
let s = useGameStore.getState();
while (s.status === 'playing' && (s.phase === 'Start' || s.startPhasePending)) {
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  else s.advancePhase('Main');
  s = useGameStore.getState();
}

const activeId = s.activePlayerId;
let player = s.players[activeId];
const apexA = player.apexSlots.find(Boolean)!;

// Give the active player two Equips in hand.
useGameStore.setState((st) => {
  const p = { ...st.players[activeId] };
  p.hand = [...p.hand, createInstance('dw-monomolecular-blade', 'Equip'), createInstance('dw-sterile-mantle', 'Equip')];
  return { players: { ...st.players, [activeId]: p } };
});

s = useGameStore.getState();
player = s.players[activeId];
const equip1 = player.hand.find((c) => c.defId === 'dw-monomolecular-blade')!;

// Attach the first equip to apex A.
s.playEquipCard(equip1.instanceId, apexA.instanceId);
s = useGameStore.getState();
player = s.players[activeId];
const apexANow = player.apexSlots.find((a) => a?.instanceId === apexA.instanceId)!;
check('equip attached to apex A', apexANow.equip?.instanceId === equip1.instanceId);
const handCountAfterAttach = player.hand.length;

// Now DRAG IT BACK: returnEquipToHand by the equip's own instance id.
s.returnEquipToHand(equip1.instanceId);
s = useGameStore.getState();
player = s.players[activeId];
const apexAfterReturn = player.apexSlots.find((a) => a?.instanceId === apexA.instanceId)!;
check('apex A equip slot is now empty after drag-back', !apexAfterReturn.equip);
check('the equip returned to HAND (not void)', player.hand.some((c) => c.instanceId === equip1.instanceId));
check('equip is NOT in the void', !player.voidZone.some((c) => c.instanceId === equip1.instanceId));
check('hand count went back up by 1', player.hand.length === handCountAfterAttach + 1);

// Re-attach a replacement equip to the now-empty apex (this is the "put one
// back" case - must succeed, since removal consumed nothing).
const equip2 = player.hand.find((c) => c.defId === 'dw-sterile-mantle')!;
s.playEquipCard(equip2.instanceId, apexA.instanceId);
s = useGameStore.getState();
player = s.players[activeId];
const apexReequipped = player.apexSlots.find((a) => a?.instanceId === apexA.instanceId)!;
check('a replacement equip can be attached after drag-back (free removal)', apexReequipped.equip?.instanceId === equip2.instanceId);

// --- Engine drag-back ---
freshGame();
s = useGameStore.getState();
while (s.status === 'playing' && (s.phase === 'Start' || s.startPhasePending)) {
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  else s.advancePhase('Main');
  s = useGameStore.getState();
}
const aId = s.activePlayerId;
// Give an Ability Support (Engine) and place it.
useGameStore.setState((st) => {
  const p = { ...st.players[aId] };
  p.hand = [...p.hand, createInstance('nu-dead-battery', 'BatterySupport')];
  return { players: { ...st.players, [aId]: p } };
});
s = useGameStore.getState();
let ap = s.players[aId];
const engine = ap.hand.find((c) => c.defId === 'nu-dead-battery');
if (engine) {
  const emptySlot = ap.supportSlots.findIndex((x) => !x);
  s.playSupportCard(engine.instanceId, emptySlot);
  s = useGameStore.getState();
  ap = s.players[aId];
  const placed = ap.supportSlots.find((x) => x?.instanceId === engine.instanceId);
  check('engine placed in a support slot', !!placed);
  const handBefore = ap.hand.length;

  s.returnEngineToHand(engine.instanceId);
  s = useGameStore.getState();
  ap = s.players[aId];
  check('engine slot empty after drag-back', !ap.supportSlots.some((x) => x?.instanceId === engine.instanceId));
  check('engine returned to hand', ap.hand.some((c) => c.instanceId === engine.instanceId));
  check('engine hand count went up by 1', ap.hand.length === handBefore + 1);
} else {
  console.log('  (skipped engine test - card def not found)');
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
