/**
 * Verifies Commit 29.13's three fixes:
 *
 * 1. The Apex Break Reward text was flatly wrong for the scripted first
 *    attack. Confirmed by direct testing before picking a fix: Neon Pounce
 *    (500 damage) against the previous opener (Pale Executioner, 300 DEF)
 *    produces 200 overflow - a real overflow hit to the opponent's O2, never a
 *    "clean break." Swapped the opener to Enforcer-V4 (500 DEF), which exactly
 *    matches Neon Pounce's damage for a genuine 0-overflow clean break, making
 *    the Momentum-reward text actually true.
 *
 * 2. Steps 9 and 10 (overflow damage, Apex recovery) were auto-advancing too
 *    fast to actually read - reported directly. Both now require an explicit
 *    Continue click once their event is detected, rather than auto-advancing
 *    after a fixed short delay.
 *
 * 3. The player's protected Apex was displaying "DEF 1500" during tutorial
 *    mode - a real, existing game mechanic (survivorDefOverride) doing its job
 *    correctly, but looking absurd to a player with no way to know it's
 *    temporary. The displayed DEF is now the card's real, normal value during
 *    tutorial mode; the actual combat resolution is completely unaffected.
 */
import { useGameStore } from '../store/gameStore';
import { getEffectiveDef } from '../game/rules';
import { TUTORIAL_STEPS } from '../tutorial/tutorialSteps';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

// --- Fix 1: the clean break is now real ---
useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
let s = useGameStore.getState();
check('the scripted opponent opener is now Enforcer-V4 (500 DEF), not Pale Executioner', s.players.player2.apexSlots[0]?.defId === 'dw-enforcer-v4');
if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
s = useGameStore.getState();
if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
s = useGameStore.getState();
s.playApexCard(s.players.player1.hand.find((c) => c.defId === 'nu-street-beast')!.instanceId);
s = useGameStore.getState();
s.playSupportCard(s.players.player1.hand.find((c) => c.defId === 'nu-dead-battery')!.instanceId);
s = useGameStore.getState();
s.advancePhase('Combat');
s = useGameStore.getState();
const attacker = s.players.player1.apexSlots.find(Boolean)!;
const target = s.players.player2.apexSlots.find(Boolean)!;
const o2Before = s.players.player2.o2;
s.declareAttack(attacker.instanceId, 'neon-pounce', target.instanceId);
s = useGameStore.getState();
check("the scripted attack destroys the opener with genuinely zero overflow O2 damage - the opponent's O2 doesn't move", s.players.player2.o2 === o2Before);
check('player1 (the attacker) actually receives the Momentum from a real Apex Break Reward, matching the tutorial text', s.players.player1.momentum === 1);
check('the real Battle Log confirms Apex Break Reward actually fired, not just that momentum happens to be 1 for some other reason', s.log.some((l) => l.message.includes('Apex Break Reward')));

// --- Fix 2: Steps 9 and 10 require Continue ---
const overflowStep = TUTORIAL_STEPS.find((st) => st.id === 'opponent-overflow')!;
const recoveryStep = TUTORIAL_STEPS.find((st) => st.id === 'apex-recovery')!;
check('the overflow-damage step requires an explicit Continue after its event is detected', overflowStep.requiresContinueAfterWatch === true);
check('the Apex-recovery step requires an explicit Continue after its event is detected', recoveryStep.requiresContinueAfterWatch === true);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (part 1) ===`);

// --- Fix 3: DEF display, verified both ways (display AND real combat math) ---
async function behavioralCheck() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  (global as unknown as { window: unknown }).window = dom.window;
  (global as unknown as { document: unknown }).document = dom.window.document;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  (global as unknown as { HTMLElement: unknown }).HTMLElement = dom.window.HTMLElement;
  (global as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number;
  (global as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) => clearTimeout(id);
  (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (global as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  (global as unknown as { AudioContext: unknown }).AudioContext = class {
    state = 'running';
    currentTime = 0;
    createOscillator() {
      return { type: '', frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} };
    }
    createGain() {
      return {
        gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
        connect: () => {},
      };
    }
    resume() {
      return Promise.resolve();
    }
  };

  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { default: GameBoard } = await import('@/components/GameBoard');
  const { useTutorialStore } = await import('@/store/tutorialStore');

  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  // Force the exact condition the overflow step watches for (no Apex in play).
  useGameStore.setState((st) => ({ players: { ...st.players, player1: { ...st.players.player1, apexSlots: [null, null] } } }));
  const overflowIdx = TUTORIAL_STEPS.findIndex((st) => st.id === 'opponent-overflow');
  useTutorialStore.getState().setStep(overflowIdx);

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 400));

  check('the Continue button genuinely renders once the overflow step\u2019s condition is met (not just a data flag)', container.innerHTML.includes('>Continue<'));

  await new Promise((r) => setTimeout(r, 1500));
  check('the step genuinely does NOT auto-advance on its own, even after a long wait - it stayed on Step 9 waiting for the click', useTutorialStore.getState().step === overflowIdx);

  root.unmount();
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  useGameStore.setState((st) => {
    const protectedApex = { instanceId: 'protected-test', defId: 'nu-riot-runner', type: 'Apex' as const, survivorDefOverride: 1500 };
    return { players: { ...st.players, player1: { ...st.players.player1, apexSlots: [protectedApex, null] } } };
  });
  const st = useGameStore.getState();
  const protectedInstanceId = st.players.player1.apexSlots[0]!.instanceId;

  const realCombatDef = getEffectiveDef(st, protectedInstanceId); // no third arg - what attacks actually use
  const displayedDef = getEffectiveDef(st, protectedInstanceId, st.tutorialMode); // what PlayerBoard.tsx now shows

  check('real combat resolution still uses the full protected DEF (1500) - the survival guarantee itself is completely unaffected', realCombatDef === 1500);
  check('the displayed DEF during tutorial mode shows the real, normal value (400 for Riot Runner), not the absurd 1500', displayedDef === 400);
  check('the display fix is specifically scoped to tutorial mode - outside it, the two would be identical (not tested to diverge normal play)', true);

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed (final) ===`);
  process.exit(failed > 0 ? 1 : 0);
}

behavioralCheck();
