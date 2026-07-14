/* Targeted test for the DEF/ATK boost-nerf preview helpers used to color card numbers
   green (boosted) or red (nerfed) in the UI. */
import { useGameStore } from '../store/gameStore';
import { produce } from 'immer';
import { getEffectiveDef, getPreviewAttackDamage, applyTempDefBuffFn, armAttackBonusFn, addCounterFn } from '../game/rules';
import { getCardDef } from '../data/cards';
import type { ApexDef } from '../types/game';

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`  PASS: ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

function setupToMainPhase() {
  const s = useGameStore.getState();
  s.startNewGame('Neon Underground', 'Dark White');
  let guard = 0;
  while (useGameStore.getState().status === 'selectingOpeningApex' && guard < 5) {
    guard += 1;
    const st = useGameStore.getState();
    const pid = st.openingApexSelectionPlayerId!;
    const apex = st.players[pid].hand.find((c) => c.type === 'Apex')!;
    st.selectOpeningApex(pid, apex.instanceId);
  }
  while (useGameStore.getState().phase === 'Start') {
    const st = useGameStore.getState();
    if (st.phase === 'Start' && st.startPhasePending) st.advancePhase('Start');
    else if (st.phase === 'Start') st.advancePhase('Main');
  }
}

console.log('=== DEF boost/nerf preview ===');
{
  setupToMainPhase();
  const active = useGameStore.getState().activePlayerId;
  const apex = useGameStore.getState().players[active].apexSlots.find(Boolean)!;
  const apexDef = getCardDef(apex.defId) as ApexDef;
  const baseDef = apexDef.baseDef;

  const defBefore = getEffectiveDef(useGameStore.getState(), apex.instanceId);
  check('DEF starts equal to base (no delta, would render neutral color)', defBefore === baseDef);

  useGameStore.setState(produce((state) => {
    applyTempDefBuffFn(state, apex.instanceId, 100, state.turnNumber + 5);
  }));
  const defAfterBoost = getEffectiveDef(useGameStore.getState(), apex.instanceId);
  check('DEF boost of +100 reflected (would render GREEN)', defAfterBoost === baseDef + 100);

  useGameStore.setState(produce((state) => {
    applyTempDefBuffFn(state, apex.instanceId, -300, state.turnNumber + 5);
  }));
  const defAfterNerf = getEffectiveDef(useGameStore.getState(), apex.instanceId);
  check('DEF nerf brings total below base (would render RED)', defAfterNerf < baseDef);
}

console.log('=== ATK boost preview (armed bonus) ===');
{
  setupToMainPhase();
  const active = useGameStore.getState().activePlayerId;
  const apex = useGameStore.getState().players[active].apexSlots.find(Boolean)!;
  const apexDef = getCardDef(apex.defId) as ApexDef;
  const firstAttackId = apexDef.attacks[0].id;

  const previewBefore = getPreviewAttackDamage(useGameStore.getState(), apex.instanceId, firstAttackId)!;
  check('no armed bonus initially -> modified equals base (neutral color)', previewBefore.modifiedDamage === previewBefore.baseDamage);

  useGameStore.setState(produce((state) => {
    armAttackBonusFn(state, apex.instanceId, 200);
  }));
  const previewAfter = getPreviewAttackDamage(useGameStore.getState(), apex.instanceId, firstAttackId)!;
  check(
    'armed +200 bonus reflected in preview (would render GREEN, e.g. "base -> base+200")',
    previewAfter.modifiedDamage === previewAfter.baseDamage + 200
  );
}

console.log('=== Glitch counters reduce DEF (would render RED) ===');
{
  setupToMainPhase();
  const active = useGameStore.getState().activePlayerId;
  const apex = useGameStore.getState().players[active].apexSlots.find(Boolean)!;
  const apexDef = getCardDef(apex.defId) as ApexDef;

  useGameStore.setState(produce((state) => {
    addCounterFn(state, apex.instanceId, 'glitch', 2);
  }));
  const defAfterGlitch = getEffectiveDef(useGameStore.getState(), apex.instanceId);
  check('2 Glitch Counters reduce DEF by 200 (would render RED)', defAfterGlitch === apexDef.baseDef - 200);
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
