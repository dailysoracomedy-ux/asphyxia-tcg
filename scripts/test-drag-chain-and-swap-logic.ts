/**
 * Verifies Commit 30.3's core drag-drop logic additions directly against
 * resolveDrop/legalZonesFor: dragging an Ability Engine onto an Apex chains
 * it immediately, and dragging an Equip onto an already-equipped Apex routes
 * to equipSwap (not playEquipCard, which silently rejects that case).
 */
import { useGameStore } from '../store/gameStore';
import { legalZonesFor, resolveDrop } from '../ui/dragDrop/dragDropLogic';
import { zoneKey, type DragSource } from '../ui/dragDrop/dragDropTypes';
import { createInstance } from '../data/decks';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

function freshMain() {
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', true, false, false);
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

const actions = () => {
  const s = useGameStore.getState();
  return {
    playApexCard: s.playApexCard,
    playSupportCard: s.playSupportCard,
    playEquipCard: s.playEquipCard,
    equipSwap: s.equipSwap,
    playSpecialCard: s.playSpecialCard,
  };
};

// --- Ability Engine dropped ONTO an Apex chains immediately ---
freshMain();
let s = useGameStore.getState();
const apexOnBoard = s.players.player1.apexSlots.find(Boolean)!;
const engine = createInstance('nu-juice-box', 'AbilitySupport');
useGameStore.setState((st) => ({
  players: { ...st.players, player1: { ...st.players.player1, hand: [...st.players.player1.hand, engine] } },
}));
s = useGameStore.getState();
const engineSource: DragSource = { kind: 'hand-card', playerId: 'player1', instanceId: engine.instanceId, cardType: 'AbilitySupport' };
const engineZones = legalZonesFor(s, engineSource);
check('Ability Engine drag: the friendly Apex is a legal drop zone (chain target)', engineZones.has(zoneKey({ kind: 'own-apex', playerId: 'player1', instanceId: apexOnBoard.instanceId })));
const engineResult = resolveDrop(s, engineSource, { kind: 'own-apex', playerId: 'player1', instanceId: apexOnBoard.instanceId }, actions());
check('Ability Engine drag onto Apex resolves ok', engineResult.ok === true);
s = useGameStore.getState();
const playedEngine = s.players.player1.supportSlots.find((sl) => sl?.instanceId === engine.instanceId);
check('the real store action ran - Engine is genuinely on board AND genuinely chained to that Apex', playedEngine?.chainedApexId === apexOnBoard.instanceId);

// --- Ability Engine dropped onto an EMPTY SLOT plays unchained (still true) ---
freshMain();
s = useGameStore.getState();
const engine2 = createInstance('nu-juice-box', 'AbilitySupport');
useGameStore.setState((st) => ({
  players: { ...st.players, player1: { ...st.players.player1, hand: [...st.players.player1.hand, engine2] } },
}));
s = useGameStore.getState();
const engineSource2: DragSource = { kind: 'hand-card', playerId: 'player1', instanceId: engine2.instanceId, cardType: 'AbilitySupport' };
const result2 = resolveDrop(s, engineSource2, { kind: 'support-slot', playerId: 'player1', slotIndex: 0 }, actions());
check('Ability Engine drag onto an empty Engine slot still resolves ok', result2.ok === true);
s = useGameStore.getState();
const playedEngine2 = s.players.player1.supportSlots.find((sl) => sl?.instanceId === engine2.instanceId);
check('dropped on an Engine slot specifically, it genuinely plays unchained', !!playedEngine2 && !playedEngine2.chainedApexId);

// --- Equip dropped onto an already-equipped Apex routes to equipSwap ---
freshMain();
s = useGameStore.getState();
const apexForEquip = s.players.player1.apexSlots.find(Boolean)!;
const firstEquip = createInstance('nu-plasma-edge', 'Equip');
useGameStore.setState((st) => ({
  players: {
    ...st.players,
    player1: {
      ...st.players.player1,
      apexSlots: st.players.player1.apexSlots.map((a) => (a?.instanceId === apexForEquip.instanceId ? { ...a, equip: { ...firstEquip, equippedTurn: 0 } } : a)) as typeof st.players.player1.apexSlots,
    },
  },
}));
const secondEquip = createInstance('nu-smog-jacket', 'Equip');
useGameStore.setState((st) => ({
  players: { ...st.players, player1: { ...st.players.player1, hand: [...st.players.player1.hand, secondEquip] } },
}));
s = useGameStore.getState();
check('test setup: the Apex genuinely already has an Equip attached', !!s.players.player1.apexSlots.find((a) => a?.instanceId === apexForEquip.instanceId)?.equip);
const equipSource: DragSource = { kind: 'hand-card', playerId: 'player1', instanceId: secondEquip.instanceId, cardType: 'Equip' };
const equipZones = legalZonesFor(s, equipSource);
check('Equip drag: the already-equipped Apex is still a legal zone (swap-eligible)', equipZones.has(zoneKey({ kind: 'own-apex', playerId: 'player1', instanceId: apexForEquip.instanceId })));
const equipResult = resolveDrop(s, equipSource, { kind: 'own-apex', playerId: 'player1', instanceId: apexForEquip.instanceId }, actions());
check('Equip drag onto an already-equipped Apex resolves ok (routes to swap, not the rejecting playEquipCard path)', equipResult.ok === true);
s = useGameStore.getState();
const swappedApex = s.players.player1.apexSlots.find((a) => a?.instanceId === apexForEquip.instanceId);
check('the real equipSwap action ran - the NEW Equip is genuinely attached', swappedApex?.equip?.instanceId === secondEquip.instanceId);
check('the OLD Equip genuinely returned to hand, not discarded', s.players.player1.hand.some((c) => c.instanceId === firstEquip.instanceId));

// --- Attack drag: legal targets computable with no attackId set upfront (new flow) ---
freshMain();
let s2 = useGameStore.getState();
const attackerApex = s2.players.player1.apexSlots.find(Boolean)!;
useGameStore.setState((st) => ({
  players: { ...st.players, player2: { ...st.players.player2, apexSlots: [{ instanceId: 'test-enemy', defId: 'dw-pale-executioner', type: 'Apex' as const }, null] } },
}));
s2 = useGameStore.getState();
const attackSourceNoId: DragSource = { kind: 'apex-attack', playerId: 'player1', instanceId: attackerApex.instanceId };
const attackZones = legalZonesFor(s2, attackSourceNoId);
check('Attack drag: legal target zones computable with NO attackId set upfront - the new drag-first combat flow', attackZones.has(zoneKey({ kind: 'enemy-apex', playerId: 'player2', instanceId: 'test-enemy', slotIndex: 0 })));

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
