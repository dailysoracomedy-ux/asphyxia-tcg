import { legalZonesFor, resolveDrop } from '@/ui/dragDrop/dragDropLogic';
import { zoneKey } from '@/ui/dragDrop/dragDropTypes';
import type { DragSource, DropZoneId } from '@/ui/dragDrop/dragDropTypes';
import { useGameStore } from '@/store/gameStore';

let passed=0, failed=0;
function check(l:string,c:boolean){ if(c){passed++;console.log('  PASS: '+l);} else {failed++;console.log('  FAIL: '+l);} }

const s = useGameStore.getState();
// board-equip source: only legal zone should be the hand
const src: DragSource = { kind:'board-equip', playerId:'player1', instanceId:'equip-x' };
const zones = legalZonesFor(s, src);
check('board-equip legal zone is the hand', zones.has(zoneKey({kind:'hand',playerId:'player1'})));
check('board-equip has exactly one legal zone', zones.size===1);

// resolveDrop routes board-equip -> returnEquipToHand
let calledEquip=''; let calledEngine='';
const target: DropZoneId = { kind:'hand', playerId:'player1' };
const r = resolveDrop(s, src, target, {
  playApexCard:()=>{}, playSupportCard:()=>{}, playEquipCard:()=>{}, equipSwap:()=>{}, playSpecialCard:()=>{},
  returnEquipToHand:(id)=>{calledEquip=id;}, returnEngineToHand:(id)=>{calledEngine=id;},
});
check('board-equip drop on hand resolves ok', r.ok);
check('board-equip drop calls returnEquipToHand with equip id', calledEquip==='equip-x');

const eng: DragSource = { kind:'board-engine', playerId:'player1', instanceId:'eng-y' };
const r2 = resolveDrop(s, eng, target, {
  playApexCard:()=>{}, playSupportCard:()=>{}, playEquipCard:()=>{}, equipSwap:()=>{}, playSpecialCard:()=>{},
  returnEquipToHand:(id)=>{calledEquip=id;}, returnEngineToHand:(id)=>{calledEngine=id;},
});
check('board-engine drop on hand resolves ok', r2.ok);
check('board-engine drop calls returnEngineToHand', calledEngine==='eng-y');

// dropping a board-equip somewhere that ISN'T the hand should fail
const badTarget: DropZoneId = { kind:'apex-slot', playerId:'player1', slotIndex:0 };
const r3 = resolveDrop(s, src, badTarget, {
  playApexCard:()=>{}, playSupportCard:()=>{}, playEquipCard:()=>{}, equipSwap:()=>{}, playSpecialCard:()=>{},
  returnEquipToHand:()=>{}, returnEngineToHand:()=>{},
});
check('board-equip drop on non-hand zone fails', !r3.ok);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if(failed>0) process.exit(1);
